import { openSync, readSync, closeSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { readHeader, HEADER_SIZE } from "./header";
import { readManifest, type VskManifest } from "./manifest";
import { VskFormatError, assertValidTableName } from "./errors";
import { decryptBlob } from "../crypto/blob";
import { openEnvelope, type Envelope } from "../crypto/envelope";
import type { Keypair } from "../crypto/keypair";
import type { DuckDBHost } from "../duckdb-host";
import { mapOracleType } from "../oracle-shim/types";

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
  const parts = v.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    throw new VskFormatError("MALFORMED_MANIFEST", `vsk reader: unparseable engineVersion "${v}"`);
  }
  const [maj, min] = parts as [number, number, number];
  if (maj > 0 || (maj === 0 && min >= 3)) {
    throw new VskFormatError(
      "MALFORMED_MANIFEST",
      `vsk reader: engineVersion ${v} is newer than this reader (max 0.2.x). Upgrade @veesker/engine.`,
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
  const file = readFileSync(path);
  const buf = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
  const header = readHeader(buf.subarray(0, HEADER_SIZE));
  const manifest = readManifest(
    buf.subarray(
      Number(header.manifestOffset),
      Number(header.manifestOffset + header.manifestLength),
    ),
  );
  checkVersionFence(manifest);

  const dataStart = Number(header.dataOffset);
  const dataEnd = dataStart + Number(header.dataLength);
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
    if (!isSystem) assertValidTableName(tableName);
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
          const verb = opts.replace ? "CREATE OR REPLACE TABLE" : "CREATE TABLE";
          await dst.exec(`${verb} "${tNameSafe}" (${colDdl})`);
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
  const file = readFileSync(path);
  const buf = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
  const header = readHeader(buf.subarray(0, HEADER_SIZE));
  if (header.envelopeLength === 0n) {
    throw new VskFormatError("BAD_TAG", "vsk: file is plaintext, use readVsk");
  }

  const envelopeJson = new TextDecoder().decode(
    buf.subarray(
      Number(header.envelopeOffset),
      Number(header.envelopeOffset + header.envelopeLength),
    ),
  );
  let meta: { nonce: string; ciphertext: string; blobNonce: string };
  try {
    meta = JSON.parse(envelopeJson);
  } catch {
    throw new VskFormatError("MALFORMED_MANIFEST", "vsk: malformed envelope JSON");
  }
  const embeddedEnvelope: Envelope = {
    nonce: new Uint8Array(Buffer.from(meta.nonce, "base64")),
    ciphertext: new Uint8Array(Buffer.from(meta.ciphertext, "base64")),
  };
  const blobNonce = new Uint8Array(Buffer.from(meta.blobNonce, "base64"));

  const envelope = externalEnvelope ?? embeddedEnvelope;
  const contentKey = await openEnvelope(envelope, senderPubkey, recipient);
  const encryptedBlob = buf.subarray(
    Number(header.dataOffset),
    Number(header.dataOffset + header.dataLength),
  );
  const plainBytes = await decryptBlob(contentKey, encryptedBlob, blobNonce);

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
