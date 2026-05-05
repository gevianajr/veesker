import { openSync, readSync, closeSync, readFileSync, writeFileSync, unlinkSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { readHeader, HEADER_SIZE } from "./header";
import { readManifest, type VskManifest } from "./manifest";
import { VskFormatError, assertValidTableName } from "./errors";
import { FORMAT_V2, isSupportedFormat } from "./version";
import { decryptBlob } from "../crypto/blob";
import { buildAad } from "../crypto/aad";
import { openEnvelope, type Envelope } from "../crypto/envelope";
import { pubkeyFromBase64, type Keypair } from "../crypto/keypair";
import type { DuckDBHost } from "../duckdb-host";
import { mapOracleType } from "../oracle-shim/types";

export const MAX_VSK_BYTES = 16 * 1024 * 1024 * 1024;

const TABLE_TAG_PREFIX = "__VSK_TABLE__";

/**
 * Read just the 64-byte header from a `.vsk` file. Avoids loading the
 * full file into memory — useful for Task 9 CLI `info` against large
 * sandboxes.
 */
export function readVskHeader(path: string) {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.allocUnsafe(HEADER_SIZE);
    const bytesRead = readSync(fd, buf, 0, HEADER_SIZE, 0);
    if (bytesRead < HEADER_SIZE) {
      throw new VskFormatError(
        "TRUNCATED",
        `vsk header truncated: file is ${bytesRead} bytes, header needs ${HEADER_SIZE}`,
      );
    }
    return readHeader(new Uint8Array(buf.buffer, buf.byteOffset, HEADER_SIZE));
  } finally {
    closeSync(fd);
  }
}

/**
 * Read just the manifest from a `.vsk` file. Reads the header first to
 * locate the manifest, then reads only the manifest bytes — does not
 * touch the data section.
 */
export function readVskManifest(path: string): VskManifest {
  const header = readVskHeader(path);
  const manifestStart = Number(header.manifestOffset);
  const manifestLen = Number(header.manifestLength);
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.allocUnsafe(manifestLen);
    const bytesRead = readSync(fd, buf, 0, manifestLen, manifestStart);
    if (bytesRead < manifestLen) {
      throw new VskFormatError(
        "TRUNCATED",
        `vsk manifest truncated: read ${bytesRead} of ${manifestLen} bytes at offset ${manifestStart}`,
      );
    }
    return readManifest(new Uint8Array(buf.buffer, buf.byteOffset, manifestLen));
  } finally {
    closeSync(fd);
  }
}

const SYSTEM_TABLE_PREFIX = "__vsk_";

export interface ReadVskOptions {
  /** When true, emit `CREATE OR REPLACE TABLE` instead of `CREATE TABLE`. Defaults to false. */
  replace?: boolean;
}

export interface ReadVskResult {
  manifest: VskManifest;
  /** Lower-cased names of user tables created in `dst` (driven by manifest.tables). */
  userTables: string[];
  /** Lower-cased names of system tables (`__vsk_*`) created in `dst`. Empty for v0.1.0 sandboxes. */
  systemTables: string[];
}

function checkVersionFence(m: VskManifest): void {
  const v = m.engineVersion ?? "0.1.0";
  // Strictly `MAJOR.MINOR.PATCH`. We treat any version with a major >= 1 OR
  // (major 0 AND minor >= 3) as forward-incompatible. v0.2.0 reader knows
  // about __vsk_objects/__vsk_source/__vsk_dependencies — anything beyond
  // is unknown territory.
  // Use a strict digits-only check per part — `Number.parseInt("0-rc1", 10)`
  // returns 0 (stops at the dash), which would silently coerce prerelease /
  // tagged versions into the numeric range and bypass the fence. Same for
  // trailing whitespace.
  const partStrings = v.split(".");
  if (partStrings.length !== 3 || !partStrings.every((p) => /^\d+$/.test(p))) {
    throw new VskFormatError("MALFORMED_MANIFEST", `vsk reader: unparseable engineVersion "${v}"`);
  }
  const parts = partStrings.map((p) => Number.parseInt(p, 10));
  const [maj, min] = parts as [number, number, number];
  if (maj > 0 || (maj === 0 && min >= 4)) {
    throw new VskFormatError(
      "MALFORMED_MANIFEST",
      `vsk reader: engineVersion ${v} is newer than this reader (max 0.3.x). Upgrade @veesker/engine.`,
    );
  }
}

