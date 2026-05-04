import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, unlinkSync } from "node:fs";
import { DuckDBHost } from "../src/duckdb-host";
import { writeVsk } from "../src/vsk-format/writer";
import type { VskManifest } from "../src/vsk-format/manifest";
import { Command } from "commander";
import { registerInfo } from "../src/cli/commands/info";

async function buildSandboxFor(manifest: VskManifest, withSystemTables: boolean): Promise<string> {
  const out = join(tmpdir(), `vsk-info-${Date.now()}-${Math.random().toString(36).slice(2)}.vsk`);
  const host = await DuckDBHost.openInMemory();
  try {
    for (const t of manifest.tables) {
      const cols = t.columns.map((c) => `"${c.name}" ${c.type === "NUMBER" ? "INTEGER" : "VARCHAR"}`).join(", ");
      await host.exec(`CREATE TABLE "${t.name.toLowerCase()}" (${cols})`);
    }
    if (withSystemTables) {
      await host.exec(`CREATE TABLE "__vsk_objects" (kind VARCHAR, owner VARCHAR, name VARCHAR, status VARCHAR, ddl_size_bytes BIGINT, extracted_at TIMESTAMP, PRIMARY KEY (kind, owner, name))`);
      await host.exec(`INSERT INTO "__vsk_objects" VALUES
        ('PROCEDURE', 'HR', 'P1', 'VALID', 100, '2026-05-04 00:00:00'),
        ('FUNCTION',  'HR', 'F1', 'VALID', 200, '2026-05-04 00:00:00'),
        ('PACKAGE',   'HR', 'PK1', 'VALID', 300, '2026-05-04 00:00:00')`);
    }
    await writeVsk(host, out, manifest);
  } finally {
    await host.close();
  }
  return out;
}

function captureConsole<T>(fn: () => T): { lines: string[]; result: T } {
  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    return { lines, result: fn() };
  } finally {
    console.log = origLog;
  }
}

describe("cli info", () => {
  const cleanups: string[] = [];
  afterAll(() => { for (const f of cleanups) if (existsSync(f)) unlinkSync(f); });

  it("prints PL/SQL summary for v0.2.0 manifests", async () => {
    const m: VskManifest = {
      builtAt: "2026-05-04T00:00:00.000Z",
      sourceId: "x", schemaName: "HR",
      ttlExpiresAt: "2026-06-04T00:00:00.000Z",
      tables: [{ name: "users", rowCount: 1, columns: [{ name: "id", type: "NUMBER", nullable: true }] }],
      piiMasks: [],
      engineVersion: "0.2.0",
      plsqlObjectCount: 47,
      skippedObjects: [
        { kind: "PROCEDURE", owner: "HR", name: "BAD", reason: "INVALID" },
      ],
    };
    const out = await buildSandboxFor(m, true);
    cleanups.push(out);

    const program = new Command();
    program.exitOverride();
    registerInfo(program);
    const { lines } = captureConsole(() => program.parse(["node", "vsk", "info", out]));

    const joined = lines.join("\n");
    expect(joined).toContain("Engine version: 0.2.0");
    expect(joined).toMatch(/Plsql objects:\s*47/);
    expect(joined).toMatch(/Skipped:\s*1/);
  });

  it("does not print PL/SQL summary for v0.1.0 manifests", async () => {
    const m: VskManifest = {
      builtAt: "2026-05-04T00:00:00.000Z",
      sourceId: "x", schemaName: "S",
      ttlExpiresAt: "2026-06-04T00:00:00.000Z",
      tables: [{ name: "u", rowCount: 0, columns: [{ name: "a", type: "NUMBER", nullable: true }] }],
      piiMasks: [],
      engineVersion: "0.1.0",
    };
    const out = await buildSandboxFor(m, false);
    cleanups.push(out);

    const program = new Command();
    program.exitOverride();
    registerInfo(program);
    const { lines } = captureConsole(() => program.parse(["node", "vsk", "info", out]));

    const joined = lines.join("\n");
    expect(joined).not.toMatch(/Plsql objects/i);
    expect(joined).not.toMatch(/Skipped:/i);
  });
});
