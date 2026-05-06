// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/veesker-cloud/veesker-community-edition

import { describe, expect, test, beforeEach, mock } from "bun:test";
import {
  buildModuleString,
  buildClientInfoString,
  buildClientIdentifierString,
  assertAutoCommitFalse,
  setSessionAction,
} from "../src/oracle";
import { SESSION_UUID } from "../src/state";
import { setSession, clearSession } from "../src/state";
import { AUTOCOMMIT_VIOLATION, RpcCodedError } from "../src/errors";

describe("SESSION_UUID", () => {
  test("matches RFC 4122 v4 shape", () => {
    const re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(re.test(SESSION_UUID)).toBe(true);
  });

  test("is stable across imports within the same process", async () => {
    const again = await import("../src/state");
    expect(again.SESSION_UUID).toBe(SESSION_UUID);
  });
});

describe("buildModuleString", () => {
  test("formats as 'Veesker IDE <version>'", () => {
    expect(buildModuleString("0.2.5")).toBe("Veesker IDE 0.2.5");
  });

  test("truncates to Oracle MODULE limit (48 chars)", () => {
    const longVersion = "9.9.9-prerelease-build-1234567890.alpha.beta";
    const out = buildModuleString(longVersion);
    expect(out.length).toBeLessThanOrEqual(48);
    expect(out.startsWith("Veesker IDE ")).toBe(true);
  });

  test("handles 'unknown' fallback", () => {
    expect(buildModuleString("unknown")).toBe("Veesker IDE unknown");
  });
});

describe("buildClientInfoString", () => {
  test("formats as 'user@host'", () => {
    expect(buildClientInfoString("alice", "laptop-01")).toBe("alice@laptop-01");
  });

  test("truncates to Oracle CLIENT_INFO limit (64 chars)", () => {
    const u = "x".repeat(40);
    const h = "y".repeat(40);
    const out = buildClientInfoString(u, h);
    expect(out.length).toBeLessThanOrEqual(64);
  });
});

describe("buildClientIdentifierString", () => {
  test("prefixes with 'vsk-'", () => {
    expect(buildClientIdentifierString("00000000-0000-4000-8000-000000000000")).toBe(
      "vsk-00000000-0000-4000-8000-000000000000"
    );
  });

  test("truncates to Oracle CLIENT_IDENTIFIER limit (64 chars)", () => {
    const out = buildClientIdentifierString("a".repeat(100));
    expect(out.length).toBeLessThanOrEqual(64);
    expect(out.startsWith("vsk-")).toBe(true);
  });
});

describe("assertAutoCommitFalse", () => {
  test("passes when autoCommit is false", () => {
    const conn = { autoCommit: false } as any;
    expect(() => assertAutoCommitFalse(conn)).not.toThrow();
  });

  test("passes when autoCommit is undefined", () => {
    const conn = {} as any;
    expect(() => assertAutoCommitFalse(conn)).not.toThrow();
  });

  test("throws AUTOCOMMIT_VIOLATION when autoCommit is true", () => {
    const conn = { autoCommit: true } as any;
    let caught: unknown;
    try {
      assertAutoCommitFalse(conn);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RpcCodedError);
    expect((caught as RpcCodedError).code).toBe(AUTOCOMMIT_VIOLATION);
    // Connection must be forced back to safe state, even on violation.
    expect(conn.autoCommit).toBe(false);
  });

  test("throws AUTOCOMMIT_VIOLATION when autoCommit is a truthy non-boolean", () => {
    const conn = { autoCommit: 1 } as any;
    expect(() => assertAutoCommitFalse(conn)).toThrow(RpcCodedError);
  });
});

describe("setSessionAction", () => {
  beforeEach(() => clearSession());

  test("sends DBMS_APPLICATION_INFO.SET_MODULE with truncated action", async () => {
    const exec = mock(async () => ({}));
    setSession({ execute: exec, autoCommit: false } as any, "SCOTT");
    await setSessionAction("Schema Browser");
    expect(exec).toHaveBeenCalled();
    const [sql, binds] = exec.mock.calls[0] as [string, Record<string, string>];
    expect(sql).toContain("DBMS_APPLICATION_INFO.SET_MODULE");
    expect(binds.module).toMatch(/^Veesker IDE /);
    expect(binds.action).toBe("Schema Browser");
  });

  test("truncates action to 32 chars", async () => {
    const exec = mock(async () => ({}));
    setSession({ execute: exec, autoCommit: false } as any, "SCOTT");
    const longAction = "A".repeat(100);
    await setSessionAction(longAction);
    const [, binds] = exec.mock.calls[0] as [string, Record<string, string>];
    expect(binds.action.length).toBeLessThanOrEqual(32);
  });

  test("does not throw when Oracle rejects the SET_MODULE call", async () => {
    const exec = mock(async () => {
      throw new Error("ORA-00942: table or view does not exist");
    });
    setSession({ execute: exec, autoCommit: false } as any, "SCOTT");
    await expect(setSessionAction("X")).resolves.toBeUndefined();
  });
});
