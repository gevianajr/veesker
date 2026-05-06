// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/veesker-cloud/veesker-community-edition

import { invoke } from "@tauri-apps/api/core";
import type { Result, WorkspaceError } from "$lib/workspace";

export type QueryColumn = { name: string; dataType: string };
export type QueryResult = {
  columns: QueryColumn[];
  rows: unknown[][];
  rowCount: number;
  elapsedMs: number;
};

// Server-side discriminated union for multi-statement results.
export type ServerStatementResult =
  | { status: "ok"; statementIndex: number; sql: string; elapsedMs: number; columns: QueryColumn[]; rows: unknown[][]; rowCount: number; output: string[] | null }
  | { status: "error"; statementIndex: number; sql: string; elapsedMs: number; error: { code: number; message: string }; output: string[] | null }
  | { status: "cancelled"; statementIndex: number; sql: string; elapsedMs: number; output: null };

export type MultiQueryResult = { multi: true; results: ServerStatementResult[] };

// L2.2 Origin attribution: tag of who/what initiated this SQL. Defaults to
// "user_typed" when omitted. Known values: user_typed, user_clicked,
// ai_approved, system_background, schema_browser, autocomplete_prep,
// sandbox_internal, embed_batch, system_identification.
export type SqlOrigin =
  | "user_typed"
  | "user_clicked"
  | "ai_approved"
  | "system_background"
  | "schema_browser"
  | "autocomplete_prep"
  | "sandbox_internal"
  | "embed_batch"
  | "system_identification";

export async function queryExecute(
  sql: string,
  requestId: string,
  fetchAll: boolean = false,
  acknowledgeUnsafe: boolean = false,
  origin: SqlOrigin = "user_typed",
  originDetail?: string,
): Promise<Result<QueryResult>> {
  try {
    const data = await invoke<QueryResult>("query_execute", {
      sql,
      requestId,
      splitMulti: false,
      fetchAll,
      acknowledgeUnsafe,
      origin,
      originDetail,
    });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err as WorkspaceError };
  }
}

export async function queryExecuteMulti(
  sql: string,
  requestId: string,
  acknowledgeUnsafe: boolean = false,
  origin: SqlOrigin = "user_typed",
  originDetail?: string,
): Promise<Result<MultiQueryResult>> {
  try {
    const data = await invoke<MultiQueryResult>("query_execute", {
      sql,
      requestId,
      splitMulti: true,
      acknowledgeUnsafe,
      origin,
      originDetail,
    });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err as WorkspaceError };
  }
}

export async function queryCancel(
  requestId: string
): Promise<Result<{ cancelled: boolean; requestId: string | null }>> {
  try {
    const data = await invoke<{ cancelled: boolean; requestId: string | null }>("query_cancel", {
      requestId,
    });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err as WorkspaceError };
  }
}
