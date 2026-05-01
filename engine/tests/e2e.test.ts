import { describe, expect, it } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlinkSync } from "node:fs";

import { DuckDBHost } from "../src/duckdb-host";
import { writeVsk, writeEncryptedVsk } from "../src/vsk-format/writer";
import { readVsk, readEncryptedVsk } from "../src/vsk-format/reader";
import { translate } from "../src/oracle-shim/translator";
import { installSystemViews } from "../src/oracle-shim/system-views";
import { generateKeypair } from "../src/crypto/keypair";
import { randomKey } from "../src/crypto/blob";
import { sealEnvelope } from "../src/crypto/envelope";
import { sodiumReady } from "../src/crypto/sodium";

describe("end-to-end: build → encrypt → ship → decrypt → query Oracle SQL", () => {
  it("owner builds a sandbox; recipient queries it with Oracle dialect", async () => {
    await sodiumReady();
    const owner = await generateKeypair();
    const member = await generateKeypair();

    const plainPath = join(tmpdir(), `e2e-plain-${process.pid}-${Date.now()}.vsk`);
    const encPath = join(tmpdir(), `e2e-enc-${process.pid}-${Date.now()}.vsk`);

    // === OWNER SIDE: build the sandbox ===
    const ownerHost = await DuckDBHost.openInMemory();
    try {
      await ownerHost.exec(`
        CREATE TABLE orders (
          id BIGINT,
          customer_id BIGINT,
          total DECIMAL(18,2),
          placed_at TIMESTAMP
        )
      `);
      await ownerHost.exec(`
        INSERT INTO orders VALUES
          (1, 100, 49.90, '2026-04-29 10:00:00'),
          (2, 100, 120.50, '2026-04-30 11:00:00'),
          (3, 200, 9.99, '2026-04-30 14:00:00')
      `);

      // Write plaintext .vsk first (proves writeVsk + readVsk round-trip)
      await writeVsk(ownerHost, plainPath, {
        builtAt: new Date().toISOString(),
        sourceId: "oracle-prod",
        schemaName: "SALES",
        ttlExpiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        tables: [{
          name: "ORDERS",
          rowCount: 3,
          columns: [
            { name: "ID", type: "BIGINT", nullable: false },
            { name: "CUSTOMER_ID", type: "BIGINT", nullable: false },
            { name: "TOTAL", type: "DECIMAL(18,2)", nullable: true },
            { name: "PLACED_AT", type: "TIMESTAMP", nullable: true },
          ],
        }],
        piiMasks: [],
        engineVersion: "0.1.0",
        dataFormat: "parquet-streams-v1",
      });

      // Build the encrypted variant for member
      const tmpHost = await DuckDBHost.openInMemory();
      try {
        const manifest = await readVsk(plainPath, tmpHost);
        const contentKey = randomKey();
        const envelope = await sealEnvelope(contentKey, member.publicKey, owner);
        await writeEncryptedVsk(tmpHost, encPath, manifest, contentKey, envelope);
      } finally {
        await tmpHost.close();
      }
    } finally {
      await ownerHost.close();
    }

    // === MEMBER SIDE: pull encrypted file, decrypt, query with Oracle SQL ===
    const memberHost = await DuckDBHost.openInMemory();
    try {
      // Decrypt directly into memberHost
      const recoveredManifest = await readEncryptedVsk(
        encPath,
        memberHost,
        owner.publicKey,
        member,
      );
      expect(recoveredManifest.schemaName).toBe("SALES");
      expect(recoveredManifest.engineVersion).toBe("0.1.0");
      expect(recoveredManifest.tables.length).toBe(1);
      expect(recoveredManifest.tables[0]!.name).toBe("ORDERS");

      // Install system views so Oracle introspection queries work
      await installSystemViews(memberHost, recoveredManifest.schemaName);

      // === Oracle dialect query 1: GROUP BY with NVL ===
      const oracleSql = "SELECT NVL(customer_id, 0) AS cid, COUNT(*) AS n FROM orders GROUP BY customer_id ORDER BY cid";
      const translated = translate(oracleSql);
      const rows = await memberHost.query(translated);
      expect(rows.length).toBe(2);
      expect(Number(rows[0]!.cid)).toBe(100);
      expect(Number(rows[0]!.n)).toBe(2);
      expect(Number(rows[1]!.cid)).toBe(200);
      expect(Number(rows[1]!.n)).toBe(1);

      // === Oracle dialect query 2: SYSDATE FROM DUAL ===
      const dualResult = await memberHost.query(translate("SELECT SYSDATE AS now FROM DUAL"));
      expect(dualResult.length).toBe(1);

      // === Oracle dialect query 3: ROWNUM <= N ===
      const limitedResult = await memberHost.query(translate("SELECT * FROM orders WHERE ROWNUM <= 2"));
      expect(limitedResult.length).toBe(2);

      // === Oracle dialect query 4: TO_CHAR with format ===
      const formatted = await memberHost.query(
        translate("SELECT TO_CHAR(placed_at, 'YYYY-MM-DD') AS d FROM orders WHERE id = 1"),
      );
      expect(formatted.length).toBe(1);
      expect(formatted[0]!.d).toBe("2026-04-29");

      // === System view query against vsk_user_objects ===
      const objects = await memberHost.query(
        "SELECT object_name FROM vsk_user_objects WHERE object_type = 'TABLE' ORDER BY object_name",
      );
      expect(objects.map((r) => r.object_name)).toContain("ORDERS");

      // === System view query against vsk_user_tab_columns ===
      const cols = await memberHost.query(
        "SELECT column_name, data_type, nullable FROM vsk_user_tab_columns WHERE table_name = 'ORDERS' ORDER BY column_id",
      );
      expect(cols.length).toBe(4);
      expect(cols.map((c) => c.column_name)).toEqual([
        "ID", "CUSTOMER_ID", "TOTAL", "PLACED_AT",
      ]);
      // ID and CUSTOMER_ID were declared NOT NULL in the manifest — this checks
      // the readEncryptedVsk → readVsk path preserves nullability through encryption.
      const idCol = cols.find((c) => c.column_name === "ID");
      expect(idCol?.nullable).toBe("N");
      const totalCol = cols.find((c) => c.column_name === "TOTAL");
      expect(totalCol?.nullable).toBe("Y");
    } finally {
      await memberHost.close();
      try { unlinkSync(plainPath); } catch { /* best effort */ }
      try { unlinkSync(encPath); } catch { /* best effort */ }
    }
  }, 30_000); // 30s timeout — full pipeline can take a few seconds
});
