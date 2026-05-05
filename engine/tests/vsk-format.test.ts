import { describe, expect, it } from "bun:test";
import { writeHeader, readHeader, VSK_MAGIC, VSK_VERSION } from "../src/vsk-format/header";
import { writeManifest, readManifest, VSK_MASK_TYPES, ENGINE_VERSION, type VskManifest } from "../src/vsk-format/manifest";
import { writeVsk, writeEncryptedVsk } from "../src/vsk-format/writer";
import { readVsk, readEncryptedVsk } from "../src/vsk-format/reader";
import { readVskHeader, readVskManifest } from "../src/vsk-format/reader";
import { VskFormatError } from "../src/vsk-format/errors";
import { DuckDBHost } from "../src/duckdb-host";
import { generateKeypair } from "../src/crypto/keypair";
import { randomKey } from "../src/crypto/blob";
import { sealEnvelope } from "../src/crypto/envelope";
import { sodiumReady } from "../src/crypto/sodium";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlinkSync, existsSync, mkdtempSync, rmSync } from "node:fs";

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

  it("writes magic so the on-disk bytes spell 'VSK!' in ASCII", () => {
    const buf = writeHeader({
      manifestOffset: 0n, manifestLength: 0n,
      dataOffset: 0n, dataLength: 0n,
      envelopeOffset: 0n, envelopeLength: 0n,
    });
    expect(buf[0]).toBe(0x56); // 'V'
    expect(buf[1]).toBe(0x53); // 'S'
    expect(buf[2]).toBe(0x4b); // 'K'
    expect(buf[3]).toBe(0x21); // '!'
  });

  it("rejects bad magic bytes", () => {
    const buf = new Uint8Array(64);
    new DataView(buf.buffer).setUint16(4, VSK_VERSION, true);
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

  it("rejects a buffer smaller than HEADER_SIZE", () => {
    expect(() => readHeader(new Uint8Array(63))).toThrow(/truncated/i);
    expect(() => readHeader(new Uint8Array(0))).toThrow(/truncated/i);
  });

  it("reads a header from a sliced view in a larger buffer", () => {
    const headerBytes = writeHeader({
      manifestOffset: 4242n, manifestLength: 100n,
      dataOffset: 5000n, dataLength: 99999n,
      envelopeOffset: 0n, envelopeLength: 0n,
    });
    const big = new Uint8Array(256);
    big.set(headerBytes, 100);
    const slice = big.subarray(100, 100 + 64);
    const parsed = readHeader(slice);
    expect(parsed.manifestOffset).toBe(4242n);
    expect(parsed.dataLength).toBe(99999n);
  });
});

describe("vsk-format manifest", () => {
  const sample: VskManifest = {
    builtAt: "2026-04-30T12:00:00.000Z",
    sourceId: "oracle-prod-1",
    schemaName: "ORDERS_OWNER",
    ttlExpiresAt: "2026-05-07T12:00:00.000Z",
    tables: [
      {
        name: "ORDERS",
        rowCount: 12345,
        columns: [
          { name: "ID", type: "BIGINT", nullable: false },
          { name: "TOTAL", type: "DECIMAL(18,2)", nullable: true },
        ],
      },
    ],
    piiMasks: [{ table: "ORDERS", column: "EMAIL", maskType: "hash" }],
  };

  it("round-trips a manifest", () => {
    const buf = writeManifest(sample);
    const parsed = readManifest(buf);
    expect(parsed).toEqual(sample);
  });

  it("rejects malformed JSON", () => {
    expect(() => readManifest(new TextEncoder().encode("{not json"))).toThrow();
  });

  it("rejects a manifest missing required fields", () => {
    const noTables = JSON.stringify({ builtAt: "x", sourceId: "y", schemaName: "z", ttlExpiresAt: "w", piiMasks: [] });
    expect(() => readManifest(new TextEncoder().encode(noTables))).toThrow(/malformed/i);

    const wrongType = JSON.stringify({ ...sample, builtAt: 42 });
    expect(() => readManifest(new TextEncoder().encode(wrongType))).toThrow(/malformed/i);
  });

  it("preserves unicode in schema and table names", () => {
    const unicode: VskManifest = {
      ...sample,
      schemaName: "PEDIDOS_ÇÃO",
      tables: [{ ...sample.tables[0]!, name: "CLIENTÉS", columns: sample.tables[0]!.columns }],
    };
    const parsed = readManifest(writeManifest(unicode));
    expect(parsed.schemaName).toBe("PEDIDOS_ÇÃO");
    expect(parsed.tables[0]!.name).toBe("CLIENTÉS");
  });

  it("accepts a manifest with optional engineVersion and dataFormat", () => {
    const withProvenance: VskManifest = {
      ...sample,
      engineVersion: "0.1.0",
      dataFormat: "parquet-streams-v1",
    };
    const parsed = readManifest(writeManifest(withProvenance));
    expect(parsed.engineVersion).toBe("0.1.0");
    expect(parsed.dataFormat).toBe("parquet-streams-v1");
  });

  it("rejects engineVersion of wrong type", () => {
    const bad = JSON.stringify({ ...sample, engineVersion: 42 });
    expect(() => readManifest(new TextEncoder().encode(bad))).toThrow(/malformed/i);
  });

  it("rejects an unknown maskType", () => {
    const bad = JSON.stringify({ ...sample, piiMasks: [{ table: "ORDERS", column: "EMAIL", maskType: "shuffle" }] });
    expect(() => readManifest(new TextEncoder().encode(bad))).toThrow(/malformed/i);
  });

  it("accepts an empty tables array and empty piiMasks", () => {
    const empty: VskManifest = { ...sample, tables: [], piiMasks: [] };
    const parsed = readManifest(writeManifest(empty));
    expect(parsed.tables).toEqual([]);
    expect(parsed.piiMasks).toEqual([]);
  });

  it("exposes VSK_MASK_TYPES as a const tuple", () => {
    expect(VSK_MASK_TYPES).toEqual(["hash", "redact", "static", "partial"]);
  });
});

