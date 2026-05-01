import type { Command } from "commander";
import { DuckDBHost } from "../../duckdb-host";
import { readVsk } from "../../vsk-format/reader";
import { translate } from "../../oracle-shim/translator";
import { installSystemViews } from "../../oracle-shim/system-views";

type OutputFormat = "table" | "json" | "csv";

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function emit(rows: Record<string, unknown>[], format: OutputFormat): void {
  if (rows.length === 0) {
    if (format === "json") console.log("[]");
    else if (format === "csv") {/* nothing */}
    else console.log("(no rows)");
    return;
  }

  if (format === "json") {
    const replacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);
    console.log(JSON.stringify(rows, replacer, 2));
    return;
  }

  const cols = Object.keys(rows[0]!);

  if (format === "csv") {
    console.log(cols.join(","));
    for (const r of rows) console.log(cols.map((c) => csvCell(r[c])).join(","));
    return;
  }

  const widths = cols.map((c) =>
    Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)),
  );
  const sep = `+${widths.map((w) => "-".repeat(w + 2)).join("+")}+`;
  console.log(sep);
  console.log(`|${cols.map((c, i) => ` ${c.padEnd(widths[i]!)} `).join("|")}|`);
  console.log(sep);
  for (const r of rows) {
    console.log(
      `|${cols.map((c, i) => ` ${String(r[c] ?? "").padEnd(widths[i]!)} `).join("|")}|`,
    );
  }
  console.log(sep);
  console.log(`(${rows.length} rows)`);
}

/**
 * Register the `query` subcommand.
 *
 * Loads a `.vsk` file into an in-memory DuckDB host, installs Oracle-style
 * system views, optionally translates the user's Oracle dialect into DuckDB
 * SQL, executes, and prints results in the chosen format.
 */
export function registerQuery(program: Command): void {
  program
    .command("query <file> <sql>")
    .description("run an Oracle-flavored SQL query against a .vsk sandbox")
    .option("--no-translate", "skip Oracle SQL translation; pass SQL through verbatim")
    .option("--format <fmt>", "output format (table|json|csv)", "table")
    .action(
      async (
        file: string,
        sql: string,
        opts: { translate: boolean; format: string },
      ) => {
        const format = opts.format as OutputFormat;
        if (format !== "table" && format !== "json" && format !== "csv") {
          throw new Error(`invalid --format ${JSON.stringify(opts.format)}; expected table|json|csv`);
        }

        const host = await DuckDBHost.openInMemory();
        try {
          const manifest = await readVsk(file, host);
          await installSystemViews(host, manifest.schemaName);

          const finalSql = opts.translate === false ? sql : translate(sql);
          const rows = await host.query(finalSql);
          emit(rows, format);
        } finally {
          await host.close();
        }
      },
    );
}
