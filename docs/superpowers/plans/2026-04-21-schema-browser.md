# Schema Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open a saved Oracle connection in a workspace route and let the user browse schemas/tables/views/sequences with an inspectable details pane (columns + indexes + estimated row count).

**Architecture:** Add 5 sidecar JSON-RPC methods backed by a single mutable `currentSession` in sidecar memory; proxy them through 5 thin Tauri commands; render with three Svelte components (StatusBar / SchemaTree / ObjectDetails) inside a new `/workspace/[id]` route. No new SQLite tables, no new keychain entries — workspace lifecycle lives in process memory and component state.

**Tech Stack:** Tauri 2 (Rust), `tauri-plugin-shell` sidecar transport, Bun + node-oracledb 6.x (Thin mode) sidecar, SvelteKit (Svelte 5 runes, adapter-static), `rusqlite 0.32 bundled`.

**Spec:** `docs/superpowers/specs/2026-04-21-schema-browser-design.md`

---

## File Structure

**New files:**
- `src-tauri/src/persistence/connection_config.rs` — pure JSON builders (`basic_params`, `wallet_params`) shared between `connection.test` and `workspace.open`
- `sidecar/src/state.ts` — module-local `currentSession` + `currentSchema` with `setSession` / `clearSession` / `getActiveSession` (throws on `null`)
- `sidecar/src/errors.ts` — `RpcCodedError` class so handlers can throw `{ code: -32010 | -32011 | -32012 | -32013 }` and the dispatcher honors the code
- `src/lib/workspace.ts` — TS types + `workspaceOpen` / `workspaceClose` / `schemaList` / `objectsList` / `tableDescribe`
- `src/lib/workspace/StatusBar.svelte` — top dark strip
- `src/lib/workspace/SchemaTree.svelte` — lazy-expand tree
- `src/lib/workspace/ObjectDetails.svelte` — columns + indexes + row count
- `src/routes/workspace/[id]/+page.svelte` — orchestrator route

**Modified files:**
- `src-tauri/src/persistence/mod.rs` — register `connection_config` module
- `src-tauri/src/persistence/connections.rs` — add `ConnectionService::sidecar_params(id)` method
- `src-tauri/src/commands.rs` — refactor `config_to_params` to call helpers; add 5 new commands
- `src-tauri/src/lib.rs` — register the 5 new commands in `invoke_handler!`
- `sidecar/src/oracle.ts` — add `openSession`, `closeSession`, `schemaList`, `objectsList`, `tableDescribe`
- `sidecar/src/handlers.ts` — extend dispatcher to honor `err.code` when it's a number
- `sidecar/src/index.ts` — register the 5 new handler entries
- `src/routes/+page.svelte` — add primary **Open** button per row

---

## Task 1: Extract connection_config helpers (Rust)

**Files:**
- Create: `src-tauri/src/persistence/connection_config.rs`
- Modify: `src-tauri/src/persistence/mod.rs`
- Modify: `src-tauri/src/commands.rs:43-74` (refactor `config_to_params`)

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/persistence/connection_config.rs`:

```rust
use serde_json::{json, Value};
use std::path::Path;

pub fn basic_params(
    host: &str,
    port: u16,
    service_name: &str,
    username: &str,
    password: &str,
) -> Value {
    json!({
        "authType": "basic",
        "host": host,
        "port": port,
        "serviceName": service_name,
        "username": username,
        "password": password,
    })
}

pub fn wallet_params(
    wallet_dir: &Path,
    wallet_password: &str,
    connect_alias: &str,
    username: &str,
    password: &str,
) -> Value {
    json!({
        "authType": "wallet",
        "walletDir": wallet_dir.to_string_lossy(),
        "walletPassword": wallet_password,
        "connectAlias": connect_alias,
        "username": username,
        "password": password,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn basic_params_emits_camel_case_with_all_fields() {
        let v = basic_params("db.example.com", 1521, "FREEPDB1", "PDBADMIN", "secret");
        assert_eq!(v["authType"], "basic");
        assert_eq!(v["host"], "db.example.com");
        assert_eq!(v["port"], 1521);
        assert_eq!(v["serviceName"], "FREEPDB1");
        assert_eq!(v["username"], "PDBADMIN");
        assert_eq!(v["password"], "secret");
    }

    #[test]
    fn wallet_params_emits_camel_case_with_path() {
        let dir = PathBuf::from("/tmp/wallets/abc");
        let v = wallet_params(&dir, "wpw", "fakedb_high", "ADMIN", "userpw");
        assert_eq!(v["authType"], "wallet");
        assert_eq!(v["walletDir"], "/tmp/wallets/abc");
        assert_eq!(v["walletPassword"], "wpw");
        assert_eq!(v["connectAlias"], "fakedb_high");
        assert_eq!(v["username"], "ADMIN");
        assert_eq!(v["password"], "userpw");
    }
}
```

- [ ] **Step 2: Register module**

Edit `src-tauri/src/persistence/mod.rs` — add line `pub mod connection_config;`. Final file:

```rust
pub mod connection_config;
pub mod connections;
pub mod secrets;
pub mod store;
pub mod tnsnames;
pub mod wallet;
```

- [ ] **Step 3: Run the new tests**

Run: `cd src-tauri && PATH="$HOME/.cargo/bin:$PATH" cargo test --lib connection_config -- --nocapture`
Expected: 2 passed.

- [ ] **Step 4: Refactor `commands::config_to_params` to call helpers**

Edit `src-tauri/src/commands.rs` — replace the existing `config_to_params` (lines 43-74) with:

```rust
fn config_to_params(config: ConnectionConfig) -> Value {
    use crate::persistence::connection_config::{basic_params, wallet_params};
    use std::path::Path;
    match config {
        ConnectionConfig::Basic {
            host,
            port,
            service_name,
            username,
            password,
        } => basic_params(&host, port, &service_name, &username, &password),
        ConnectionConfig::Wallet {
            wallet_dir,
            wallet_password,
            connect_alias,
            username,
            password,
        } => wallet_params(
            Path::new(&wallet_dir),
            &wallet_password,
            &connect_alias,
            &username,
            &password,
        ),
    }
}
```

- [ ] **Step 5: Run full test suite to verify no regressions**

Run: `cd src-tauri && PATH="$HOME/.cargo/bin:$PATH" cargo test --lib`
Expected: 26 passed (24 prior + 2 new).

- [ ] **Step 6: Commit**

```bash
cd /Users/geraldoviana/Documents/veesker
git add src-tauri/src/persistence/connection_config.rs \
        src-tauri/src/persistence/mod.rs \
        src-tauri/src/commands.rs
git commit -m "refactor: extract sidecar params builders to connection_config module"
```

---

## Task 2: ConnectionService::sidecar_params

**Files:**
- Modify: `src-tauri/src/persistence/connections.rs` (add method on `ConnectionService`)

- [ ] **Step 1: Add the method**

Edit `src-tauri/src/persistence/connections.rs` — find the `impl ConnectionService` block. After the existing `pub fn get(...)` method, add:

```rust
    /// Build the sidecar JSON-RPC params for opening an Oracle session
    /// for the saved connection identified by `id`. Pulls password (and
    /// wallet password / wallet dir for wallet auth) from the keychain
    /// + on-disk wallet root.
    pub fn sidecar_params(&self, id: &str) -> Result<serde_json::Value, ConnectionError> {
        use super::connection_config::{basic_params, wallet_params};
        let full = self.get(id)?;
        match full.meta {
            ConnectionMeta::Basic {
                host,
                port,
                service_name,
                username,
                ..
            } => Ok(basic_params(
                &host,
                port,
                &service_name,
                &username,
                &full.password,
            )),
            ConnectionMeta::Wallet {
                connect_alias,
                username,
                id: meta_id,
                ..
            } => {
                let dir = self.wallet_dir(&meta_id);
                let wpw = full.wallet_password.as_deref().unwrap_or("");
                Ok(wallet_params(
                    &dir,
                    wpw,
                    &connect_alias,
                    &username,
                    &full.password,
                ))
            }
        }
    }
```

- [ ] **Step 2: Compile**

Run: `cd src-tauri && PATH="$HOME/.cargo/bin:$PATH" cargo build --lib`
Expected: builds with no errors. Warnings about unused method are OK (it's wired in Task 7).

- [ ] **Step 3: Commit**

```bash
cd /Users/geraldoviana/Documents/veesker
git add src-tauri/src/persistence/connections.rs
git commit -m "feat: add ConnectionService::sidecar_params for workspace open"
```

---

## Task 3: Sidecar errors module + dispatcher upgrade

**Files:**
- Create: `sidecar/src/errors.ts`
- Modify: `sidecar/src/handlers.ts`

- [ ] **Step 1: Create `sidecar/src/errors.ts`**

```ts
// Custom JSON-RPC error codes for veesker workspace flow.
// Picked to avoid the JSON-RPC 2.0 reserved range (-32768 .. -32000)
// and our existing transport codes (-32000, -32001, -32002, -32003, -32700, -32601).
export const NO_ACTIVE_SESSION = -32010;
export const SESSION_LOST      = -32011;
export const OBJECT_NOT_FOUND  = -32012;
export const ORACLE_ERR        = -32013;

export class RpcCodedError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
    this.name = "RpcCodedError";
  }
}
```

- [ ] **Step 2: Write failing test for dispatcher honoring err.code**

Edit `sidecar/tests/handlers.test.ts` — append a new test before the closing `});` of the `describe`:

```ts
  test("uses err.code when handler throws an error with a numeric code", async () => {
    const handlers = {
      coded: async () => {
        const e: any = new Error("custom failure");
        e.code = -32010;
        throw e;
      },
    };
    const res = await dispatch(handlers, {
      jsonrpc: "2.0",
      id: 4,
      method: "coded",
      params: {},
    });
    expect(res).toEqual({
      jsonrpc: "2.0",
      id: 4,
      error: { code: -32010, message: "custom failure" },
    });
  });
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd sidecar && bun test handlers`
Expected: FAIL — actual code is -32000 (current dispatcher hardcodes that).

- [ ] **Step 4: Update dispatcher**

Edit `sidecar/src/handlers.ts` — replace the `catch (err)` block:

```ts
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = typeof (err as any)?.code === "number" ? (err as any).code : -32000;
    return makeError(req.id, code, message);
  }