describe("vsk-format writer + reader", () => {
  it("writes then reads back a sandbox", async () => {
    const path = join(tmpdir(), `vsk-test-${process.pid}-${Date.now()}.vsk`);
    const src = await DuckDBHost.openInMemory();
    try {
      await src.exec("CREATE TABLE customers (id INT, name VARCHAR)");
      await src.exec("INSERT INTO customers VALUES (1,'alice'),(2,'bob')");

      await writeVsk(src, path, {
        builtAt: new Date().toISOString(),
        sourceId: "test",
        schemaName: "TEST",
        ttlExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        tables: [{
          name: "CUSTOMERS",
          rowCount: 2,
          columns: [
            { name: "ID", type: "INTEGER", nullable: false },
            { name: "NAME", type: "VARCHAR", nullable: true },
          ],
        }],
        piiMasks: [],
      });

      expect(existsSync(path)).toBe(true);

      const dst = await DuckDBHost.openInMemory();
      try {
        const { manifest: m } = await readVsk(path, dst);
        expect(m.tables.length).toBe(1);
        const rows = await dst.query("SELECT * FROM customers ORDER BY id");
        expect(rows).toEqual([
          { ID: 1, NAME: "alice" },
          { ID: 2, NAME: "bob" },
        ]);
      } finally {
        await dst.close();
      }
    } finally {
      await src.close();
      try { unlinkSync(path); } catch { /* best effort */ }
    }
  });

  it("handles multiple tables in one .vsk", async () => {
    const path = join(tmpdir(), `vsk-multi-${process.pid}-${Date.now()}.vsk`);
    const src = await DuckDBHost.openInMemory();
    try {
      await src.exec("CREATE TABLE orders (id INT, total DECIMAL(10,2))");
      await src.exec("INSERT INTO orders VALUES (1, 100.50), (2, 250.75)");
      await src.exec("CREATE TABLE customers (id INT, name VARCHAR)");
      await src.exec("INSERT INTO customers VALUES (1,'alice')");

      await writeVsk(src, path, {
        builtAt: new Date().toISOString(),
        sourceId: "test",
        schemaName: "TEST",
        ttlExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        tables: [
          { name: "ORDERS", rowCount: 2, columns: [
            { name: "ID", type: "INTEGER", nullable: false },
            { name: "TOTAL", type: "DECIMAL(10,2)", nullable: true },
          ]},
          { name: "CUSTOMERS", rowCount: 1, columns: [
            { name: "ID", type: "INTEGER", nullable: false },
            { name: "NAME", type: "VARCHAR", nullable: true },
          ]},
        ],
        piiMasks: [],
      });

      const dst = await DuckDBHost.openInMemory();
      try {
        await readVsk(path, dst);
        const orderCount = await dst.query("SELECT COUNT(*) AS n FROM orders");
        expect(Number(orderCount[0]!.n)).toBe(2);
        const custCount = await dst.query("SELECT COUNT(*) AS n FROM customers");
        expect(Number(custCount[0]!.n)).toBe(1);
      } finally {
        await dst.close();
      }
    } finally {
      await src.close();
      try { unlinkSync(path); } catch { /* best effort */ }
    }
  });

  it("preserves manifest fields exactly through round-trip", async () => {
    const path = join(tmpdir(), `vsk-manifest-${process.pid}-${Date.now()}.vsk`);
    const src = await DuckDBHost.openInMemory();
    try {
      await src.exec("CREATE TABLE t (id INT)");
      const original = {
        builtAt: "2026-04-30T15:00:00.000Z",
        sourceId: "oracle-prod-7",
        schemaName: "MY_SCHEMA",
        ttlExpiresAt: "2026-05-30T15:00:00.000Z",
        tables: [{ name: "T", rowCount: 0, columns: [{ name: "ID", type: "INTEGER", nullable: false }] }],
        piiMasks: [],
        engineVersion: "0.1.0",
        dataFormat: "parquet-streams-v1",
      };
      await writeVsk(src, path, original);

      const dst = await DuckDBHost.openInMemory();
      try {
        const { manifest: recovered } = await readVsk(path, dst);
        expect(recovered).toEqual(original);
      } finally {
        await dst.close();
      }
    } finally {
      await src.close();
      try { unlinkSync(path); } catch { /* best effort */ }
    }
  });

  it("preserves NOT NULL constraints across writeVsk → readVsk", async () => {
    const path = join(tmpdir(), `vsk-notnull-${process.pid}-${Date.now()}.vsk`);
    const src = await DuckDBHost.openInMemory();
    try {
      await src.exec("CREATE TABLE t (id INTEGER NOT NULL, label VARCHAR)");
      await src.exec("INSERT INTO t VALUES (1, 'a')");
      await writeVsk(src, path, {
        builtAt: new Date().toISOString(),
        sourceId: "x",
        schemaName: "x",
        ttlExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        tables: [{ name: "T", rowCount: 1, columns: [
          { name: "ID", type: "INTEGER", nullable: false },
          { name: "LABEL", type: "VARCHAR", nullable: true },
        ] }],
        piiMasks: [],
      });

      const dst = await DuckDBHost.openInMemory();
      try {
        await readVsk(path, dst);
        const cols = await dst.query(
          "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name='t' ORDER BY ordinal_position",
        );
        expect(cols).toEqual([
          { column_name: "ID", is_nullable: "NO" },
          { column_name: "LABEL", is_nullable: "YES" },
        ]);
      } finally {
        await dst.close();
      }
    } finally {
      await src.close();
      try { unlinkSync(path); } catch { /* best effort */ }
    }
  });

  // Regression: the manifest stores raw Oracle types (VARCHAR2, NUMBER, DATE)
  // because the owner UI shows them and the writeVsk-time DuckDB stage already
  // materializes the data. The reader has to translate them through
  // mapOracleType before the CREATE TABLE statement, otherwise DuckDB rejects
  // the DDL with "Type with name VARCHAR2 does not exist!". This locks the
  // contract so any future refactor that bypasses mapOracleType breaks here.
  it("translates Oracle types in the manifest to DuckDB equivalents on read", async () => {
    const path = join(tmpdir(), `vsk-oracletype-${process.pid}-${Date.now()}.vsk`);
    const src = await DuckDBHost.openInMemory();
    try {
      // The DuckDB staging table is created with DuckDB-native types so the
      // parquet round-trip works; only the manifest carries the Oracle names.
      await src.exec("CREATE TABLE countries (country_id VARCHAR NOT NULL, country_name VARCHAR, region_id DOUBLE)");
      await src.exec("INSERT INTO countries VALUES ('BR', 'Brazil', 1)");
      await writeVsk(src, path, {
        builtAt: new Date().toISOString(),
        sourceId: "x",
        schemaName: "HR",
        ttlExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        tables: [{ name: "COUNTRIES", rowCount: 1, columns: [
          { name: "COUNTRY_ID", type: "CHAR(2)", nullable: false },
          { name: "COUNTRY_NAME", type: "VARCHAR2(40)", nullable: true },
          { name: "REGION_ID", type: "NUMBER", nullable: true },
        ] }],
        piiMasks: [],
      });

      const dst = await DuckDBHost.openInMemory();
      try {
        await readVsk(path, dst);
        const rows = await dst.query('SELECT "COUNTRY_ID", "COUNTRY_NAME", "REGION_ID" FROM countries');
        expect(rows).toEqual([{ COUNTRY_ID: "BR", COUNTRY_NAME: "Brazil", REGION_ID: 1 }]);
        const cols = await dst.query(
          "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='countries' ORDER BY ordinal_position",
        );
        expect(cols).toEqual([
          { column_name: "COUNTRY_ID", data_type: "VARCHAR" },
          { column_name: "COUNTRY_NAME", data_type: "VARCHAR" },
          { column_name: "REGION_ID", data_type: "DOUBLE" },
        ]);
      } finally {
        await dst.close();
      }
    } finally {
      await src.close();
      try { unlinkSync(path); } catch { /* best effort */ }
    }
  });
});

