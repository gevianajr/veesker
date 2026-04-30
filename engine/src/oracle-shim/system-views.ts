import type { DuckDBHost } from "../duckdb-host";
import { mapDuckDBType } from "./types";

const SYSTEM_TABLE_NAMES = ["user_objects", "user_tab_columns"] as const;

/**
 * Drop and rebuild Oracle-style metadata views inside a DuckDB host.
 *
 * Populates two tables:
 *   - `USER_OBJECTS` — one row per non-system table (object_name + object_type)
 *   - `USER_TAB_COLUMNS` — one row per column with Oracle-mapped data_type
 *
 * Idempotent: safe to call multiple times. Subsequent calls fully refresh
 * the views to reflect the current `information_schema` state — handy
 * after DDL.
 *
 * Notes:
 *   - Object names are upper-cased on output (Oracle convention).
 *   - DuckDB types are mapped to Oracle equivalents via `mapDuckDBType`.
 *   - The system-view tables themselves are excluded from `USER_OBJECTS`.
 *   - The `owner` parameter is informational; the views currently expose
 *     only the host's `main` schema (DuckDB's default). Reserved for
 *     future use when multi-schema support lands.
 */
export async function installSystemViews(host: DuckDBHost, owner: string): Promise<void> {
  void owner;

  for (const t of SYSTEM_TABLE_NAMES) {
    await host.exec(`DROP TABLE IF EXISTS ${t}`);
  }

  await host.exec(`
    CREATE TABLE user_objects (
      object_name VARCHAR,
      object_type VARCHAR,
      status VARCHAR,
      created TIMESTAMP,
      last_ddl_time TIMESTAMP
    )
  `);
  await host.exec(`
    CREATE TABLE user_tab_columns (
      table_name VARCHAR,
      column_name VARCHAR,
      data_type VARCHAR,
      data_length INTEGER,
      nullable VARCHAR,
      column_id INTEGER
    )
  `);

  const tables = await host.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'main'
      AND table_name NOT IN ('user_objects', 'user_tab_columns')
    ORDER BY table_name
  `);

  for (const row of tables) {
    const tName = String(row.table_name);
    const tNameUpper = tName.toUpperCase();
    await host.exec(
      `INSERT INTO user_objects VALUES (${sqlStr(tNameUpper)}, 'TABLE', 'VALID', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    );

    const cols = await host.query(`
      SELECT column_name, data_type, is_nullable, ordinal_position
      FROM information_schema.columns
      WHERE table_schema = 'main' AND table_name = ${sqlStr(tName)}
      ORDER BY ordinal_position
    `);
    for (const c of cols) {
      const colName = String(c.column_name).toUpperCase();
      const oraType = mapDuckDBType(String(c.data_type));
      const nullable = String(c.is_nullable) === "YES" ? "Y" : "N";
      const colId = Number(c.ordinal_position);
      await host.exec(
        `INSERT INTO user_tab_columns VALUES (${sqlStr(tNameUpper)}, ${sqlStr(colName)}, ${sqlStr(oraType)}, 4000, ${sqlStr(nullable)}, ${colId})`,
      );
    }
  }
}

/** Quote a string as a DuckDB SQL literal — escapes embedded `'` via `''`. */
function sqlStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