/**
 * Restore a `.vsk` file into a DuckDB host. Creates one DuckDB table per
 * manifest entry (lower-cased per DuckDB convention). Returns the manifest,
 * plus separate lists of user tables and system (`__vsk_*`) tables created.
 *
 * Pass `{ replace: true }` to overwrite existing tables in `dst`.
 */
export async function readVsk(
  path: string,
  dst: DuckDBHost,
  opts: ReadVskOptions = {},
): Promise<ReadVskResult> {
  const fileSize = statSync(path).size;
  if (fileSize > MAX_VSK_BYTES) {
    throw new VskFormatError("FILE_TOO_LARGE", `vsk: file exceeds ${MAX_VSK_BYTES} bytes`);
  }
  const file = readFileSync(path);
  const buf = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
  const header = readHeader(buf.subarray(0, HEADER_SIZE));

  const manifestOffset = Number(header.manifestOffset);
  const manifestLength = Number(header.manifestLength);
  if (manifestOffset + manifestLength > buf.byteLength || manifestLength > MAX_VSK_BYTES) {
    throw new VskFormatError("TRUNCATED_OR_INVALID:manifest", "vsk: manifest section exceeds file bounds");
  }
  const dataOffset = Number(header.dataOffset);
  const dataLength = Number(header.dataLength);
  if (dataOffset + dataLength > buf.byteLength || dataLength > MAX_VSK_BYTES) {
    throw new VskFormatError("TRUNCATED_OR_INVALID:data", "vsk: data section exceeds file bounds");
  }

  const manifest = readManifest(
    buf.subarray(manifestOffset, manifestOffset + manifestLength),
  );
  checkVersionFence(manifest);

  const dataStart = dataOffset;
  const dataEnd = dataStart + dataLength;
  let p = dataStart;
  const tagPrefix = new TextEncoder().encode(TABLE_TAG_PREFIX);
  const ddl = opts.replace ? "CREATE OR REPLACE TABLE" : "CREATE TABLE";

  const userTables: string[] = [];
  const systemTables: string[] = [];

  while (p < dataEnd) {
    if (buf.byteLength - p < tagPrefix.byteLength) {
      throw new VskFormatError("TRUNCATED", `vsk: data section truncated at offset ${p}`);
    }
    for (let i = 0; i < tagPrefix.byteLength; i++) {
      if (buf[p + i] !== tagPrefix[i]) {
        throw new VskFormatError(
          "BAD_TAG",
          `vsk: malformed data section at offset ${p} (expected table tag)`,
        );
      }
    }
    const searchEnd = Math.min(buf.byteLength, dataEnd);
    let newlineIdx = -1;
    for (let i = p; i < searchEnd; i++) {
      if (buf[i] === 0x0a) { newlineIdx = i; break; }
    }
    if (newlineIdx < 0 || newlineIdx >= dataEnd) {
      throw new VskFormatError("TRUNCATED", `vsk: unterminated table tag at offset ${p}`);
    }
    const tag = new TextDecoder().decode(buf.subarray(p, newlineIdx));
    const tableName = tag.slice(TABLE_TAG_PREFIX.length);
    if (!tableName) {
      throw new VskFormatError("BAD_TABLE_NAME", `vsk: empty table name in tag at offset ${p}`);
    }
    const isSystem = tableName.toLowerCase().startsWith(SYSTEM_TABLE_PREFIX);
    if (!isSystem) {
      assertValidTableName(tableName);
    } else {
      // System tables bypass assertValidTableName because that allowlist
      // forbids leading underscores. We still need to enforce safe-identifier
      // characters on the suffix — the raw tableName is interpolated into the
      // tmp-file path below, so a crafted name like "__vsk_x/../../etc/exploit"
      // would write parquet bytes outside tmpdir().
      const suffix = tableName.slice(SYSTEM_TABLE_PREFIX.length);
      if (!suffix || !/^[A-Za-z_][A-Za-z0-9_$]{0,120}$/.test(suffix)) {
        throw new VskFormatError(
          "BAD_TABLE_NAME",
          `vsk: invalid system table name at offset ${p}`,
        );
      }
    }
    p = newlineIdx + 1;
    if (p + 8 > dataEnd) {
      throw new VskFormatError(
        "TRUNCATED",
        `vsk: data section truncated reading size for table ${tableName}`,
      );
    }
    const size = Number(
      new DataView(buf.buffer, buf.byteOffset + p, 8).getBigUint64(0, true),
    );
    p += 8;
    if (p + size > dataEnd) {
      throw new VskFormatError(
        "TRUNCATED",
        `vsk: data section truncated reading parquet for table ${tableName}`,
      );
    }
    const parquetBytes = buf.subarray(p, p + size);
    p += size;

    const tmp = join(
      tmpdir(),
      `vsk-load-${process.pid}-${randomUUID()}-${tableName}.parquet`,
    );
    writeFileSync(tmp, Buffer.from(parquetBytes));
    try {
      const tmpEsc = tmp.replace(/\\/g, "/").replace(/'/g, "''");
      const tNameSafe = tableName.toLowerCase().replace(/"/g, '""');
      if (isSystem) {
        // System tables don't appear in manifest.tables. Use the schema
        // baked into the parquet itself via `CREATE TABLE … AS SELECT`.
        await dst.exec(
          `${ddl} "${tNameSafe}" AS SELECT * FROM read_parquet('${tmpEsc}')`,
        );
        systemTables.push(tNameSafe);
      } else {
        const tNameUpper = tableName.toUpperCase();
        const manifestTable = manifest.tables.find((t) => t.name.toUpperCase() === tNameUpper);
        if (manifestTable) {
          const colDdl = manifestTable.columns
            .map((c) => {
              const colName = c.name.replace(/"/g, '""');
              const nullClause = c.nullable ? "" : " NOT NULL";
              return `"${colName}" ${mapOracleType(c.type)}${nullClause}`;
            })
            .join(", ");
          await dst.exec(`${ddl} "${tNameSafe}" (${colDdl})`);
          await dst.exec(
            `INSERT INTO "${tNameSafe}" SELECT * FROM read_parquet('${tmpEsc}')`,
          );
        } else {
          await dst.exec(
            `${ddl} "${tNameSafe}" AS SELECT * FROM read_parquet('${tmpEsc}')`,
          );
        }
        userTables.push(tNameSafe);
      }
    } finally {
      try { unlinkSync(tmp); } catch { /* best effort */ }
    }
  }

  return { manifest, userTables, systemTables };
}

/**
 * Read an ENCRYPTED .vsk file. Verifies the envelope is addressed to
 * `recipient`, unwraps the content key, decrypts the blob, then reads
 * the resulting plain .vsk into the destination DuckDB host.
 *
 * Supports both FORMAT_V1 (no AAD) and FORMAT_V2 (AAD-bound). The format
 * version is read from both the header and the envelope JSON block; they
 * must agree. For v2, AAD is reconstructed from sandboxId/sandboxVersion/
 * recipientPubkey stored in the plaintext envelope block.
 *
 * Throws VskFormatError("BAD_TAG") if the file is plaintext (caller
 * should use readVsk for those).
 */
export async function readEncryptedVsk(
  path: string,
  dst: DuckDBHost,
  senderPubkey: Uint8Array,
  recipient: Keypair,
  opts: ReadVskOptions = {},
  externalEnvelope?: Envelope,
): Promise<ReadVskResult> {
  const fileSize = statSync(path).size;
  if (fileSize > MAX_VSK_BYTES) {
    throw new VskFormatError("FILE_TOO_LARGE", `vsk: file exceeds ${MAX_VSK_BYTES} bytes`);
  }
  const file = readFileSync(path);
  const buf = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
  const header = readHeader(buf.subarray(0, HEADER_SIZE));
  if (header.envelopeLength === 0n) {
    throw new VskFormatError("BAD_TAG", "vsk: file is plaintext, use readVsk");
  }

  const envelopeOffset = Number(header.envelopeOffset);
  const envelopeLength = Number(header.envelopeLength);
  if (envelopeOffset + envelopeLength > buf.byteLength || envelopeLength > MAX_VSK_BYTES) {
    throw new VskFormatError("TRUNCATED_OR_INVALID:envelope", "vsk: envelope section exceeds file bounds");
  }
  const dataOff = Number(header.dataOffset);
  const dataLen = Number(header.dataLength);
  if (dataOff + dataLen > buf.byteLength || dataLen > MAX_VSK_BYTES) {
    throw new VskFormatError("TRUNCATED_OR_INVALID:data", "vsk: data section exceeds file bounds");
  }

  const envelopeJson = new TextDecoder().decode(
    buf.subarray(envelopeOffset, envelopeOffset + envelopeLength),
  );
  let meta: {
    nonce: string;
    ciphertext: string;
    blobNonce: string;
    formatVersion?: number;
    sandboxId?: string;
    sandboxVersion?: number;
    recipientPubkey?: string;
  };
  try {
    meta = JSON.parse(envelopeJson);
  } catch {
    throw new VskFormatError("MALFORMED_MANIFEST", "vsk: malformed envelope JSON");
  }

  const envelopeFmtVersion = meta.formatVersion ?? 1;
  const headerFmtVersion = header.formatVersion === 0 ? 1 : header.formatVersion;

  if (!isSupportedFormat(envelopeFmtVersion) || !isSupportedFormat(headerFmtVersion)) {
    throw new VskFormatError("UNSUPPORTED_FORMAT", `vsk: unsupported format version (envelope=${envelopeFmtVersion}, header=${headerFmtVersion})`);
  }

  const embeddedEnvelope: Envelope = {
    nonce: new Uint8Array(Buffer.from(meta.nonce, "base64")),
    ciphertext: new Uint8Array(Buffer.from(meta.ciphertext, "base64")),
  };
  const blobNonce = new Uint8Array(Buffer.from(meta.blobNonce, "base64"));

  const envelope = externalEnvelope ?? embeddedEnvelope;

  let envelopeAad: Uint8Array | undefined;
  let blobAad: Uint8Array | undefined;
  if (envelopeFmtVersion === FORMAT_V2) {
    if (!meta.sandboxId || meta.sandboxVersion === undefined || !meta.recipientPubkey) {
      throw new VskFormatError("MALFORMED_MANIFEST", "vsk: v2 envelope missing AAD context fields");
    }
    const recipientPubkey = pubkeyFromBase64(meta.recipientPubkey);
    envelopeAad = buildAad({
      sandboxId: meta.sandboxId,
      sandboxVersion: meta.sandboxVersion,
      recipientPubkey,
      formatVersion: FORMAT_V2,
    });
    blobAad = buildAad({
      sandboxId: meta.sandboxId,
      sandboxVersion: meta.sandboxVersion,
      recipientPubkey,
      formatVersion: FORMAT_V2,
    });
  }

  const contentKey = await openEnvelope(envelope, senderPubkey, recipient, envelopeAad ? { aad: envelopeAad } : {});
  const encryptedBlob = buf.subarray(dataOff, dataOff + dataLen);
  const plainBytes = await decryptBlob(contentKey, encryptedBlob, blobNonce, blobAad ? { aad: blobAad } : {});

  const tmpPath = join(
    tmpdir(),
    `vsk-decrypt-${process.pid}-${randomUUID()}.decrypted.tmp`,
  );
  writeFileSync(tmpPath, Buffer.from(plainBytes));
  try {
    return await readVsk(tmpPath, dst, opts);
  } finally {
    try { unlinkSync(tmpPath); } catch { /* best effort */ }
  }
}
