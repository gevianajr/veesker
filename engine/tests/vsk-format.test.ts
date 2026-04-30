import { describe, expect, it } from "bun:test";
import { writeHeader, readHeader, VSK_MAGIC, VSK_VERSION } from "../src/vsk-format/header";

describe("vsk-format header", () => {
  it("round-trips a header", () => {
    const buf = writeHeader({
      manifestOffset: 1024n,
      manifestLength: 256n,
      dataOffset: 1280n,
      dataLength: 4096n,
      envelopeOffset: 0n,
      envelopeLength: 0n,
    });
    expect(buf.byteLength).toBe(64);
    const parsed = readHeader(buf);
    expect(parsed.magic).toBe(VSK_MAGIC);
    expect(parsed.version).toBe(VSK_VERSION);
    expect(parsed.manifestOffset).toBe(1024n);
    expect(parsed.dataLength).toBe(4096n);
  });

  it("rejects bad magic bytes", () => {
    const buf = new Uint8Array(64);
    buf.set([0x00, 0x00, 0x00, 0x00], 0);
    expect(() => readHeader(buf)).toThrow(/magic/i);
  });

  it("rejects unsupported version", () => {
    const buf = writeHeader({
      manifestOffset: 0n, manifestLength: 0n,
      dataOffset: 0n, dataLength: 0n,
      envelopeOffset: 0n, envelopeLength: 0n,
    });
    new DataView(buf.buffer).setUint16(4, 999, true);
    expect(() => readHeader(buf)).toThrow(/version/i);
  });
});