describe("writer v0.2.0 — __vsk_* tables", () => {
  it("writes __vsk_objects + __vsk_source after user tables when present", async () => {
    const host = await DuckDBHost.openInMemory();
    try {
      await host.exec(`CREATE TABLE "users" (id INTEGER, name VARCHAR)`);
      await host.exec(`INSERT INTO "users" VALUES (1, 'Alice')`);
      await host.exec(`CREATE TABLE "__vsk_objects" (kind VARCHAR, owner VARCHAR, name VARCHAR, status VARCHAR, ddl_size_bytes BIGINT, extracted_at TIMESTAMP, PRIMARY KEY (kind, owner, name))`);
      await host.exec(`INSERT INTO "__vsk_objects" VALUES ('PROCEDURE', 'HR', 'GET_EMP', 'VALID', 256, '2026-05-04 12:00:00')`);
      await host.exec(`CREATE TABLE "__vsk_source" (kind VARCHAR, owner VARCHAR, name VARCHAR, ddl TEXT, spec TEXT, body TEXT, PRIMARY KEY (kind, owner, name))`);
      await host.exec(`INSERT INTO "__vsk_source" VALUES ('PROCEDURE', 'HR', 'GET_EMP', 'CREATE PROCEDURE get_emp AS BEGIN NULL; END;', NULL, NULL)`);

      const out = join(tmpdir(), `vsk-write-test-${Date.now()}.vsk`);
      const m: VskManifest = {
        builtAt: "2026-05-04T00:00:00.000Z",
        sourceId: "x", schemaName: "HR",
        ttlExpiresAt: "2026-06-04T00:00:00.000Z",
        tables: [{ name: "users", rowCount: 1, columns: [
          { name: "id", type: "NUMBER", nullable: true },
          { name: "name", type: "VARCHAR2", nullable: true },
        ]}],
        piiMasks: [],
        engineVersion: "0.2.0",
        plsqlObjectCount: 1,
      };
      try {
        await writeVsk(host, out, m);
        // Read back via existing readVsk, verify 3 tables (1 user + 2 system)
        const dst = await DuckDBHost.openInMemory();
        try {
          await readVsk(out, dst);
          const tablesRes = await dst.query(
            `SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name`
          );
          // Note: the test asserts tables are present after readVsk, even though
          // the v0.1.0 readVsk doesn't yet split user vs system. Task 3 splits
          // them; here we just verify writer emitted bytes for both.
          const names = tablesRes.map((r) => r["table_name"] as string);
          expect(names).toContain("users");
          expect(names).toContain("__vsk_objects");
          expect(names).toContain("__vsk_source");
        } finally {
          await dst.close();
        }
      } finally {
        if (existsSync(out)) unlinkSync(out);
      }
    } finally {
      await host.close();
    }
  });

  it("skips __vsk_* writing when source DuckDB has no __vsk_* tables", async () => {
    const host = await DuckDBHost.openInMemory();
    try {
      await host.exec(`CREATE TABLE "u" (a INT)`);
      const out = join(tmpdir(), `vsk-write-test-v1-${Date.now()}.vsk`);
      const m: VskManifest = {
        builtAt: "2026-05-04T00:00:00.000Z",
        sourceId: "x", schemaName: "X",
        ttlExpiresAt: "2026-06-04T00:00:00.000Z",
        tables: [{ name: "u", rowCount: 0, columns: [{ name: "a", type: "NUMBER", nullable: true }] }],
        piiMasks: [],
      };
      try {
        await writeVsk(host, out, m);
        const dst = await DuckDBHost.openInMemory();
        try {
          await readVsk(out, dst);
          const r = await dst.query(
            `SELECT count(*) FROM information_schema.tables WHERE table_schema = 'main' AND table_name LIKE '__vsk_%'`
          );
          expect(Number(Object.values(r[0]!)[0])).toBe(0);
        } finally {
          await dst.close();
        }
      } finally {
        if (existsSync(out)) unlinkSync(out);
      }
    } finally {
      await host.close();
    }
  });
});