```

- [ ] **Step 5: Run tests to verify pass**

Run: `cd sidecar && bun test handlers`
Expected: PASS — 4 tests pass (3 existing + 1 new).

- [ ] **Step 6: Commit**

```bash
cd /Users/geraldoviana/Documents/veesker
git add sidecar/src/errors.ts sidecar/src/handlers.ts sidecar/tests/handlers.test.ts
git commit -m "feat(sidecar): coded RPC errors + dispatcher honors err.code"
```

---

## Task 4: Sidecar state module

**Files:**
- Create: `sidecar/src/state.ts`

- [ ] **Step 1: Write the module**

Create `sidecar/src/state.ts`:

```ts
import type oracledb from "oracledb";
import { RpcCodedError, NO_ACTIVE_SESSION } from "./errors";

let currentSession: oracledb.Connection | null = null;
let currentSchema: string | null = null;

export function setSession(conn: oracledb.Connection, schema: string): void {
  currentSession = conn;
  currentSchema = schema;
}

export function clearSession(): void {
  currentSession = null;
  currentSchema = null;
}

export function getActiveSession(): oracledb.Connection {
  if (currentSession === null) {
    throw new RpcCodedError(
      NO_ACTIVE_SESSION,
      "No active workspace session. Call workspace.open first."
    );
  }
  return currentSession;
}

export function hasSession(): boolean {
  return currentSession !== null;
}

export function getCurrentSchema(): string | null {
  return currentSchema;
}
```

- [ ] **Step 2: Write failing test**

Create `sidecar/tests/state.test.ts`:

```ts
import { describe, expect, test, beforeEach } from "bun:test";
import { setSession, clearSession, getActiveSession, hasSession, getCurrentSchema } from "../src/state";
import { NO_ACTIVE_SESSION, RpcCodedError } from "../src/errors";

describe("state", () => {
  beforeEach(() => clearSession());

  test("getActiveSession throws RpcCodedError(NO_ACTIVE_SESSION) when empty", () => {
    expect(() => getActiveSession()).toThrow(RpcCodedError);
    try {
      getActiveSession();
    } catch (e: any) {
      expect(e.code).toBe(NO_ACTIVE_SESSION);
    }
  });

  test("setSession stores conn + schema; getCurrentSchema returns it; hasSession reports true", () => {
    const fakeConn = { fake: true } as any;
    setSession(fakeConn, "PDBADMIN");
    expect(hasSession()).toBe(true);
    expect(getCurrentSchema()).toBe("PDBADMIN");
    expect(getActiveSession()).toBe(fakeConn);
  });

  test("clearSession resets state", () => {
    setSession({} as any, "X");
    clearSession();
    expect(hasSession()).toBe(false);
    expect(getCurrentSchema()).toBeNull();
  });
});
```

- [ ] **Step 3: Run state tests**

Run: `cd sidecar && bun test state`
Expected: 3 passed.

- [ ] **Step 4: Commit**

```bash
cd /Users/geraldoviana/Documents/veesker
git add sidecar/src/state.ts sidecar/tests/state.test.ts
git commit -m "feat(sidecar): module-local active session state"
```

---

## Task 5: Sidecar oracle.ts — session lifecycle

**Files:**
- Modify: `sidecar/src/oracle.ts`

- [ ] **Step 1: Add lifecycle functions**

Edit `sidecar/src/oracle.ts` — append after the existing `connectionTest` function:

```ts
import { setSession, clearSession, hasSession, getActiveSession } from "./state";
import { RpcCodedError, SESSION_LOST, ORACLE_ERR } from "./errors";

export type OpenSessionParams = ConnectionTestParams;
export type OpenSessionResult = { serverVersion: string; currentSchema: string };

function isLostSessionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message || "";
  // node-oracledb thin / Oracle codes that mean "session is gone":
  // NJS-003 connection, NJS-500 driver/connect, ORA-03113 EOF, ORA-03114 not connected
  return (
    m.includes("NJS-003") ||
    m.includes("NJS-500") ||
    m.includes("ORA-03113") ||
    m.includes("ORA-03114") ||
    m.includes("DPI-1010")
  );
}

