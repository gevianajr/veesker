import { describe, it, expect } from "bun:test";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DuckDBHost } from "../duckdb-host";
import { readVsk } from "./reader";
import { VSK_MAGIC, HEADER_SIZE } from "./header";

function makeDst(): DuckDBHost {
  return new DuckDBHost(":memory:");
}

function craftCorruptVsk(): Uint8Array {
  const buf = new Uint8Array(HEADER_SIZE + 10);
  const view = new DataView(buf.buffer);
  view.setUint32(0, VSK_MAGIC, false);
  view.setUint16(4, 1, true);
  view.setUint16(6, 1, true);
  // manifestOffset = HEADER_SIZE, manifestLength = 0xFFFFFFFF (way beyond file)
  view.setBigUint64(8, BigInt(HEADER_SIZE), true);
  view.setBigUint64(16, BigInt(0xFFFFFFFF), true);
  // dataOffset/Length = 0
  view.setBigUint64(24, BigInt(HEADER_SIZE), true);
  view.setBigUint64(32, 0n, true);
  return buf;
}

describe("readVsk bounds-checking", () => {
  it("rejects file with manifestLength exceeding file size", async () => {
    const corrupt = craftCorruptVsk();
    const tmpPath = join(tmpdir(), `vsk-corrupt-${randomUUID()}.vsk`);
    writeFileSync(tmpPath, Buffer.from(corrupt));
    const dst = makeDst();
    try {
      let caught: Error | undefined;
      try {
        await readVsk(tmpPath, dst);
      } catch (e) { caught = e as Error; }
      expect(caught).toBeDefined();
      expect((caught as { code?: string }).code ?? caught?.message).toMatch(/TRUNCATED|INVALID/);
    } finally {
      try { unlinkSync(tmpPath); } catch { /* best effort */ }
    }
  });
});
