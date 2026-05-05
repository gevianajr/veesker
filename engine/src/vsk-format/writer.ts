import { writeFileSync, renameSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeHeader, HEADER_SIZE } from "./header";
import { writeManifest, type VskManifest } from "./manifest";
import { assertValidTableName } from "./errors";
import { FORMAT_V1, FORMAT_V2 } from "./version";
import { encryptBlob } from "../crypto/blob";
import { buildAad } from "../crypto/aad";
import type { Envelope } from "../crypto/envelope";
import type { DuckDBHost } from "../duckdb-host";

const TABLE_TAG_PREFIX = "__VSK_TABLE__";
const SYSTEM_TABLE_PREFIX = "__vsk_";
const SYSTEM_TABLE_ORDER = ["__vsk_objects", "__vsk_source", "__vsk_dependencies"] as const;

async function tableExists(src: DuckDBHost, name: string): Promise<boolean> {
  const res = await src.query(
    `SELECT count(*) FROM information_schema.tables WHERE table_schema = 'main' AND table_name = '${name.toLowerCase().replace(/'/g, "''")}'`
  );
  return Number(Object.values(res[0]!)[0]) > 0;
}

async function writeOneTable(
  src: DuckDBHost,
  rawName: string,
  tmpParquet: string,
  dataParts: Buffer[],
): Promise<void> {
  const tNameSafe = rawName.toLowerCase().replace(/"/g, '""');
  const tmpEsc = tmpParquet.replace(/\\/g, "/").replace(/'/g, "''");
  await src.exec(
    `COPY (SELECT * FROM "${tNameSafe}") TO '${tmpEsc}' (FORMAT PARQUET, COMPRESSION ZSTD)`,
  );
  const parquetBytes = await Bun.file(tmpParquet).bytes();
  const tag = new TextEncoder().encode(`${TABLE_TAG_PREFIX}${rawName}\n`);
  const sizeBuf = new Uint8Array(8);
  new DataView(sizeBuf.buffer).setBigUint64(0, BigInt(parquetBytes.byteLength), true);
  dataParts.push(Buffer.from(tag), Buffer.from(sizeBuf), Buffer.from(parquetBytes));
}

/**
 * Pack a DuckDB-resident sandbox into a single `.vsk` file.
 *
 * Output is written atomically (write to `${outPath}.tmp`, then rename).
 * Table names are validated against {@link assertValidTableName} BEFORE any
 * COPY runs, so a manifest with an unsafe name fails fast with no partial
 * file or tmp-parquet leakage.
 *
 * The data section is a concatenation of per-table blocks:
 *   `<TABLE_TAG_PREFIX><NAME>\n<8-byte LE size><parquet bytes>`
 *
 * Tables are written in the order they appear in `manifest.tables`. The
 * reader uses the same order to re-create them.
 */
export async function writeVsk(
  src: DuckDBHost,
  outPath: string,
  manifest: VskManifest,
): Promise<void> {
  for (const t of manifest.tables) assertValidTableName(t.name);

  const tmpWriteDir = mkdtempSync(join(tmpdir(), `vsk-write-${process.pid}-`));
  const tmpParquet = join(tmpWriteDir, "table.parquet");
  const dataParts: Buffer[] = [];

  try {
    for (const table of manifest.tables) {
      if (table.name.toLowerCase().startsWith(SYSTEM_TABLE_PREFIX)) {
        throw new Error(`writer: table name "${table.name}" collides with reserved __vsk_ prefix`);
      }
      await writeOneTable(src, table.name, tmpParquet, dataParts);
    }
    for (const sysName of SYSTEM_TABLE_ORDER) {
      if (await tableExists(src, sysName)) {
        await writeOneTable(src, sysName, tmpParquet, dataParts);
      }
    }
  } finally {
    try { rmSync(tmpWriteDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  const dataSection = Buffer.concat(dataParts);
  const manifestBytes = writeManifest(manifest);

  const manifestOffset = BigInt(HEADER_SIZE);
  const manifestLength = BigInt(manifestBytes.byteLength);
  const dataOffset = manifestOffset + manifestLength;
  const dataLength = BigInt(dataSection.byteLength);

  const header = writeHeader({
    formatVersion: FORMAT_V1,
    manifestOffset,
    manifestLength,
    dataOffset,
    dataLength,
    envelopeOffset: 0n,
    envelopeLength: 0n,
  });

  const out = Buffer.concat([Buffer.from(header), Buffer.from(manifestBytes), dataSection]);
  const tmpOutDir = mkdtempSync(join(tmpdir(), `vsk-out-${process.pid}-`));
  const tmpOut = join(tmpOutDir, "out.vsk");
  try {
    writeFileSync(tmpOut, out);
    renameSync(tmpOut, outPath);
  } finally {
    try { rmSync(tmpOutDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

export interface EncryptedVskAadContext {
  /** Identifies the sandbox being packed — bound into AAD. */
  sandboxId: string;
  /** Monotonic version number of the sandbox — bound into AAD. */
  sandboxVersion: number;
  /** Recipient's X25519 public key (32 bytes) — bound into AAD. */
  recipientPubkey: Uint8Array;
}

/**
 * Pack a sandbox into an ENCRYPTED .vsk file.
 *
 * Workflow:
 *   1. Builds a plain .vsk in a temp file (delegates to writeVsk).
 *   2. Encrypts the entire file with XChaCha20-Poly1305 IETF using the
 *      caller-supplied content key.
 *   3. Wraps the content key in an envelope (caller pre-computed via
 *      sealEnvelope) and stores it inline in the encrypted file.
 *   4. Writes header -> envelope-block -> encrypted-blob to outPath atomically.
 *
 * When `aadContext` is supplied the file is written as FORMAT_V2: both the
 * envelope and the blob are AEAD-bound to (sandboxId, sandboxVersion,
 * recipientPubkey). The caller MUST have sealed `envelope` with the same AAD;
 * this function independently computes the blob AAD and passes it to
 * {@link encryptBlob}. The aadContext fields are stored in the plaintext
 * envelope JSON so the reader can reconstruct AAD without decrypting.
 *
 * Without `aadContext` the file is FORMAT_V1 (legacy behaviour, no AAD).
 *
 * The plain manifest is NOT visible in the encrypted file — it lives inside
 * the encrypted blob. This is by design: the encryption envelope tells you
 * who can read it, but the schema is only revealed to those holding the
 * content key.
 */
export async function writeEncryptedVsk(
  src: DuckDBHost,
  outPath: string,
  manifest: VskManifest,
  contentKey: Uint8Array,
  envelope: Envelope,
  aadContext?: EncryptedVskAadContext,
): Promise<void> {
  const tmpPlainDir = mkdtempSync(join(tmpdir(), `vsk-plain-${process.pid}-`));
  const tmpPlain = join(tmpPlainDir, "plain.vsk");
  let plainBytes: Uint8Array;
  try {
    await writeVsk(src, tmpPlain, manifest);
    plainBytes = await Bun.file(tmpPlain).bytes();
  } finally {
    try { rmSync(tmpPlainDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  const formatVersion = aadContext ? FORMAT_V2 : FORMAT_V1;

  let blobAad: Uint8Array | undefined;
  if (aadContext) {
    blobAad = buildAad({
      sandboxId: aadContext.sandboxId,
      sandboxVersion: aadContext.sandboxVersion,
      recipientPubkey: aadContext.recipientPubkey,
      formatVersion: FORMAT_V2,
    });
  }

  const encrypted = await encryptBlob(contentKey, plainBytes, blobAad ? { aad: blobAad } : {});

  const envelopeBlockObj: Record<string, string | number> = {
    nonce: Buffer.from(envelope.nonce).toString("base64"),
    ciphertext: Buffer.from(envelope.ciphertext).toString("base64"),
    blobNonce: Buffer.from(encrypted.nonce).toString("base64"),
    formatVersion,
  };
  if (aadContext) {
    envelopeBlockObj.sandboxId = aadContext.sandboxId;
    envelopeBlockObj.sandboxVersion = aadContext.sandboxVersion;
    envelopeBlockObj.recipientPubkey = Buffer.from(aadContext.recipientPubkey).toString("base64");
  }

  const envelopeBlock = JSON.stringify(envelopeBlockObj);
  const envelopeBytes = new TextEncoder().encode(envelopeBlock);

  const envelopeOffset = BigInt(HEADER_SIZE);
  const envelopeLength = BigInt(envelopeBytes.byteLength);
  const dataOffset = envelopeOffset + envelopeLength;
  const dataLength = BigInt(encrypted.ciphertext.byteLength);

  const header = writeHeader({
    formatVersion,
    manifestOffset: 0n,
    manifestLength: 0n,
    dataOffset,
    dataLength,
    envelopeOffset,
    envelopeLength,
  });

  const out = Buffer.concat([
    Buffer.from(header),
    Buffer.from(envelopeBytes),
    Buffer.from(encrypted.ciphertext),
  ]);

  const tmpEncDir = mkdtempSync(join(tmpdir(), `vsk-enc-${process.pid}-`));
  const tmpOut = join(tmpEncDir, "out.vsk");
  try {
    writeFileSync(tmpOut, out);
    renameSync(tmpOut, outPath);
  } finally {
    try { rmSync(tmpEncDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
