export const VSK_MAGIC = 0x56534b21; // "VSK!"
export const VSK_VERSION = 1;
export const HEADER_SIZE = 64;

export interface VskHeader {
  magic: number;
  version: number;
  manifestOffset: bigint;
  manifestLength: bigint;
  dataOffset: bigint;
  dataLength: bigint;
  envelopeOffset: bigint;
  envelopeLength: bigint;
}

export function writeHeader(fields: Omit<VskHeader, "magic" | "version">): Uint8Array {
  const buf = new Uint8Array(HEADER_SIZE);
  const view = new DataView(buf.buffer);
  view.setUint32(0, VSK_MAGIC, true);
  view.setUint16(4, VSK_VERSION, true);
  view.setBigUint64(8, fields.manifestOffset, true);
  view.setBigUint64(16, fields.manifestLength, true);
  view.setBigUint64(24, fields.dataOffset, true);
  view.setBigUint64(32, fields.dataLength, true);
  view.setBigUint64(40, fields.envelopeOffset, true);
  view.setBigUint64(48, fields.envelopeLength, true);
  return buf;
}

export function readHeader(buf: Uint8Array): VskHeader {
  if (buf.byteLength < HEADER_SIZE) {
    throw new Error(`vsk header truncated: got ${buf.byteLength}, expected ${HEADER_SIZE}`);
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== VSK_MAGIC) {
    throw new Error(`vsk: bad magic bytes (got 0x${magic.toString(16)})`);
  }
  const version = view.getUint16(4, true);
  if (version !== VSK_VERSION) {
    throw new Error(`vsk: unsupported version ${version} (engine supports ${VSK_VERSION})`);
  }
  return {
    magic,
    version,
    manifestOffset: view.getBigUint64(8, true),
    manifestLength: view.getBigUint64(16, true),
    dataOffset: view.getBigUint64(24, true),
    dataLength: view.getBigUint64(32, true),
    envelopeOffset: view.getBigUint64(40, true),
    envelopeLength: view.getBigUint64(48, true),
  };
}