describe("vsk-format safety + edge cases", () => {
  it("writer rejects an unsafe table name in the manifest", async () => {
    const src = await DuckDBHost.openInMemory();
    try {
      const path = join(tmpdir(), `vsk-unsafe-${process.pid}-${Date.now()}.vsk`);
      await expect(writeVsk(src, path, {
        builtAt: new Date().toISOString(),
        sourceId: "x",
        schemaName: "x",
        ttlExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        tables: [{ name: "../../../etc/passwd", rowCount: 0, columns: [{ name: "ID", type: "INTEGER", nullable: false }] }],
        piiMasks: [],
      })).rejects.toThrow(/invalid table name/i);
      expect(existsSync(path)).toBe(false);
    } finally {
      await src.close();
    }
  });

  it("writer rejects a manifest user-table that collides with the __vsk_ prefix", async () => {
    const src = await DuckDBHost.openInMemory();
    try {
      const path = join(tmpdir(), `vsk-collide-${process.pid}-${Date.now()}.vsk`);
      // Today assertValidTableName already rejects names starting with "__",
      // so this guard is unreachable through the current name validator. The
      // explicit collision check in writeVsk hardens the invariant against
      // future relaxations of that regex — this test pins it.
      await expect(writeVsk(src, path, {
        builtAt: new Date().toISOString(),
        sourceId: "x",
        schemaName: "x",
        ttlExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        tables: [{ name: "__vsk_objects", rowCount: 0, columns: [{ name: "ID", type: "INTEGER", nullable: false }] }],
        piiMasks: [],
      })).rejects.toThrow(/(invalid table name|collides with reserved __vsk_ prefix)/i);
      expect(existsSync(path)).toBe(false);
    } finally {
      await src.close();
    }
  });

  it("writer rejects a table name with a newline", async () => {
    const src = await DuckDBHost.openInMemory();
    try {
      const path = join(tmpdir(), `vsk-nl-${process.pid}-${Date.now()}.vsk`);
      await expect(writeVsk(src, path, {
        builtAt: new Date().toISOString(),
        sourceId: "x",
        schemaName: "x",
        ttlExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        tables: [{ name: "ORDERS\nDROP", rowCount: 0, columns: [{ name: "ID", type: "INTEGER", nullable: false }] }],
        piiMasks: [],
      })).rejects.toThrow(/invalid table name/i);
    } finally {
      await src.close();
    }
  });

  it("readVsk supports replace: true to overwrite existing tables", async () => {
    const path = join(tmpdir(), `vsk-replace-${process.pid}-${Date.now()}.vsk`);
    const src = await DuckDBHost.openInMemory();
    try {
      await src.exec("CREATE TABLE t (id INT)");
      await src.exec("INSERT INTO t VALUES (42)");
      await writeVsk(src, path, {
        builtAt: new Date().toISOString(),
        sourceId: "x",
        schemaName: "x",
        ttlExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        tables: [{ name: "T", rowCount: 1, columns: [{ name: "ID", type: "INTEGER", nullable: false }] }],
        piiMasks: [],
      });

      const dst = await DuckDBHost.openInMemory();
      try {
        await dst.exec("CREATE TABLE t (id INT)");
        await expect(readVsk(path, dst)).rejects.toThrow();
        await readVsk(path, dst, { replace: true });
        const rows = await dst.query("SELECT id FROM t");
        expect(rows).toEqual([{ ID: 42 }]);
      } finally {
        await dst.close();
      }
    } finally {
      await src.close();
      try { unlinkSync(path); } catch { /* best effort */ }
    }
  });

  it("round-trips an empty tables array", async () => {
    const path = join(tmpdir(), `vsk-empty-${process.pid}-${Date.now()}.vsk`);
    const src = await DuckDBHost.openInMemory();
    try {
      await writeVsk(src, path, {
        builtAt: new Date().toISOString(),
        sourceId: "x",
        schemaName: "x",
        ttlExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        tables: [],
        piiMasks: [],
      });
      const dst = await DuckDBHost.openInMemory();
      try {
        const { manifest: m } = await readVsk(path, dst);
        expect(m.tables).toEqual([]);
      } finally {
        await dst.close();
      }
    } finally {
      await src.close();
      try { unlinkSync(path); } catch { /* best effort */ }
    }
  });

  it("round-trips a 0-row table", async () => {
    const path = join(tmpdir(), `vsk-zero-${process.pid}-${Date.now()}.vsk`);
    const src = await DuckDBHost.openInMemory();
    try {
      await src.exec("CREATE TABLE empty (id INT, label VARCHAR)");
      await writeVsk(src, path, {
        builtAt: new Date().toISOString(),
        sourceId: "x",
        schemaName: "x",
        ttlExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        tables: [{ name: "EMPTY", rowCount: 0, columns: [
          { name: "ID", type: "INTEGER", nullable: false },
          { name: "LABEL", type: "VARCHAR", nullable: true },
        ] }],
        piiMasks: [],
      });
      const dst = await DuckDBHost.openInMemory();
      try {
        await readVsk(path, dst);
        const rows = await dst.query("SELECT * FROM empty");
        expect(rows).toEqual([]);
      } finally {
        await dst.close();
      }
    } finally {
      await src.close();
      try { unlinkSync(path); } catch { /* best effort */ }
    }
  });

  it("readVskHeader does not load the whole file (smoke)", async () => {
    const path = join(tmpdir(), `vsk-cheap-header-${process.pid}-${Date.now()}.vsk`);
    const src = await DuckDBHost.openInMemory();
    try {
      await src.exec("CREATE TABLE t (id INT)");
      await src.exec("INSERT INTO t SELECT range FROM range(0, 100)");
      await writeVsk(src, path, {
        builtAt: "2026-04-30T12:00:00.000Z",
        sourceId: "x",
        schemaName: "X",
        ttlExpiresAt: "2026-05-07T12:00:00.000Z",
        tables: [{ name: "T", rowCount: 100, columns: [{ name: "ID", type: "INTEGER", nullable: false }] }],
        piiMasks: [],
      });
      const header = readVskHeader(path);
      expect(header.version).toBe(1);
      const m = readVskManifest(path);
      expect(m.schemaName).toBe("X");
    } finally {
      await src.close();
      try { unlinkSync(path); } catch { /* best effort */ }
    }
  });

  it("VskFormatError is thrown with the right code on bad magic", () => {
    const buf = new Uint8Array(64);
    new DataView(buf.buffer).setUint16(4, 1, true);
    try {
      readHeader(buf);
      throw new Error("readHeader should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(VskFormatError);
      expect((err as VskFormatError).code).toBe("BAD_MAGIC");
    }
  });
});

describe("encrypted .vsk round-trip", () => {
  it("encrypts blob, seals envelope to recipient, decrypts back", async () => {
    await sodiumReady();
    const sender = await generateKeypair();
    const recipient = await generateKeypair();
    const path = join(tmpdir(), `vsk-enc-${process.pid}-${Date.now()}.vsk`);

    const src = await DuckDBHost.openInMemory();
    try {
      await src.exec("CREATE TABLE orders (id INTEGER, total DECIMAL(18,2))");
      await src.exec("INSERT INTO orders VALUES (1, 100.50), (2, 250.75)");

      const contentKey = randomKey();
      const envelope = await sealEnvelope(contentKey, recipient.publicKey, sender);

      await writeEncryptedVsk(src, path, {
        builtAt: new Date().toISOString(),
        sourceId: "enc-test",
        schemaName: "TEST",
        ttlExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        tables: [{
          name: "ORDERS",
          rowCount: 2,
          columns: [
            { name: "ID", type: "INTEGER", nullable: false },
            { name: "TOTAL", type: "DECIMAL(18,2)", nullable: true },
          ],
        }],
        piiMasks: [],
      }, contentKey, envelope);

      const headerCheck = readVskHeader(path);
      expect(headerCheck.envelopeLength).toBeGreaterThan(0n);

      const dst = await DuckDBHost.openInMemory();
      try {
        const { manifest } = await readEncryptedVsk(path, dst, sender.publicKey, recipient);
        expect(manifest.tables[0]!.name).toBe("ORDERS");
        const rows = await dst.query('SELECT id FROM "orders" ORDER BY id');
        expect(rows.length).toBe(2);
      } finally {
        await dst.close();
      }
    } finally {
      await src.close();
      try { unlinkSync(path); } catch { /* best effort */ }
    }
  });

  it("rejects encrypted .vsk when opened by wrong recipient", async () => {
    await sodiumReady();
    const sender = await generateKeypair();
    const recipient = await generateKeypair();
    const stranger = await generateKeypair();
    const path = join(tmpdir(), `vsk-enc-wrong-${process.pid}-${Date.now()}.vsk`);

    const src = await DuckDBHost.openInMemory();
    try {
      await src.exec("CREATE TABLE t (id INTEGER)");
      const contentKey = randomKey();
      const envelope = await sealEnvelope(contentKey, recipient.publicKey, sender);

      await writeEncryptedVsk(src, path, {
        builtAt: new Date().toISOString(),
        sourceId: "x",
        schemaName: "x",
        ttlExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        tables: [{ name: "T", rowCount: 0, columns: [
          { name: "ID", type: "INTEGER", nullable: false },
        ] }],
        piiMasks: [],
      }, contentKey, envelope);

      const dst = await DuckDBHost.openInMemory();
      try {
        await expect(readEncryptedVsk(path, dst, sender.publicKey, stranger))
          .rejects.toThrow();
      } finally {
        await dst.close();
      }
    } finally {
      await src.close();
      try { unlinkSync(path); } catch { /* best effort */ }
    }
  });

  it("readEncryptedVsk rejects a plaintext .vsk", async () => {
    await sodiumReady();
    const recipient = await generateKeypair();
    const sender = await generateKeypair();
    const path = join(tmpdir(), `vsk-plain-${process.pid}-${Date.now()}.vsk`);

    const src = await DuckDBHost.openInMemory();
    try {
      await src.exec("CREATE TABLE t (id INTEGER)");
      await writeVsk(src, path, {
        builtAt: new Date().toISOString(),
        sourceId: "x",
        schemaName: "x",
        ttlExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        tables: [{ name: "T", rowCount: 0, columns: [
          { name: "ID", type: "INTEGER", nullable: false },
        ] }],
        piiMasks: [],
      });

      const dst = await DuckDBHost.openInMemory();
      try {
        await expect(readEncryptedVsk(path, dst, sender.publicKey, recipient))
          .rejects.toThrow(/plaintext/i);
      } finally {
        await dst.close();
      }
    } finally {
      await src.close();
      try { unlinkSync(path); } catch { /* best effort */ }
    }
  });

  it("decrypts using external envelope when provided (member flow)", async () => {
    await sodiumReady();
    const ownerKp = await generateKeypair();
    const memberKp = await generateKeypair();

    // Owner-side: build encrypted .vsk with embedded owner envelope
    const contentKey = randomKey();
    const ownerEnvelope = await sealEnvelope(contentKey, ownerKp.publicKey, ownerKp);
    const path = join(tmpdir(), `vsk-ext-env-${process.pid}-${Date.now()}.vsk`);
    const srcHost = await DuckDBHost.openInMemory();
    try {
      await srcHost.exec("CREATE TABLE t (a INTEGER, b VARCHAR)");
      await srcHost.exec("INSERT INTO t VALUES (1, 'one'), (2, 'two')");
      await writeEncryptedVsk(srcHost, path, {
        builtAt: new Date().toISOString(),
        sourceId: "ext-env-test",
        schemaName: "TEST",
        ttlExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        tables: [{
          name: "T",
          rowCount: 2,
          columns: [
            { name: "A", type: "INTEGER", nullable: true },
            { name: "B", type: "VARCHAR", nullable: true },
          ],
        }],
        piiMasks: [],
      }, contentKey, ownerEnvelope);
    } finally {
      await srcHost.close();
    }

    // Member-side: build a SEPARATE envelope addressed to the member
    const memberEnvelope = await sealEnvelope(
      contentKey,
      memberKp.publicKey,
      ownerKp,
    );

    // Member uses readEncryptedVsk with their own envelope as override
    const dstHost = await DuckDBHost.openInMemory();
    try {
      const out = await readEncryptedVsk(
        path,
        dstHost,
        ownerKp.publicKey,
        memberKp,
        {},
        memberEnvelope,
      );
      expect(out.manifest.tables).toHaveLength(1);
      const rows = await dstHost.query('SELECT a, b FROM "t" ORDER BY a');
      expect(rows).toEqual([
        { A: 1, B: "one" },
        { A: 2, B: "two" },
      ]);
    } finally {
      await dstHost.close();
      try { unlinkSync(path); } catch { /* best effort */ }
    }
  });
});

describe("manifest v0.2.0", () => {
  it("round-trips plsqlObjectCount + skippedObjects", () => {
    const m: VskManifest = {
      builtAt: "2026-05-04T00:00:00.000Z",
      sourceId: "conn-1",
      schemaName: "HR",
      ttlExpiresAt: "2026-06-04T00:00:00.000Z",
      tables: [],
      piiMasks: [],
      engineVersion: "0.2.0",
      dataFormat: "parquet-streams-v1",
      plsqlObjectCount: 47,
      skippedObjects: [
        { kind: "PROCEDURE", owner: "HR", name: "P_BAD", reason: "INVALID" },
        { kind: "FUNCTION",  owner: "HR", name: "F_NP",  reason: "NO_PRIVILEGE", detail: "ORA-31603" },
      ],
    };
    const bytes = writeManifest(m);
    const back = readManifest(bytes);
    expect(back.engineVersion).toBe("0.2.0");
    expect(back.plsqlObjectCount).toBe(47);
    expect(back.skippedObjects).toHaveLength(2);
    expect(back.skippedObjects?.[0]?.reason).toBe("INVALID");
    expect(back.skippedObjects?.[1]?.detail).toBe("ORA-31603");
  });

  it("rejects malformed skippedObjects entry", () => {
    const bad = JSON.stringify({
      builtAt: "2026-05-04T00:00:00.000Z",
      sourceId: "x", schemaName: "X", ttlExpiresAt: "2026-06-04T00:00:00.000Z",
      tables: [], piiMasks: [],
      skippedObjects: [{ kind: "PROCEDURE", owner: "HR" /* missing name + reason */ }],
    });
    expect(() => readManifest(new TextEncoder().encode(bad))).toThrow(/malformed/i);
  });

  it("accepts manifest without v0.2.0 fields (backward compat)", () => {
    const v1 = JSON.stringify({
      builtAt: "2026-05-04T00:00:00.000Z",
      sourceId: "x", schemaName: "X", ttlExpiresAt: "2026-06-04T00:00:00.000Z",
      tables: [], piiMasks: [],
      engineVersion: "0.1.0",
    });
    const back = readManifest(new TextEncoder().encode(v1));
    expect(back.engineVersion).toBe("0.1.0");
    expect(back.plsqlObjectCount).toBeUndefined();
    expect(back.skippedObjects).toBeUndefined();
  });

  it("exports ENGINE_VERSION constant equal to '0.3.0'", () => {
    expect(ENGINE_VERSION).toBe("0.3.0");
  });
});

describe("reader v0.2.0 — system tables + version fence", () => {
  it("returns systemTables list separately from userTables", async () => {
    const host = await DuckDBHost.openInMemory();
    try {
      await host.exec(`CREATE TABLE "u" (id INT)`);
      await host.exec(`INSERT INTO "u" VALUES (1)`);
      await host.exec(`CREATE TABLE "__vsk_objects" (kind VARCHAR, owner VARCHAR, name VARCHAR, status VARCHAR, ddl_size_bytes BIGINT, extracted_at TIMESTAMP, PRIMARY KEY (kind, owner, name))`);
      await host.exec(`INSERT INTO "__vsk_objects" VALUES ('PROCEDURE', 'HR', 'P1', 'VALID', 100, '2026-05-04 00:00:00')`);

      const out = join(tmpdir(), `vsk-r-${Date.now()}.vsk`);
      const m: VskManifest = {
        builtAt: "2026-05-04T00:00:00.000Z",
        sourceId: "s", schemaName: "S",
        ttlExpiresAt: "2026-06-04T00:00:00.000Z",
        tables: [{ name: "u", rowCount: 1, columns: [{ name: "id", type: "NUMBER", nullable: true }] }],
        piiMasks: [],
        engineVersion: "0.2.0",
      };
      try {
        await writeVsk(host, out, m);
        const dst = await DuckDBHost.openInMemory();
        try {
          const result = await readVsk(out, dst);
          expect(result.manifest.engineVersion).toBe("0.2.0");
          expect(result.userTables).toContain("u");
          expect(result.systemTables).toContain("__vsk_objects");
          expect(result.userTables).not.toContain("__vsk_objects");
        } finally {
          await dst.close();
        }
      } finally {
        if (existsSync(out)) unlinkSync(out);
      }
    } finally {
      await host.close();
    }
  });

  it("rejects manifests with engineVersion >= 0.4.0", async () => {
    const host = await DuckDBHost.openInMemory();
    try {
      await host.exec(`CREATE TABLE "u" (id INT)`);
      const out = join(tmpdir(), `vsk-fence-${Date.now()}.vsk`);
      const m: VskManifest = {
        builtAt: "2026-05-04T00:00:00.000Z",
        sourceId: "s", schemaName: "S",
        ttlExpiresAt: "2026-06-04T00:00:00.000Z",
        tables: [{ name: "u", rowCount: 0, columns: [{ name: "id", type: "NUMBER", nullable: true }] }],
        piiMasks: [],
        engineVersion: "0.4.0",
      };
      try {
        await writeVsk(host, out, m);
        const dst = await DuckDBHost.openInMemory();
        try {
          await expect(readVsk(out, dst)).rejects.toThrow(/engineVersion 0\.4\.0/i);
        } finally {
          await dst.close();
        }
      } finally {
        if (existsSync(out)) unlinkSync(out);
      }
    } finally {
      await host.close();
    }
  });

  it("v0.1.0 manifest reads with empty systemTables", async () => {
    const host = await DuckDBHost.openInMemory();
    try {
      await host.exec(`CREATE TABLE "u" (id INT)`);
      const out = join(tmpdir(), `vsk-v1-${Date.now()}.vsk`);
      const m: VskManifest = {
        builtAt: "2026-05-04T00:00:00.000Z",
        sourceId: "s", schemaName: "S",
        ttlExpiresAt: "2026-06-04T00:00:00.000Z",
        tables: [{ name: "u", rowCount: 0, columns: [{ name: "id", type: "NUMBER", nullable: true }] }],
        piiMasks: [],
        engineVersion: "0.1.0",
      };
      try {
        await writeVsk(host, out, m);
        const dst = await DuckDBHost.openInMemory();
        try {
          const r = await readVsk(out, dst);
          expect(r.systemTables).toEqual([]);
          expect(r.userTables).toEqual(["u"]);
        } finally {
          await dst.close();
        }
      } finally {
        if (existsSync(out)) unlinkSync(out);
      }
    } finally {
      await host.close();
    }
  });

  it("rejects a system-prefixed table name with path-traversal characters", async () => {
    // Hand-craft a .vsk where the data section's __VSK_TABLE__ tag carries a
    // crafted system table name that would otherwise be interpolated into the
    // tmp-file path and escape tmpdir().
    const tmpTestDir = mkdtempSync(join(tmpdir(), `vsk-traversal-${process.pid}-`));
    const out = join(tmpTestDir, "traversal.vsk");
    const malicious = "__vsk_x/../../etc/exploit";

    const { writeHeader: writeHdr, HEADER_SIZE } = await import("../src/vsk-format/header");
    const { writeManifest: writeMan } = await import("../src/vsk-format/manifest");
    const manifest: VskManifest = {
      builtAt: new Date().toISOString(),
      sourceId: "x",
      schemaName: "x",
      ttlExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      tables: [],
      piiMasks: [],
    };
    const manifestBytes = writeMan(manifest);
    const tag = new TextEncoder().encode(`__VSK_TABLE__${malicious}\n`);
    const sizeBuf = new Uint8Array(8);
    new DataView(sizeBuf.buffer).setBigUint64(0, 0n, true);
    const dataSection = Buffer.concat([Buffer.from(tag), Buffer.from(sizeBuf)]);

    const header = writeHdr({
      manifestOffset: BigInt(HEADER_SIZE),
      manifestLength: BigInt(manifestBytes.byteLength),
      dataOffset: BigInt(HEADER_SIZE + manifestBytes.byteLength),
      dataLength: BigInt(dataSection.byteLength),
      envelopeOffset: 0n,
      envelopeLength: 0n,
    });
    const file = Buffer.concat([Buffer.from(header), Buffer.from(manifestBytes), dataSection]);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(out, file);

    try {
      const dst = await DuckDBHost.openInMemory();
      try {
        await expect(readVsk(out, dst)).rejects.toThrow(/invalid system table name/i);
      } finally {
        await dst.close();
      }
    } finally {
      try { rmSync(tmpTestDir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  });
});
