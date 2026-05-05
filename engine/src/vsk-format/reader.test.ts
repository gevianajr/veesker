import { describe, it, expect } from "bun:test";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DuckDBHost } from "../duckdb-host";
import { readVsk, readEncryptedVsk } from "./reader";
import { writeEncryptedVsk } from "./writer";
import { VSK_MAGIC, HEADER_SIZE } from "./header";
import { generateKeypair, publicKeyFromPrivate } from "../crypto/keypair";
import { sealEnvelope } from "../crypto/envelope";
import { randomKey } from "../crypto/blob";
import { sodiumReady } from "../crypto/sodium";

async function makeDst(): Promise<DuckDBHost> {
  return DuckDBHost.openInMemory();
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

describe("dual-read: v1 round-trip", () => {
  it("v1 round-trip: reads .vsk written without aadContext", async () => {
    await sodiumReady();
    const ownerKp = await generateKeypair();
    const recipKp = await generateKeypair();
    const recipPub = publicKeyFromPrivate(recipKp.privateKey);
    const ownerPub = publicKeyFromPrivate(ownerKp.privateKey);
    const contentKey = randomKey();

    const envelope = await sealEnvelope(contentKey, recipPub, ownerKp);

    const src = await DuckDBHost.openInMemory();
    await src.exec("CREATE TABLE t1 (id INTEGER, val TEXT)");
    await src.exec("INSERT INTO t1 VALUES (1, 'hello')");

    const manifest = {
      builtAt: new Date().toISOString(),
      sourceId: "test-source",
      schemaName: "main",
      ttlExpiresAt: new Date(Date.now() + 86400_000).toISOString(),
      tables: [{
        name: "t1",
        rowCount: 1,
        columns: [
          { name: "id", type: "INTEGER", nullable: false },
          { name: "val", type: "TEXT", nullable: true },
        ],
      }],
      piiMasks: [],
    };
    const outPath = join(tmpdir(), `vsk-v1-roundtrip-${randomUUID()}.vsk`);
    try {
      // Write without aadContext → FORMAT_V1 file
      await writeEncryptedVsk(src, outPath, manifest, contentKey, envelope);

      const dst = await DuckDBHost.openInMemory();
      // Read without aadContext → dual-read path must handle v1 cleanly
      const result = await readEncryptedVsk(outPath, dst, ownerPub, recipKp);
      expect(result.userTables).toContain("t1");
      const rows = await dst.query("SELECT * FROM t1 ORDER BY id");
      expect(rows).toHaveLength(1);
      expect((rows[0] as { id: number; val: string }).val).toBe("hello");
    } finally {
      try { unlinkSync(outPath); } catch { /* best effort */ }
      await src.close();
    }
  });
});

describe("readVsk bounds-checking", () => {
  it("rejects file with manifestLength exceeding file size", async () => {
    const corrupt = craftCorruptVsk();
    const tmpPath = join(tmpdir(), `vsk-corrupt-${randomUUID()}.vsk`);
    writeFileSync(tmpPath, Buffer.from(corrupt));
    const dst = await makeDst();
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
