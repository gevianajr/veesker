// Public API for @veesker/engine.
export { DuckDBHost, DuckDBHostClosedError } from "./duckdb-host";
export { writeVsk, writeEncryptedVsk, type EncryptedVskAadContext } from "./vsk-format/writer";
export {
  readVsk,
  readVskHeader,
  readVskManifest,
  readEncryptedVsk,
  MAX_VSK_BYTES,
  type ReadVskOptions,
  type ReadVskResult,
} from "./vsk-format/reader";
export {
  type VskHeader,
  VSK_MAGIC,
  VSK_VERSION,
  HEADER_SIZE,
} from "./vsk-format/header";
export { FORMAT_V1, FORMAT_V2, CURRENT_FORMAT, isSupportedFormat } from "./vsk-format/version";
export {
  ENGINE_VERSION,
  type VskManifest,
  type VskTable,
  type VskColumn,
  type VskPiiMask,
  type VskMaskType,
  type VskSkippedObject,
  type SkippedReason,
  VSK_MASK_TYPES,
  SKIPPED_REASONS,
  writeManifest,
  readManifest,
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
// Crypto API (newly added by Phase B)
export { sodiumReady } from "./crypto/sodium";
export {
  generateKeypair,
  publicKeyFromPrivate,
  pubkeyToBase64,
  pubkeyFromBase64,
  type Keypair,
} from "./crypto/keypair";
export {
  type KeyStore,
  OsKeyringStore,
  InMemoryKeyStore,
} from "./crypto/keystore";
export {
  encryptBlob,
  decryptBlob,
  randomKey,
  type EncryptedBlob,
  type BlobOpts,
} from "./crypto/blob";
export { buildAad } from "./crypto/aad";
export {
  sealEnvelope,
  openEnvelope,
  sealForRecipients,
  type Envelope,
  type EnvelopeOpts,
  type Recipient,
  type SealedRecipient,
} from "./crypto/envelope";
