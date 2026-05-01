// Public API for @veesker/engine.
export { DuckDBHost, DuckDBHostClosedError } from "./duckdb-host";
export { writeVsk } from "./vsk-format/writer";
export {
  readVsk,
  readVskHeader,
  readVskManifest,
} from "./vsk-format/reader";
export {
  type VskHeader,
  VSK_MAGIC,
  VSK_VERSION,
  HEADER_SIZE,
} from "./vsk-format/header";
export {
  type VskManifest,
  type VskTable,
  type VskColumn,
  type VskPiiMask,
  type VskMaskType,
  VSK_MASK_TYPES,
} from "./vsk-format/manifest";
export {
  VskFormatError,
  type VskFormatErrorCode,
  VSK_TABLE_NAME_RE,
  assertValidTableName,
} from "./vsk-format/errors";
export { mapOracleType, mapDuckDBType } from "./oracle-shim/types";
export { translate } from "./oracle-shim/translator";
export { installSystemViews } from "./oracle-shim/system-views";
