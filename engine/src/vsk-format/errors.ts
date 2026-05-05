/**
 * Typed errors thrown by `.vsk` format readers/writers. Use `code` to
 * distinguish failure modes without string-matching messages.
 */

export type VskFormatErrorCode =
  | "TRUNCATED"
  | "BAD_MAGIC"
  | "BAD_VERSION"
  | "BAD_TAG"
  | "BAD_TABLE_NAME"
  | "MALFORMED_MANIFEST"
  | "UNSUPPORTED_FORMAT"
  | "FILE_TOO_LARGE"
  | `TRUNCATED_OR_INVALID:${string}`;

export class VskFormatError extends Error {
  constructor(public code: VskFormatErrorCode, message: string) {
    super(message);
    this.name = "VskFormatError";
  }
}

/**
 * Allowlist for `.vsk` table names. Mirrors a conservative SQL identifier
 * subset: must start with letter or underscore, then up to 127 more letters,
 * digits, underscores, or dollar signs. Max 128 chars.
 *
 * Rejecting anything else prevents:
 *  - Path traversal via `name = "../../../etc/passwd"` when the reader
 *    creates a tmp parquet file path from the manifest.
 *  - Frame corruption from `\n` (used as the in-frame tag terminator)
 *    or `\0` (used by some filesystems as a path terminator).
 *  - DDL injection through identifier escapes.
 */
export const VSK_TABLE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_$]{0,127}$/;

export function assertValidTableName(name: string): void {
  if (!VSK_TABLE_NAME_RE.test(name)) {
    throw new VskFormatError(
      "BAD_TABLE_NAME",
      `vsk: invalid table name (must match ${VSK_TABLE_NAME_RE.source}, got ${JSON.stringify(name).slice(0, 80)})`,
    );
  }
}
