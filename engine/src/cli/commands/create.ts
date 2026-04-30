import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DuckDBHost } from "../../duckdb-host";
import { writeVsk } from "../../vsk-format/writer";
import { assertValidTableName } from "../../vsk-format/errors";
import type { VskManifest, VskTable } from "../../vsk-format/manifest";

/**
 * Allowlist for `column.type` strings in the schema JSON. Permits letters,
 * digits, spaces, parens, and commas (e.g. `DECIMAL(10,2)`, `VARCHAR(100)`,
 * `TIMESTAMP WITH TIME ZONE`). Rejects semicolons, identifiers prefixed with
 * symbols, and anything that could close the DDL and inject another statement.
 */
const COLUMN_TYPE_RE = /^[A-Za-z][A-Za-z0-9 (),]{0,63}$/;

function assertValidColumnType(type: string): void {
  if (!COLUMN_TYPE_RE.test(type)) {
    throw new Error(
      `invalid column type ${JSON.stringify(type).slice(0, 80)} (must match ${COLUMN_TYPE_RE.source})`,
    );
  }
}

interface SchemaJson {
  schemaName: string;
  ttlDays: number;
  tables: Array<{
    name: string;
    csv: string;
    columns: Array<{ name: string; type: string; nullable: boolean }>;
  }>;
}

function readSchema(path: string): SchemaJson {
  const raw = readFileSync(path, "utf8");
  const obj = JSON.parse(raw);
  if (typeof obj !== "object" || obj === null) {
    throw new Error("schema must be a JSON object");
  }
  const o = obj as Record<string, unknown>;
  if (typeof o.schemaName !== "string") throw new Error("schema.schemaName must be a string");
  if (typeof o.ttlDays !== "number" || !Number.isFinite(o.ttlDays) || o.ttlDays <= 0) {
    throw new Error("schema.ttlDays must be a positive number");
  }
  if (!Array.isArray(o.tables)) throw new Error("schema.tables must be an array");
  for (const t of o.tables) {
    if (typeof t !== "object" || t === null) throw new Error("each table must be an object");
    const tt = t as Record<string, unknown>;
    if (typeof tt.name !== "string") throw new Error("table.name must be a string");
    if (typeof tt.csv !== "string") throw new Error("table.csv must be a string");
    if (!Array.isArray(tt.columns)) throw new Error("table.columns must be an array");
    for (const c of tt.columns) {
      if (typeof c !== "object" || c === null) throw new Error("each column must be an object");
      const cc = c as Record<string, unknown>;
      if (typeof cc.name !== "string") throw new Error("column.name must be a string");
      if (typeof cc.type !== "string") throw new Error("column.type must be a string");
      assertValidColumnType(cc.type);
      if (typeof cc.nullable !== "boolean") throw new Error("column.nullable must be a boolean");
    }
  }
  return obj as SchemaJson;
}

/**
 * Register the `create` subcommand on the given commander program.
 *
 * Trust model: the schema JSON is treated as trusted-author input. Each
 * `csv` path is read from the local filesystem; each `column.type` is
 * interpolated into a `CREATE TABLE` DDL after a regex allowlist check
 * (see {@link COLUMN_TYPE_RE}). Each `table.name` passes through
 * `assertValidTableName` before any DB work.
 *
 * Do NOT consume schemas from untrusted sources without additional
 * sandboxing — even with the allowlist, a malicious author could exhaust
 * disk by pointing `csv` at a huge file or by declaring thousands of
 * tables.
 */
export function registerCreate(program: Command): void {
  program
    .command("create")
    .description("create a .vsk sandbox from a schema JSON + CSV files")
    .requiredOption("--schema <path>", "schema JSON file")
    .requiredOption("--out <path>", "output .vsk path")
    .option("--source-id <id>", "source identifier", "local")
    .action(
      async (opts: { schema: string; out: string; sourceId: string }) => {
        const schema = readSchema(opts.schema);

        for (const t of schema.tables) {
          assertValidTableName(t.name);
        }

        const host = await DuckDBHost.openInMemory();
        const manifestTables: VskTable[] = [];

        try {
          for (const t of schema.tables) {
            const tNameSql = t.name.toLowerCase().replace(/"/g, '""');
            const colsDdl = t.columns
              .map((c) => {
                const colName = c.name.toUpperCase().replace(/"/g, '""');
                const nullClause = c.nullable ? "" : " NOT NULL";
                return `"${colName}" ${c.type}${nullClause}`;
              })
              .join(", ");

            await host.exec(`CREATE TABLE "${tNameSql}" (${colsDdl})`);

            const csvAbs = resolve(t.csv);
            const csvSql = csvAbs.replace(/\\/g, "/").replace(/'/g, "''");
            await host.exec(
              `COPY "${tNameSql}" FROM '${csvSql}' (HEADER, AUTO_DETECT FALSE)`,
            );

            const cnt = await host.query(
              `SELECT COUNT(*) AS n FROM "${tNameSql}"`,
            );
            const rowCount = Number(cnt[0]?.n ?? 0);

            manifestTables.push({
              name: t.name.toUpperCase(),
              rowCount,
              columns: t.columns.map((c) => ({
                name: c.name.toUpperCase(),
                type: c.type,
                nullable: c.nullable,
              })),
            });
          }

          const builtAt = new Date().toISOString();
          const ttlExpiresAt = new Date(
            Date.now() + schema.ttlDays * 86_400_000,
          ).toISOString();

          const manifest: VskManifest = {
            builtAt,
            sourceId: opts.sourceId,
            schemaName: schema.schemaName,
            ttlExpiresAt,
            tables: manifestTables,
            piiMasks: [],
            engineVersion: "0.1.0",
            dataFormat: "parquet-streams-v1",
          };

          await writeVsk(host, opts.out, manifest);
          console.log(
            `wrote ${opts.out} (${manifestTables.length} tables, ${manifestTables.reduce((s, t) => s + t.rowCount, 0).toLocaleString()} rows total, expires ${ttlExpiresAt})`,
          );
        } finally {
          await host.close();
        }
      },
    );
}
