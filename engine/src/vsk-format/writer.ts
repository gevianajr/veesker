import { writeFileSync, renameSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { writeHeader, HEADER_SIZE } from "./header";
import { writeManifest, type VskManifest } from "./manifest";
import { assertValidTableName } from "./errors";
import { encryptBlob } from "../crypto/blob";
import type { Envelope } from "../crypto/envelope";
import type { DuckDBHost } from "../duckdb-host";

const TABLE_TAG_PREFIX = "__VSK_TABLE__";

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

  const tmpParquet = join(tmpdir(), `vsk-write-${process.pid}-${randomUUID()}.parquet`);
  const dataParts: Buffer[] = [];

  try {
    for (const table of manifest.tables) {
      const tNameSafe = table.name.toLowerCase().replace(/"/g, '""');
      const tmpEsc = tmpParquet.replace(/\\/g, "/").replace(/'/g, "''");
      await src.exec(
        `COPY (SELECT * FROM "${tNameSafe}") TO '${tmpEsc}' (FORMAT PARQUET, COMPRESSION ZSTD)`,
      );
      const parquetBytes = await Bun.file(tmpParquet).bytes();
      const tag = new TextEncoder().encode(`${TABLE_TAG_PREFIX}${table.name}\n`);
      const sizeBuf = new Uint8Array(8);
      new DataView(sizeBuf.buffer).setBigUint64(0, BigInt(parquetBytes.byteLength), true);
      dataParts.push(Buffer.from(tag), Buffer.from(sizeBuf), Buffer.from(parquetBytes));
    }
  } finally {
    try { await Bun.file(tmpParquet).delete(); } catch { /* best effort */ }
  }

  const dataSection = Buffer.concat(dataParts);
  const manifestBytes = writeManifest(manifest);

  const manifestOffset = BigInt(HEADER_SIZE);
  const manifestLength = BigInt(manifestBytes.byteLength);
  const dataOffset = manifestOffset + manifestLength;
  const dataLength = BigInt(dataSection.byteLength);

  const header = writeHeader({
    manifestOffset,
    manifestLength,
    dataOffset,
    dataLength,
    envelopeOffset: 0n,
    envelopeLength: 0n,
  });

  const out = Buffer.concat([Buffer.from(header), Buffer.from(manifestBytes), dataSection]);
  const tmpOut = `${outPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmpOut, out);
    renameSync(tmpOut, outPath);
  } catch (err) {
    try { unlinkSync(tmpOut); } catch { /* best effort */ }
    throw err;
  }
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
 * The plain manifest is NOT visible in the encrypted file - it lives
 * inside the encrypted blob. This is by design: the encryption envelope
 * tells you who can read it, but the schema is only revealed to those
 * holding the content key.
 */
export async function writeEncryptedVsk(
  src: DuckDBHost,
  outPath: string,
  manifest: VskManifest,
  contentKey: Uint8Array,
  envelope: Envelope,
): Promise<void> {
  const tmpPlain = `${outPath}.${process.pid}.${randomUUID()}.plain.tmp`;
  let plainBytes: Uint8Array;
  try {
    await writeVsk(src, tmpPlain, manifest);
    plainBytes = await Bun.file(tmpPlain).bytes();
  } finally {
    try { await Bun.file(tmpPlain).delete(); } catch { /* best effort */ }
  }

  const encrypted = await encryptBlob(contentKey, plainBytes);

  const envelopeBlock = JSON.stringify({
    nonce: Buffer.from(envelope.nonce).toString("base64"),
    ciphertext: Buffer.from(envelope.ciphertext).toString("base64"),
    blobNonce: Buffer.from(encrypted.nonce).toString("base64"),
  });
  const envelopeBytes = new TextEncoder().encode(envelopeBlock);

  const envelopeOffset = BigInt(HEADER_SIZE);
  const envelopeLength = BigInt(envelopeBytes.byteLength);
  const dataOffset = envelopeOffset + envelopeLength;
  const dataLength = BigInt(encrypted.ciphertext.byteLength);

  const header = writeHeader({
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

  const tmpOut = `${outPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmpOut, out);
    renameSync(tmpOut, outPath);
  } catch (err) {
    try { unlinkSync(tmpOut); } catch { /* best effort */ }
    throw err;
  }
}
