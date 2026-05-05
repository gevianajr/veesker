import { VskFormatError } from "./errors";

/**
 * `.vsk` manifest — JSON document describing a sandbox's contents.
 *
 * Lives at the byte range `[VskHeader.manifestOffset, manifestOffset + manifestLength)`
 * of every `.vsk` file. Serialized as UTF-8 JSON. The manifest is plaintext even when
 * the data section is encrypted; it carries no row data, only schema + recipe metadata.
 *
 * Fields:
 *   - `builtAt` / `ttlExpiresAt` — ISO-8601 strings (UTC)
 *   - `sourceId` — opaque identifier for the source system (e.g. an Oracle connection name)
 *   - `schemaName` — logical schema/owner the data was extracted from
 *   - `tables` — column-level schema for every materialized table
 *   - `piiMasks` — record of masks applied at build time (informational; does not unmask)
 */

export const VSK_MASK_TYPES = ["hash", "redact", "static", "partial"] as const;
export type VskMaskType = typeof VSK_MASK_TYPES[number];

export const ENGINE_VERSION = "0.3.0";

export const SKIPPED_REASONS = ["INVALID", "NO_PRIVILEGE", "EXTRACTION_ERROR"] as const;
export type SkippedReason = typeof SKIPPED_REASONS[number];

export interface VskColumn {
  name: string;
  type: string;
  nullable: boolean;
}

export interface VskTable {
  name: string;
  rowCount: number;
  columns: VskColumn[];
}

export interface VskPiiMask {
  table: string;
  column: string;
  maskType: VskMaskType;
}

export interface VskSkippedObject {
  kind: string;
  owner: string;
  name: string;
  reason: SkippedReason;
  detail?: string;
}

export interface VskManifest {
  builtAt: string;
  sourceId: string;
  schemaName: string;
  ttlExpiresAt: string;
  tables: VskTable[];
  piiMasks: VskPiiMask[];
  /** Optional. The `@veesker/engine` version that wrote this manifest. Future
   *  readers may use this to gate compatibility checks (e.g. SQL-translator
   *  semantic changes). Absent in early sandboxes — readers MUST tolerate. */
  engineVersion?: string;
  /** Optional. The on-disk data-section format. Defaults to `"parquet-streams-v1"`
   *  when absent (backwards compatibility). New formats add new tags here without
   *  bumping the file-header version. */
  dataFormat?: string;
  /** Total PL/SQL objects packed into __vsk_objects. v0.2.0+. */
  plsqlObjectCount?: number;
  /** Objects discovered by the dependency walk but skipped during DDL
   *  extraction. v0.2.0+. */
  skippedObjects?: VskSkippedObject[];
}

export function writeManifest(m: VskManifest): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(m));
}

export function readManifest(buf: Uint8Array): VskManifest {
  const text = new TextDecoder().decode(buf);
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch (err) {
    throw new VskFormatError("MALFORMED_MANIFEST", `vsk manifest: malformed JSON (${(err as Error).message})`);
  }
  if (!isManifest(obj)) {
    throw new VskFormatError("MALFORMED_MANIFEST", "vsk manifest: malformed (missing or wrongly-typed required fields)");
  }
  return obj;
}

function isManifest(x: unknown): x is VskManifest {
  if (typeof x !== "object" || x === null) return false;
  const m = x as Record<string, unknown>;
  if (typeof m.builtAt !== "string") return false;
  if (typeof m.sourceId !== "string") return false;
  if (typeof m.schemaName !== "string") return false;
  if (typeof m.ttlExpiresAt !== "string") return false;
  if (!Array.isArray(m.tables)) return false;
  if (!Array.isArray(m.piiMasks)) return false;
  if (m.engineVersion !== undefined && typeof m.engineVersion !== "string") return false;
  if (m.dataFormat !== undefined && typeof m.dataFormat !== "string") return false;
  if (m.plsqlObjectCount !== undefined && (typeof m.plsqlObjectCount !== "number" || !Number.isInteger(m.plsqlObjectCount) || m.plsqlObjectCount < 0)) return false;
  if (m.skippedObjects !== undefined) {
    if (!Array.isArray(m.skippedObjects)) return false;
    for (const s of m.skippedObjects) if (!isSkipped(s)) return false;
  }
  for (const t of m.tables) if (!isTable(t)) return false;
  for (const p of m.piiMasks) if (!isMask(p)) return false;
  return true;
}

function isSkipped(x: unknown): x is VskSkippedObject {
  if (typeof x !== "object" || x === null) return false;
  const s = x as Record<string, unknown>;
  if (typeof s.kind !== "string") return false;
  if (typeof s.owner !== "string") return false;
  if (typeof s.name !== "string") return false;
  if (typeof s.reason !== "string") return false;
  if (!SKIPPED_REASONS.includes(s.reason as SkippedReason)) return false;
  if (s.detail !== undefined && typeof s.detail !== "string") return false;
  return true;
}

function isTable(x: unknown): x is VskTable {
  if (typeof x !== "object" || x === null) return false;
  const t = x as Record<string, unknown>;
  if (typeof t.name !== "string") return false;
  if (typeof t.rowCount !== "number") return false;
  if (!Array.isArray(t.columns)) return false;
  for (const c of t.columns) {
    if (typeof c !== "object" || c === null) return false;
    const col = c as Record<string, unknown>;
    if (typeof col.name !== "string") return false;
    if (typeof col.type !== "string") return false;
    if (typeof col.nullable !== "boolean") return false;
  }
  return true;
}

function isMask(x: unknown): x is VskPiiMask {
  if (typeof x !== "object" || x === null) return false;
  const m = x as Record<string, unknown>;
  if (typeof m.table !== "string") return false;
  if (typeof m.column !== "string") return false;
  if (typeof m.maskType !== "string") return false;
  if (!VSK_MASK_TYPES.includes(m.maskType as VskMaskType)) return false;
  return true;
}