async function buildConnection(p: OpenSessionParams): Promise<oracledb.Connection> {
  if (p.authType === "basic") {
    return await oracledb.getConnection({
      user: p.username,
      password: p.password,
      connectString: `${p.host}:${p.port}/${p.serviceName}`,
    });
  }
  return await oracledb.getConnection({
    user: p.username,
    password: p.password,
    connectString: p.connectAlias,
    configDir: p.walletDir,
    walletLocation: p.walletDir,
    walletPassword: p.walletPassword,
  });
}

export async function openSession(p: OpenSessionParams): Promise<OpenSessionResult> {
  // Replace any prior session before opening a new one.
  if (hasSession()) {
    try {
      await getActiveSession().close();
    } catch {
      // Best-effort close — old session may already be dead.
    }
    clearSession();
  }

  const conn = await buildConnection(p);
  try {
    const versionRes = await conn.execute<{ V: string }>(
      "SELECT BANNER_FULL AS V FROM V$VERSION WHERE ROWNUM = 1",
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const schemaRes = await conn.execute<{ S: string }>(
      "SELECT SYS_CONTEXT('USERENV','CURRENT_SCHEMA') AS S FROM DUAL",
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const serverVersion = versionRes.rows?.[0]?.V ?? "Oracle (version unavailable)";
    const currentSchema = schemaRes.rows?.[0]?.S ?? p.username.toUpperCase();
    setSession(conn, currentSchema);
    return { serverVersion, currentSchema };
  } catch (err) {
    // Failed during the version/schema bootstrap — clean up the half-open session.
    try { await conn.close(); } catch {}
    throw err;
  }
}

export async function closeSession(): Promise<{ closed: true }> {
  if (hasSession()) {
    try {
      await getActiveSession().close();
    } catch {
      // Best-effort.
    }
    clearSession();
  }
  return { closed: true };
}

// Helper used by metadata handlers to wrap Oracle errors into coded RPC errors
// and to clear stale session state when the connection is gone.
export async function withActiveSession<T>(
  fn: (conn: oracledb.Connection) => Promise<T>
): Promise<T> {
  const conn = getActiveSession();
  try {
    return await fn(conn);
  } catch (err) {
    if (isLostSessionError(err)) {
      clearSession();
      throw new RpcCodedError(SESSION_LOST, (err as Error).message);
    }
    throw new RpcCodedError(
      ORACLE_ERR,
      err instanceof Error ? err.message : String(err)
    );
  }
}
```

- [ ] **Step 2: Type-check sidecar**

Run: `cd sidecar && bunx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Run existing sidecar tests to verify no regression**

Run: `cd sidecar && bun test`
Expected: all prior tests + the 3 state tests + 4 dispatch tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/geraldoviana/Documents/veesker
git add sidecar/src/oracle.ts
git commit -m "feat(sidecar): openSession/closeSession + withActiveSession wrapper"
```

---

## Task 6: Sidecar oracle.ts — metadata queries

**Files:**
- Modify: `sidecar/src/oracle.ts`

- [ ] **Step 1: Append metadata functions and types**

Edit `sidecar/src/oracle.ts` — append at the bottom:

```ts
import { OBJECT_NOT_FOUND } from "./errors";

export type SchemaRow = { name: string; isCurrent: boolean };
export type ObjectRef = { name: string };
export type ObjectKind = "TABLE" | "VIEW" | "SEQUENCE";

export type ColumnDef = {
  name: string;
  dataType: string;
  nullable: boolean;
  isPk: boolean;
  dataDefault: string | null;
  comments: string | null;
};
export type IndexDef = { name: string; isUnique: boolean; columns: string[] };
export type TableDetails = {
  columns: ColumnDef[];
  indexes: IndexDef[];
  rowCount: number | null;
};

function formatDataType(
  dataType: string,
  length: number | null,
  precision: number | null,
  scale: number | null
): string {
  const dt = dataType.toUpperCase();
  if (dt === "NUMBER") {
    if (precision != null && scale != null && scale > 0) return `NUMBER(${precision},${scale})`;
    if (precision != null) return `NUMBER(${precision})`;
    return "NUMBER";
  }
  if (dt === "VARCHAR2" || dt === "NVARCHAR2" || dt === "CHAR" || dt === "NCHAR" || dt === "RAW") {
    return length != null ? `${dt}(${length})` : dt;
  }
  if (dt.startsWith("TIMESTAMP")) {
    return scale != null ? `TIMESTAMP(${scale})` : dt;
  }
  return dt;
}

export async function schemaList(): Promise<{ schemas: SchemaRow[] }> {
  return withActiveSession(async (conn) => {
    const res = await conn.execute<{ NAME: string; IS_CURRENT: number }>(
      `SELECT username AS NAME,
              CASE WHEN username = SYS_CONTEXT('USERENV','CURRENT_SCHEMA') THEN 1 ELSE 0 END AS IS_CURRENT
         FROM all_users
         ORDER BY (CASE WHEN username = SYS_CONTEXT('USERENV','CURRENT_SCHEMA') THEN 0 ELSE 1 END), username`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const schemas: SchemaRow[] = (res.rows ?? []).map((r) => ({
      name: r.NAME,
      isCurrent: r.IS_CURRENT === 1,
    }));
    return { schemas };
  });
}

export async function objectsList(p: {
  owner: string;
  type: ObjectKind;
}): Promise<{ objects: ObjectRef[] }> {
  return withActiveSession(async (conn) => {
    const res = await conn.execute<{ NAME: string }>(
      `SELECT object_name AS NAME
         FROM all_objects
        WHERE owner = :owner AND object_type = :type
        ORDER BY object_name`,
      { owner: p.owner, type: p.type },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    return { objects: (res.rows ?? []).map((r) => ({ name: r.NAME })) };
  });
}

export async function tableDescribe(p: {
  owner: string;
  name: string;
}): Promise<TableDetails> {
  return withActiveSession(async (conn) => {
    const colsRes = await conn.execute<{
      COLUMN_NAME: string;
      DATA_TYPE: string;
      DATA_LENGTH: number | null;
      DATA_PRECISION: number | null;
      DATA_SCALE: number | null;
      NULLABLE: string;
      DATA_DEFAULT: string | null;
      COMMENTS: string | null;
      IS_PK: number;
    }>(
      `SELECT c.column_name, c.data_type, c.data_length, c.data_precision, c.data_scale,
              c.nullable, c.data_default, cc.comments,
              (CASE WHEN pk.column_name IS NOT NULL THEN 1 ELSE 0 END) AS is_pk
         FROM all_tab_columns c
         LEFT JOIN all_col_comments cc
           ON cc.owner = c.owner AND cc.table_name = c.table_name AND cc.column_name = c.column_name
         LEFT JOIN (
           SELECT acc.owner, acc.table_name, acc.column_name
             FROM all_constraints ac
             JOIN all_cons_columns acc
               ON acc.owner = ac.owner AND acc.constraint_name = ac.constraint_name
            WHERE ac.constraint_type = 'P'
         ) pk
           ON pk.owner = c.owner AND pk.table_name = c.table_name AND pk.column_name = c.column_name
        WHERE c.owner = :owner AND c.table_name = :name
        ORDER BY c.column_id`,
      { owner: p.owner, name: p.name },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if ((colsRes.rows ?? []).length === 0) {
      throw new RpcCodedError(
        OBJECT_NOT_FOUND,
        `Object ${p.owner}.${p.name} has no columns or does not exist.`
      );
    }

    const columns: ColumnDef[] = (colsRes.rows ?? []).map((r) => ({
      name: r.COLUMN_NAME,
      dataType: formatDataType(r.DATA_TYPE, r.DATA_LENGTH, r.DATA_PRECISION, r.DATA_SCALE),
      nullable: r.NULLABLE === "Y",
      isPk: r.IS_PK === 1,
      dataDefault: r.DATA_DEFAULT === null ? null : String(r.DATA_DEFAULT).trim(),
      comments: r.COMMENTS,
    }));

    const idxRes = await conn.execute<{
      INDEX_NAME: string;
      UNIQUENESS: string;
      COLUMNS: string;
    }>(
      `SELECT i.index_name, i.uniqueness,
              LISTAGG(ic.column_name, ',') WITHIN GROUP (ORDER BY ic.column_position) AS columns
         FROM all_indexes i
         JOIN all_ind_columns ic
           ON ic.index_owner = i.owner AND ic.index_name = i.index_name
        WHERE i.table_owner = :owner AND i.table_name = :name
        GROUP BY i.index_name, i.uniqueness
        ORDER BY i.index_name`,
      { owner: p.owner, name: p.name },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const indexes: IndexDef[] = (idxRes.rows ?? []).map((r) => ({
      name: r.INDEX_NAME,
      isUnique: r.UNIQUENESS === "UNIQUE",
      columns: r.COLUMNS.split(","),
    }));

    const cntRes = await conn.execute<{ NUM_ROWS: number | null }>(
      `SELECT num_rows AS NUM_ROWS FROM all_tables WHERE owner = :owner AND table_name = :name`,
      { owner: p.owner, name: p.name },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const rowCount = cntRes.rows?.[0]?.NUM_ROWS ?? null;

    return { columns, indexes, rowCount };
  });
}
```

- [ ] **Step 2: Type-check**

Run: `cd sidecar && bunx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Run sidecar tests for no regression**

Run: `cd sidecar && bun test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/geraldoviana/Documents/veesker
git add sidecar/src/oracle.ts
git commit -m "feat(sidecar): schemaList/objectsList/tableDescribe metadata queries"
```

---

## Task 7: Sidecar — register handlers

**Files:**
- Modify: `sidecar/src/index.ts`

- [ ] **Step 1: Update handler map**

Replace the entire contents of `sidecar/src/index.ts` with:

```ts
import { parseRequest, makeError } from "./rpc";
import { dispatch, type HandlerMap } from "./handlers";
import {
  connectionTest,
  openSession,
  closeSession,
  schemaList,
  objectsList,
  tableDescribe,
} from "./oracle";

const handlers: HandlerMap = {
  "connection.test": (params) => connectionTest(params as any),
  "workspace.open": (params) => openSession(params as any),
  "workspace.close": () => closeSession(),
  "schema.list": () => schemaList(),
  "objects.list": (params) => objectsList(params as any),
  "table.describe": (params) => tableDescribe(params as any),
  ping: async () => ({ pong: true }),
};

function writeLine(obj: unknown) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function main() {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of process.stdin as any) {
    buffer += decoder.decode(chunk as Uint8Array, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      const req = parseRequest(line);
      if (!req) {
        writeLine(makeError(null, -32700, "Parse error"));
        continue;
      }
      const res = await dispatch(handlers, req);
      writeLine(res);
    }
  }
}

main().catch((err) => {
  console.error("sidecar fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Build the sidecar binary**

Run: `cd /Users/geraldoviana/Documents/veesker && ./scripts/build-sidecar.sh`
Expected: `Done.` and a refreshed binary at `src-tauri/binaries/veesker-sidecar-<triple>`.

- [ ] **Step 3: Commit**

```bash
cd /Users/geraldoviana/Documents/veesker
git add sidecar/src/index.ts
git commit -m "feat(sidecar): register workspace + metadata handlers"
```

---

## Task 8: Tauri commands + lib.rs registration

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Append the 5 new commands**

Edit `src-tauri/src/commands.rs` — append at the end of the file:

```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub server_version: String,
    pub current_schema: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRow {
    pub name: String,
    pub is_current: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectRef {
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnDef {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub is_pk: bool,
    pub data_default: Option<String>,
    pub comments: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexDef {
    pub name: String,
    pub is_unique: bool,
    pub columns: Vec<String>,
}

// Deserialize is needed because table_describe decodes the sidecar's JSON result
// into this struct via serde_json::from_value(...).
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDetails {
    pub columns: Vec<ColumnDef>,
    pub indexes: Vec<IndexDef>,
    pub row_count: Option<i64>,
}

async fn call_sidecar(app: &AppHandle, method: &str, params: Value) -> Result<Value, ConnectionTestErr> {
    if let Err(err) = ensure(app).await {
        return Err(ConnectionTestErr { code: -32003, message: err });
    }
    let state = app.state::<SidecarState>();
    let guard = state.0.lock().await;
    let sidecar = guard.as_ref().expect("sidecar ensured");
    sidecar.call(method, params).await.map_err(|e| ConnectionTestErr {
        code: e.code,
        message: e.message,
    })
}

fn map_err(e: ConnectionError) -> ConnectionTestErr {
    ConnectionTestErr { code: e.code, message: e.message }
}

#[tauri::command]
pub async fn workspace_open(
    app: AppHandle,
    connection_id: String,
) -> Result<WorkspaceInfo, ConnectionTestErr> {
    let params = {
        let svc = app.state::<ConnectionService>();
        svc.sidecar_params(&connection_id).map_err(map_err)?
    };
    let res = call_sidecar(&app, "workspace.open", params).await?;
    let server_version = res
        .get("serverVersion")
        .and_then(|v| v.as_str())
        .unwrap_or("Oracle (unknown)")
        .to_string();
    let current_schema = res
        .get("currentSchema")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    Ok(WorkspaceInfo { server_version, current_schema })
}

#[tauri::command]
pub async fn workspace_close(app: AppHandle) -> Result<(), ConnectionTestErr> {
    call_sidecar(&app, "workspace.close", json!({})).await?;
    Ok(())
}

#[tauri::command]
pub async fn schema_list(app: AppHandle) -> Result<Vec<SchemaRow>, ConnectionTestErr> {
    let res = call_sidecar(&app, "schema.list", json!({})).await?;
    let arr = res.get("schemas").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    Ok(arr
        .into_iter()
        .filter_map(|v| {
            Some(SchemaRow {
                name: v.get("name")?.as_str()?.to_string(),
                is_current: v.get("isCurrent")?.as_bool().unwrap_or(false),
            })
        })
        .collect())
}

#[tauri::command]
pub async fn objects_list(
    app: AppHandle,
    owner: String,
    kind: String,
) -> Result<Vec<ObjectRef>, ConnectionTestErr> {
    let res = call_sidecar(
        &app,
        "objects.list",
        json!({ "owner": owner, "type": kind }),
    )
    .await?;
    let arr = res.get("objects").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    Ok(arr
        .into_iter()
        .filter_map(|v| Some(ObjectRef { name: v.get("name")?.as_str()?.to_string() }))
        .collect())
}

#[tauri::command]
pub async fn table_describe(
    app: AppHandle,
    owner: String,
    name: String,
) -> Result<TableDetails, ConnectionTestErr> {
    let res = call_sidecar(
        &app,
        "table.describe",
        json!({ "owner": owner, "name": name }),
    )
    .await?;
    serde_json::from_value(res).map_err(|e| ConnectionTestErr {
        code: -32099,
        message: format!("decode table.describe: {e}"),
    })
}
```

- [ ] **Step 2: Register the commands in lib.rs**

Edit `src-tauri/src/lib.rs` — replace the `invoke_handler!` block:

```rust
        .invoke_handler(tauri::generate_handler![
            commands::connection_test,
            commands::connection_list,
            commands::connection_get,
            commands::connection_save,
            commands::connection_delete,
            commands::wallet_inspect,
            commands::workspace_open,
            commands::workspace_close,
            commands::schema_list,
            commands::objects_list,
            commands::table_describe,
        ])
```

- [ ] **Step 3: Compile**

Run: `cd src-tauri && PATH="$HOME/.cargo/bin:$PATH" cargo build --lib`
Expected: 0 errors.

- [ ] **Step 4: Run tests for no regression**

Run: `cd src-tauri && PATH="$HOME/.cargo/bin:$PATH" cargo test --lib`
Expected: 26 passed (24 prior + 2 from Task 1).

- [ ] **Step 5: Commit**

```bash
cd /Users/geraldoviana/Documents/veesker
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: workspace + metadata Tauri commands"
```

---

## Task 9: Frontend workspace.ts API

**Files:**
- Create: `src/lib/workspace.ts`

- [ ] **Step 1: Write the module**

Create `src/lib/workspace.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";

export type WorkspaceInfo = { serverVersion: string; currentSchema: string };
export type Schema = { name: string; isCurrent: boolean };
export type ObjectKind = "TABLE" | "VIEW" | "SEQUENCE";
export type ObjectRef = { name: string };
export type Column = {
  name: string;
  dataType: string;
  nullable: boolean;
  isPk: boolean;
  dataDefault: string | null;
  comments: string | null;
};
export type IndexDef = { name: string; isUnique: boolean; columns: string[] };
export type TableDetails = {
  columns: Column[];
  indexes: IndexDef[];
  rowCount: number | null;
};

export type WorkspaceError = { code: number; message: string };

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: WorkspaceError };

// Generic loading-state ADT used by the workspace components.
export type Loadable<T> =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; value: T }
  | { kind: "err"; message: string };

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<Result<T>> {
  try {
    const data = await invoke<T>(cmd, args);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err as WorkspaceError };
  }
}

export const workspaceOpen  = (connectionId: string) =>
  call<WorkspaceInfo>("workspace_open", { connectionId });
export const workspaceClose = () =>
  call<void>("workspace_close");
export const schemaList     = () =>
  call<Schema[]>("schema_list");
export const objectsList    = (owner: string, kind: ObjectKind) =>
  call<ObjectRef[]>("objects_list", { owner, kind });
export const tableDescribe  = (owner: string, name: string) =>
  call<TableDetails>("table_describe", { owner, name });

// Custom RPC error codes from the sidecar.
export const NO_ACTIVE_SESSION = -32010;
export const SESSION_LOST      = -32011;
export const OBJECT_NOT_FOUND  = -32012;
export const ORACLE_ERR        = -32013;
```

- [ ] **Step 2: Type-check**

Run: `cd /Users/geraldoviana/Documents/veesker && bun run check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/geraldoviana/Documents/veesker
git add src/lib/workspace.ts
git commit -m "feat(web): workspace TS API surface"
```

---

## Task 10: StatusBar component

**Files:**
- Create: `src/lib/workspace/StatusBar.svelte`

- [ ] **Step 1: Write the component**

Create `src/lib/workspace/StatusBar.svelte`:

```svelte
<script lang="ts">
  type Props = {
    connectionName: string;
    userLabel: string;     // e.g. "PDBADMIN @ FREEPDB1" or "ADMIN @ fakedb_high"
    schema: string;
    serverVersion: string;
    onDisconnect: () => void;
  };
  let { connectionName, userLabel, schema, serverVersion, onDisconnect }: Props = $props();
</script>

<div class="bar">
  <span class="dot" aria-hidden="true"></span>
  <strong>{connectionName}</strong>
  <span class="sep">·</span>
  <span class="meta">{userLabel}/{schema}</span>
  <span class="sep">·</span>
  <span class="meta">{serverVersion}</span>
  <button class="disconnect" onclick={onDisconnect}>Disconnect</button>
</div>

<style>
  .bar {
    background: #1a1612;
    color: #f6f1e8;
    padding: 0.5rem 1rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 12px;
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    height: 36px;
    box-sizing: border-box;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #7ec96a;
    display: inline-block;
  }
  strong {
    font-weight: 600;
  }
  .sep {
    opacity: 0.4;
  }
  .meta {
    opacity: 0.75;
    font-family: "JetBrains Mono", "SF Mono", monospace;
    font-size: 11px;
  }
  .disconnect {
    margin-left: auto;
    background: transparent;
    border: 1px solid rgba(246, 241, 232, 0.25);
    color: #f6f1e8;
    font-family: "Space Grotesk", sans-serif;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 0.25rem 0.6rem;
    border-radius: 4px;
    cursor: pointer;
  }
  .disconnect:hover {
    background: #b33e1f;
    border-color: #b33e1f;
  }
</style>
```

- [ ] **Step 2: Type-check**

Run: `cd /Users/geraldoviana/Documents/veesker && bun run check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/geraldoviana/Documents/veesker
git add src/lib/workspace/StatusBar.svelte
git commit -m "feat(web): StatusBar component"
```

---

## Task 11: SchemaTree component

**Files:**
- Create: `src/lib/workspace/SchemaTree.svelte`

- [ ] **Step 1: Write the component**

Create `src/lib/workspace/SchemaTree.svelte`:

```svelte
<script lang="ts">
  import type { ObjectKind, ObjectRef, Loadable } from "$lib/workspace";

  export type SchemaNode = {
    name: string;
    isCurrent: boolean;
    expanded: boolean;
    kinds: {
      TABLE: Loadable<ObjectRef[]>;
      VIEW: Loadable<ObjectRef[]>;
      SEQUENCE: Loadable<ObjectRef[]>;
    };
  };

  type Props = {
    schemas: SchemaNode[];
    selected: { owner: string; name: string; kind: ObjectKind } | null;
    onToggle: (owner: string) => void;
    onSelect: (owner: string, name: string, kind: ObjectKind) => void;
    onRetry: (owner: string, kind: ObjectKind) => void;
  };
  let { schemas, selected, onToggle, onSelect, onRetry }: Props = $props();

  const KIND_LABELS: Record<ObjectKind, string> = {
    TABLE: "Tables",
    VIEW: "Views",
    SEQUENCE: "Sequences",
  };
  const KIND_ORDER: ObjectKind[] = ["TABLE", "VIEW", "SEQUENCE"];

  function isSelected(owner: string, name: string, kind: ObjectKind): boolean {
    return (
      selected?.owner === owner &&
      selected?.name === name &&
      selected?.kind === kind
    );
  }
</script>

<nav class="tree">
  {#each schemas as s (s.name)}
    <div class="schema">
      <button
        class="schema-row"
        class:current={s.isCurrent}
        onclick={() => onToggle(s.name)}
      >
        <span class="chev">{s.expanded ? "▾" : "▸"}</span>
        <span class="name">{s.name}</span>
      </button>

      {#if s.expanded}
        <div class="kinds">
          {#each KIND_ORDER as kind}
            <div class="kind">
              <div class="kind-head">{KIND_LABELS[kind]}</div>
              {#if s.kinds[kind].kind === "loading"}
                <div class="muted">loading…</div>
              {:else if s.kinds[kind].kind === "err"}
                <div class="err">
                  <span>{s.kinds[kind].message}</span>
                  <button class="retry" onclick={() => onRetry(s.name, kind)}>Retry</button>
                </div>
              {:else if s.kinds[kind].kind === "ok"}
                {#each s.kinds[kind].value as o (o.name)}
                  <button
                    class="object"
                    class:selected={isSelected(s.name, o.name, kind)}
                    onclick={() => onSelect(s.name, o.name, kind)}
                  >{o.name}</button>
                {:else}
                  <div class="muted">— none —</div>
                {/each}
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/each}
</nav>

<style>
  .tree {
    width: 280px;
    background: #f0eadd;
    border-right: 1px solid rgba(26, 22, 18, 0.08);
    overflow-y: auto;
    padding: 0.75rem 0.5rem;
    font-size: 12px;
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    box-sizing: border-box;
  }
  .schema {
    margin-bottom: 0.25rem;
  }
  .schema-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    background: transparent;
    border: none;
    padding: 0.3rem 0.4rem;
    cursor: pointer;
    text-align: left;
    color: rgba(26, 22, 18, 0.7);
    font-family: inherit;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    border-radius: 3px;
  }
  .schema-row:hover { background: rgba(179, 62, 31, 0.08); }
  .schema-row.current {
    color: #7a2a14;
    font-weight: 600;
  }
  .chev { width: 0.8em; display: inline-block; }
  .kinds { padding-left: 1rem; margin-top: 0.2rem; }
  .kind { margin-bottom: 0.4rem; }
  .kind-head {
    color: rgba(26, 22, 18, 0.55);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0.1rem 0.4rem;
  }
  .object {
    display: block;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    padding: 0.15rem 0.5rem;
    margin: 0.05rem 0;
    border-radius: 3px;
    font-family: "JetBrains Mono", "SF Mono", monospace;
    font-size: 11px;
    color: rgba(26, 22, 18, 0.78);
    cursor: pointer;
  }
  .object:hover { background: rgba(179, 62, 31, 0.08); }
  .object.selected {
    background: #b33e1f;
    color: #f6f1e8;
  }
  .muted {
    color: rgba(26, 22, 18, 0.4);
    font-size: 10px;
    padding: 0.1rem 0.5rem;
  }
  .err {
    color: #7a2a14;
    font-size: 10px;
    padding: 0.1rem 0.5rem;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .retry {
    background: transparent;
    border: 1px solid rgba(122, 42, 20, 0.4);
    color: #7a2a14;
    font-size: 10px;
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
    cursor: pointer;
  }
</style>
```

- [ ] **Step 2: Type-check**

Run: `cd /Users/geraldoviana/Documents/veesker && bun run check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/geraldoviana/Documents/veesker
git add src/lib/workspace/SchemaTree.svelte
git commit -m "feat(web): SchemaTree component"
```

---

## Task 12: ObjectDetails component

**Files:**
- Create: `src/lib/workspace/ObjectDetails.svelte`

- [ ] **Step 1: Write the component**

Create `src/lib/workspace/ObjectDetails.svelte`:

```svelte
<script lang="ts">
  import type { TableDetails, ObjectKind, Loadable } from "$lib/workspace";

  type Props = {
    selected: { owner: string; name: string; kind: ObjectKind } | null;
    details: Loadable<TableDetails>;
    onRetry: () => void;
    onReconnect?: () => void;
    sessionLost?: boolean;
  };
  let { selected, details, onRetry, onReconnect, sessionLost = false }: Props = $props();
</script>

<section class="details">
  {#if !selected}
    <div class="empty">Select a table or view from the tree on the left.</div>
  {:else if selected.kind === "SEQUENCE"}
    <header>
      <h2>{selected.owner}.{selected.name}</h2>
      <p class="muted">SEQUENCE</p>
    </header>
    <p class="muted">Sequences expose only metadata in this view.</p>
  {:else if details.kind === "loading"}
    <header>
      <h2>{selected.owner}.{selected.name}</h2>
    </header>
    <p class="muted">Loading…</p>
  {:else if details.kind === "err"}
    <header>
      <h2>{selected.owner}.{selected.name}</h2>
    </header>
    {#if sessionLost && onReconnect}
      <div class="banner">
        <strong>Connection dropped.</strong>
        <span>{details.message}</span>
        <button onclick={onReconnect}>Reconnect</button>
      </div>
    {:else}
      <div class="err-card">
        <strong>Failed to load details.</strong>
        <span>{details.message}</span>
        <button onclick={onRetry}>Retry</button>
      </div>
    {/if}
  {:else if details.kind === "ok"}
    {@const d = details.value}
    <header>
      <h2>{selected.owner}.{selected.name}</h2>
      <p class="muted">
        {#if d.rowCount === null}
          ~ unknown rows
        {:else}
          ~ {d.rowCount.toLocaleString()} rows
        {/if}
      </p>
    </header>

    <h3>Columns</h3>
    <table class="cols">
      <thead>
        <tr><th>Name</th><th>Type</th><th>Nullable</th><th>Default</th><th>Comments</th></tr>
      </thead>
      <tbody>
        {#each d.columns as c (c.name)}
          <tr>
            <td class="mono">
              {c.name}
              {#if c.isPk}<span class="pk">PK</span>{/if}
            </td>
            <td class="mono">{c.dataType}</td>
            <td>{c.nullable ? "YES" : "NO"}</td>
            <td class="mono">{c.dataDefault ?? ""}</td>
            <td>{c.comments ?? ""}</td>
          </tr>
        {/each}
      </tbody>
    </table>

    <h3>Indexes</h3>
    {#if d.indexes.length === 0}
      <p class="muted">No indexes.</p>
    {:else}
      <table class="cols">
        <thead>
          <tr><th>Name</th><th>Unique</th><th>Columns</th></tr>
        </thead>
        <tbody>
          {#each d.indexes as i (i.name)}
            <tr>
              <td class="mono">{i.name}</td>
              <td>{i.isUnique ? "UNIQUE" : ""}</td>
              <td class="mono">{i.columns.join(", ")}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {/if}
</section>

<style>
  .details {
    flex: 1;
    overflow-y: auto;
    padding: 1rem 1.5rem;
    background: #fff;
    box-sizing: border-box;
    font-size: 13px;
    font-family: "Inter", -apple-system, system-ui, sans-serif;
  }
  .empty, .muted {
    color: rgba(26, 22, 18, 0.5);
    font-size: 12px;
  }
  header { margin-bottom: 1rem; }
  h2 {
    font-family: "Space Grotesk", sans-serif;
    font-weight: 500;
    font-size: 18px;
    margin: 0;
  }
  h3 {
    font-family: "Space Grotesk", sans-serif;
    font-weight: 500;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(26, 22, 18, 0.6);
    margin: 1.25rem 0 0.5rem;
  }
  table.cols {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  table.cols th {
    text-align: left;
    font-weight: 600;
    color: rgba(26, 22, 18, 0.6);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    border-bottom: 1px solid rgba(26, 22, 18, 0.1);
    padding: 0.4rem 0.5rem;
  }
  table.cols td {
    padding: 0.35rem 0.5rem;
    border-bottom: 1px solid rgba(26, 22, 18, 0.05);
    vertical-align: top;
  }
  .mono {
    font-family: "JetBrains Mono", "SF Mono", monospace;
    font-size: 11.5px;
  }
  .pk {
    display: inline-block;
    margin-left: 0.4rem;
    background: rgba(179, 62, 31, 0.12);
    color: #7a2a14;
    font-family: "Space Grotesk", sans-serif;
    font-size: 9px;
    padding: 0.05rem 0.35rem;
    border-radius: 3px;
    letter-spacing: 0.06em;
  }
  .banner, .err-card {
    background: rgba(179, 62, 31, 0.08);
    color: #7a2a14;
    border: 1px solid rgba(179, 62, 31, 0.3);
    padding: 0.85rem 1rem;
    border-radius: 6px;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 12px;
  }
  .banner button, .err-card button {
    margin-left: auto;
    background: #1a1612;
    color: #f6f1e8;
    border: none;
    padding: 0.4rem 0.85rem;
    border-radius: 4px;
    font-family: "Space Grotesk", sans-serif;
    font-size: 11px;
    cursor: pointer;
  }
</style>
```

- [ ] **Step 2: Type-check**

Run: `cd /Users/geraldoviana/Documents/veesker && bun run check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/geraldoviana/Documents/veesker
git add src/lib/workspace/ObjectDetails.svelte
git commit -m "feat(web): ObjectDetails component"
```

---

## Task 13: Workspace route /workspace/[id]

**Files:**
- Create: `src/routes/workspace/[id]/+page.svelte`

- [ ] **Step 1: Write the orchestrator**

Create `src/routes/workspace/[id]/+page.svelte`:

```svelte
<script lang="ts">
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import StatusBar from "$lib/workspace/StatusBar.svelte";
  import SchemaTree, { type SchemaNode } from "$lib/workspace/SchemaTree.svelte";
  import ObjectDetails from "$lib/workspace/ObjectDetails.svelte";
  import {
    workspaceOpen,
    workspaceClose,
    schemaList,
    objectsList,
    tableDescribe,
    SESSION_LOST,
    type WorkspaceInfo,
    type ObjectKind,
    type TableDetails,
    type Loadable,
  } from "$lib/workspace";
  import { getConnection, type ConnectionMeta } from "$lib/connections";

  let meta     = $state<ConnectionMeta | null>(null);
  let info     = $state<WorkspaceInfo | null>(null);
  let schemas  = $state<SchemaNode[]>([]);
  let selected = $state<{ owner: string; name: string; kind: ObjectKind } | null>(null);
  let details  = $state<Loadable<TableDetails>>({ kind: "idle" });
  let fatal    = $state<string | null>(null);
  let sessionLost = $state(false);

  function userLabel(m: ConnectionMeta): string {
    if (m.authType === "basic") {
      return `${m.username} @ ${m.host}:${m.port}/${m.serviceName}`;
    }
    return `${m.username} @ ${m.connectAlias}`;
  }

  function newSchemaNode(name: string, isCurrent: boolean): SchemaNode {
    return {
      name,
      isCurrent,
      expanded: isCurrent, // current schema starts expanded
      kinds: {
        TABLE: { kind: "idle" },
        VIEW: { kind: "idle" },
        SEQUENCE: { kind: "idle" },
      },
    };
  }

  async function loadKind(node: SchemaNode, kind: ObjectKind): Promise<void> {
    node.kinds[kind] = { kind: "loading" };
    schemas = [...schemas]; // trigger reactivity
    const res = await objectsList(node.name, kind);
    if (res.ok) {
      node.kinds[kind] = { kind: "ok", value: res.data };
    } else {
      if (res.error.code === SESSION_LOST) sessionLost = true;
      node.kinds[kind] = { kind: "err", message: res.error.message };
    }
    schemas = [...schemas];
  }

  function expandIfNeeded(node: SchemaNode): void {
    const kinds: ObjectKind[] = ["TABLE", "VIEW", "SEQUENCE"];
    void Promise.all(
      kinds
        .filter((k) => node.kinds[k].kind === "idle")
        .map((k) => loadKind(node, k))
    );
  }

  function onToggle(owner: string): void {
    const node = schemas.find((s) => s.name === owner);
    if (!node) return;
    node.expanded = !node.expanded;
    schemas = [...schemas];
    if (node.expanded) expandIfNeeded(node);
  }

  function onRetryKind(owner: string, kind: ObjectKind): void {
    const node = schemas.find((s) => s.name === owner);
    if (!node) return;
    void loadKind(node, kind);
  }

  async function loadDetails(owner: string, name: string): Promise<void> {
    details = { kind: "loading" };
    const res = await tableDescribe(owner, name);
    if (res.ok) {
      details = { kind: "ok", value: res.data };
    } else {
      if (res.error.code === SESSION_LOST) sessionLost = true;
      details = { kind: "err", message: res.error.message };
    }
  }

  function onSelect(owner: string, name: string, kind: ObjectKind): void {
    selected = { owner, name, kind };
    if (kind === "SEQUENCE") {
      details = { kind: "idle" };
      return;
    }
    void loadDetails(owner, name);
  }

  function onRetryDetails(): void {
    if (selected && selected.kind !== "SEQUENCE") {
      void loadDetails(selected.owner, selected.name);
    }
  }

  async function bootstrap(): Promise<void> {
    fatal = null;
    sessionLost = false;
    const id = page.params.id!;

    const metaRes = await getConnection(id);
    if (!metaRes.ok) {
      fatal = `Could not load connection: ${metaRes.error.message}`;
      return;
    }
    meta = metaRes.data.meta;

    const openRes = await workspaceOpen(id);
    if (!openRes.ok) {
      fatal = openRes.error.message;
      return;
    }
    info = openRes.data;

    const schemaRes = await schemaList();
    if (!schemaRes.ok) {
      fatal = schemaRes.error.message;
      return;
    }
    schemas = schemaRes.data.map((s) => newSchemaNode(s.name, s.isCurrent));
    // Auto-load the current schema's contents.
    const current = schemas.find((s) => s.isCurrent);
    if (current) expandIfNeeded(current);
  }

  async function onReconnect(): Promise<void> {
    sessionLost = false;
    await bootstrap();
    if (selected && selected.kind !== "SEQUENCE") {
      await loadDetails(selected.owner, selected.name);
    }
  }

  async function onDisconnect(): Promise<void> {
    await workspaceClose();
    await goto("/");
  }

  onMount(() => {
    void bootstrap();
    return () => {
      void workspaceClose();
    };
  });
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link
    href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=Inter:wght@400;500;600&display=swap"
    rel="stylesheet"
  />
</svelte:head>

{#if fatal}
  <main class="fatal">
    <div class="card">
      <strong>Failed to open workspace.</strong>
      <span>{fatal}</span>
      <button onclick={() => goto("/")}>Back to connections</button>
    </div>
  </main>
{:else if !meta || !info}
  <main class="loading">Loading workspace…</main>
{:else}
  <div class="shell">
    <StatusBar
      connectionName={meta.name}
      userLabel={userLabel(meta)}
      schema={info.currentSchema}
      serverVersion={info.serverVersion}
      onDisconnect={onDisconnect}
    />
    <div class="body">
      <SchemaTree
        {schemas}
        {selected}
        onToggle={onToggle}
        onSelect={onSelect}
        onRetry={onRetryKind}
      />
      <ObjectDetails
        {selected}
        {details}
        onRetry={onRetryDetails}
        onReconnect={onReconnect}
        sessionLost={sessionLost}
      />
    </div>
  </div>
{/if}

<style>
  :global(body) {
    margin: 0;
    background: #f6f1e8;
    color: #1a1612;
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }
  .body {
    display: flex;
    flex: 1;
    min-height: 0;
  }
  .fatal {
    max-width: 480px;
    margin: 4rem auto;
    padding: 0 2rem;
  }
  .fatal .card {
    background: rgba(179, 62, 31, 0.08);
    color: #7a2a14;
    border: 1px solid rgba(179, 62, 31, 0.3);
    padding: 1rem;
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .fatal button {
    align-self: flex-start;
    background: #1a1612;
    color: #f6f1e8;
    border: none;
    padding: 0.55rem 0.9rem;
    border-radius: 4px;
    font-family: "Space Grotesk", sans-serif;
    cursor: pointer;
  }
  .loading {
    max-width: 480px;
    margin: 4rem auto;
    color: rgba(26, 22, 18, 0.5);
    font-size: 13px;
  }
</style>
```

- [ ] **Step 2: Type-check**

Run: `cd /Users/geraldoviana/Documents/veesker && bun run check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/geraldoviana/Documents/veesker
git add src/routes/workspace/
git commit -m "feat(web): /workspace/[id] orchestrator route"
```

---

## Task 14: Open button on landing list

**Files:**
- Modify: `src/routes/+page.svelte`

- [ ] **Step 1: Add Open button + style**

Edit `src/routes/+page.svelte` — find the `<div class="actions">` block (around line 96) and add a primary **Open** button before the Edit/Delete pair:

```svelte
          <div class="actions">
            <button class="primary small" onclick={() => goto(`/workspace/${c.id}`)}>Open</button>
            <button class="ghost" onclick={() => goto(`/connections/${c.id}/edit`)}>Edit</button>
            <button class="ghost danger" onclick={() => onDelete(c)}>Delete</button>
          </div>
```

Then in the `<style>` block, add a `.primary.small` rule below the existing `.primary` rule:

```css
  button.primary.small {
    align-self: auto;
    padding: 0.5rem 0.85rem;
    font-size: 12px;
  }
```

- [ ] **Step 2: Type-check + production build**

Run: `cd /Users/geraldoviana/Documents/veesker && bun run check && bun run build`
Expected: 0 type errors, build succeeds, output written to `build/`.

- [ ] **Step 3: Commit**

```bash
cd /Users/geraldoviana/Documents/veesker
git add src/routes/+page.svelte
git commit -m "feat(web): Open button on landing list"
```

---

## Task 15: Smoke test + tag

**Files:** None (manual verification + git tag)

- [ ] **Step 1: Build sidecar + run all tests**

Run:
```bash
cd /Users/geraldoviana/Documents/veesker
./scripts/build-sidecar.sh
cd src-tauri && PATH="$HOME/.cargo/bin:$PATH" cargo test --lib
cd ../sidecar && bun test
```
Expected: sidecar binary refreshed; 26 Rust tests pass; all Bun tests pass.

- [ ] **Step 2: Launch the app**

Run: `cd /Users/geraldoviana/Documents/veesker && bun run tauri dev`
Expected: window opens on `/`, landing list shows saved connections.

- [ ] **Step 3: Open existing basic connection**

Click **Open** on the existing `Ora23Ai` (basic auth) connection.
Expected: navigates to `/workspace/<id>`. Within ~1s the StatusBar shows `● Ora23Ai · PDBADMIN @ localhost:1521/FREEPDB1/PDBADMIN · <Oracle version>` and the SchemaTree appears with `PDBADMIN` auto-expanded.

- [ ] **Step 4: Browse a table**

Inside `PDBADMIN.Tables` click any table.
Expected: ObjectDetails pane shows `OWNER.NAME`, `~ N rows` (or `~ unknown rows`), Columns table with types/PK markers, Indexes section.

- [ ] **Step 5: Expand another schema**

Click chevron on `SYS` (or any other system schema).
Expected: spinner, then 3 lists (Tables/Views/Sequences) populate. Selecting a table from `SYS` swaps the details pane.

- [ ] **Step 6: Sequence stub**

Expand a schema with sequences (or click SEQUENCES under PDBADMIN if any) and click one.
Expected: details pane shows the metadata-only stub.

- [ ] **Step 7: Disconnect**

Click **Disconnect** in the StatusBar.
Expected: routes to `/`. Saved connections list still intact.

- [ ] **Step 8: Re-open + replace semantics**

Click **Open** on the same connection again.
Expected: workspace mounts cleanly. In Activity Monitor verify only one `veesker-sidecar` process is running (no stacking).

- [ ] **Step 9: Hard refresh**

On `/workspace/<id>`, press ⌘R.
Expected: workspace re-mounts, status bar repopulates within ~1s, tree auto-loads current schema.

- [ ] **Step 10: Regression — landing flows**

Create a fake basic connection (any host, save), then edit it, then delete it.
Expected: all flows from MVP2 still work — no regression from this phase.

- [ ] **Step 11: Tag**

```bash
cd /Users/geraldoviana/Documents/veesker
git tag v0.0.5-schema-browser
```

---

## Verification target (recap)

- 24 prior Rust tests + 2 new in `connection_config` = **26 passing**
- 3 prior sidecar tests + 1 new dispatcher test + 3 new state tests = **7 passing** (or equivalent — depending on `rpc.test.ts` count)
- `bun run check` clean (0 type errors)
- `bun run build` succeeds with the static adapter
- All 11 manual smoke steps pass against the local `oracle23ai` container
- `git tag v0.0.5-schema-browser` placed on the final commit
