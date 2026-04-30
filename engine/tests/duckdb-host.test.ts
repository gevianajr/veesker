import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { DuckDBHost } from "../src/duckdb-host";

describe("DuckDBHost", () => {
  let host: DuckDBHost;

  beforeEach(async () => {
    host = await DuckDBHost.openInMemory();
  });

  afterEach(async () => {
    await host.close();
  });

  it("executes a trivial SELECT", async () => {
    const rows = await host.query("SELECT 1 AS n");
    expect(rows).toEqual([{ n: 1 }]);
  });

  it("creates and queries a table", async () => {
    await host.exec("CREATE TABLE t (id INT, name VARCHAR)");
    await host.exec("INSERT INTO t VALUES (1, 'alice'), (2, 'bob')");
    const rows = await host.query("SELECT * FROM t ORDER BY id");
    expect(rows).toEqual([
      { id: 1, name: "alice" },
      { id: 2, name: "bob" },
    ]);
  });

  it("rejects after close", async () => {
    await host.close();
    await expect(host.query("SELECT 1")).rejects.toThrow(/closed/);
  });
});
