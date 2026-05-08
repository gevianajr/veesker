// Copyright 2022-2026 Geraldo Ferreira Viana Júnior
// Licensed under the Apache License, Version 2.0
// https://github.com/veesker-cloud/veesker-community-edition

// Security item #2 — env-calibrated unsafe-DML guards.
// Tests cover sql-kind helpers (isMergeSql, isTruncateSql, extractTableFromSql,
// WHERE EXISTS detection), all bypass scenarios A–N, and the clock-injected
// expiry scenario (scenario J — now automated).

import { describe, expect, test, beforeEach } from "bun:test";
import { setSession, clearSession, setSessionSafety } from "../src/state";
import { queryExecute, unlockUnsafeDml, _testInjectClock, _testResetClock } from "../src/oracle";
import {
  UNSAFE_DML_WARNING,
  UNSAFE_DML_STAGING,
  UNSAFE_DML_PROD_BLOCKED,
  TRUNCATE_PROD_BLOCKED,
  RpcCodedError,
} from "../src/errors";
import {
  isUnsafeBulkDml,
  isMergeSql,
  isTruncateSql,
  extractTableFromSql,
} from "../src/sql-kind";

function fakeDmlConn() {
  return {
    execute: async () => ({ metaData: undefined, rows: undefined, rowsAffected: 5 }),
    getDbmsOutput: async () => [],
  } as any;
}

function devSafety(overrides?: Record<string, unknown>) {
  return { env: "dev", warnUnsafeDml: false, readOnly: false, autoPerfAnalysis: false, airgapMode: false, psdpmMode: false, autoExplainMode: "manual", ...overrides } as any;
}
function stagingSafety(overrides?: Record<string, unknown>) {
  return { env: "staging", warnUnsafeDml: true, readOnly: false, autoPerfAnalysis: false, airgapMode: false, psdpmMode: false, autoExplainMode: "when_dml", ...overrides } as any;
}
function prodSafety(overrides?: Record<string, unknown>) {
  return { env: "prod", warnUnsafeDml: true, readOnly: false, autoPerfAnalysis: false, airgapMode: false, psdpmMode: false, autoExplainMode: "when_dml", ...overrides } as any;
}

beforeEach(() => {
  clearSession();
  _testResetClock();
});

// ─── sql-kind helpers ───────────────────────────────────────────────────────

describe("isMergeSql", () => {
  test("detects plain MERGE", () => {
    expect(isMergeSql("MERGE INTO hr.employees USING dual ON (1=1) WHEN MATCHED THEN DELETE")).toBe(true);
  });
  test("detects MERGE after leading comment", () => {
    expect(isMergeSql("-- comment\nMERGE INTO t USING s ON (t.id = s.id) WHEN MATCHED THEN UPDATE SET x = 1")).toBe(true);
  });
  test("does not flag UPDATE", () => {
    expect(isMergeSql("UPDATE employees SET salary = 0")).toBe(false);
  });
  test("does not flag SELECT", () => {
    expect(isMergeSql("SELECT * FROM employees")).toBe(false);
  });
});

describe("isTruncateSql", () => {
  test("detects TRUNCATE TABLE", () => {
    expect(isTruncateSql("TRUNCATE TABLE hr.employees")).toBe(true);
  });
  test("detects TRUNCATE without TABLE keyword", () => {
    expect(isTruncateSql("TRUNCATE employees")).toBe(true);
  });
  test("does not flag DROP TABLE", () => {
    expect(isTruncateSql("DROP TABLE employees")).toBe(false);
  });
});

describe("extractTableFromSql", () => {
  test("UPDATE simple", () => expect(extractTableFromSql("UPDATE employees SET salary = 0")).toBe("EMPLOYEES"));
  test("UPDATE schema.table", () => expect(extractTableFromSql("UPDATE hr.employees SET salary = 0")).toBe("HR.EMPLOYEES"));
  test("DELETE FROM simple", () => expect(extractTableFromSql("DELETE FROM employees WHERE 1=1")).toBe("EMPLOYEES"));
  test("DELETE FROM schema.table", () => expect(extractTableFromSql("DELETE FROM hr.employees")).toBe("HR.EMPLOYEES"));
  test("TRUNCATE TABLE", () => expect(extractTableFromSql("TRUNCATE TABLE hr.employees")).toBe("HR.EMPLOYEES"));
  test("TRUNCATE without TABLE keyword", () => expect(extractTableFromSql("TRUNCATE employees")).toBe("EMPLOYEES"));
  test("MERGE INTO schema.table", () => expect(extractTableFromSql("MERGE INTO hr.employees USING dual ON (1=1) WHEN MATCHED THEN DELETE")).toBe("HR.EMPLOYEES"));
  test("returns empty for SELECT", () => expect(extractTableFromSql("SELECT * FROM t")).toBe(""));
});

describe("isUnsafeBulkDml — WHERE EXISTS FROM DUAL", () => {
  test("WHERE EXISTS (SELECT 1 FROM DUAL) is unsafe", () => {
    expect(isUnsafeBulkDml("DELETE FROM employees WHERE EXISTS (SELECT 1 FROM DUAL)")).toBe(true);
  });
  test("WHERE EXISTS (SELECT * FROM DUAL) is unsafe", () => {
    expect(isUnsafeBulkDml("UPDATE employees SET salary = 0 WHERE EXISTS (SELECT * FROM DUAL)")).toBe(true);
  });
  test("WHERE EXISTS with correlated subquery is NOT flagged (false negative by design)", () => {
    expect(isUnsafeBulkDml("DELETE FROM employees WHERE EXISTS (SELECT 1 FROM dept d WHERE d.id = employees.dept_id)")).toBe(false);
  });
});

// ─── Scenario A: UPDATE without WHERE, warnUnsafeDml=false, dev → passes ───

describe("Scenario A — dev, warnUnsafeDml=false, unsafe DML passes", () => {
  test("UPDATE without WHERE passes silently on dev with guard off", async () => {
    setSession(fakeDmlConn(), "HR");
    setSessionSafety(devSafety({ warnUnsafeDml: false }));
    const r = await queryExecute({ sql: "UPDATE employees SET salary = 0" });
    expect((r as any).rowCount).toBe(5);
  });
});

// ─── Scenario B: UPDATE without WHERE, warnUnsafeDml=true, dev → -32031 / acknowledge ──

describe("Scenario B — dev, warnUnsafeDml=true, single confirm", () => {
  test("throws UNSAFE_DML_WARNING (-32031) without acknowledgeUnsafe", async () => {
    setSession(fakeDmlConn(), "HR");
    setSessionSafety(devSafety({ warnUnsafeDml: true }));
    let caught: any;
    try { await queryExecute({ sql: "UPDATE employees SET salary = 0" }); }
    catch (e) { caught = e; }
    expect(caught?.code).toBe(UNSAFE_DML_WARNING);
    expect(caught?.code).toBe(-32031);
  });

  test("passes with acknowledgeUnsafe=true", async () => {
    setSession(fakeDmlConn(), "HR");
    setSessionSafety(devSafety({ warnUnsafeDml: true }));
    const r = await queryExecute({ sql: "UPDATE employees SET salary = 0", acknowledgeUnsafe: true });
    expect((r as any).rowCount).toBe(5);
  });
});

// ─── Scenario C: DELETE without WHERE, staging → -32038 / acknowledgeTable ─

describe("Scenario C — staging, DELETE without WHERE, double confirm", () => {
  test("throws UNSAFE_DML_STAGING (-32038) without acknowledgeTable", async () => {
    setSession(fakeDmlConn(), "HR");
    setSessionSafety(stagingSafety());
    let caught: any;
    try { await queryExecute({ sql: "DELETE FROM hr.employees" }); }
    catch (e) { caught = e; }
    expect(caught?.code).toBe(UNSAFE_DML_STAGING);
    expect(caught?.code).toBe(-32038);
    expect(caught?.data?.table).toBe("HR.EMPLOYEES");
  });

  test("passes with correct acknowledgeTable", async () => {
    setSession(fakeDmlConn(), "HR");
    setSessionSafety(stagingSafety());
    const r = await queryExecute({ sql: "DELETE FROM hr.employees", acknowledgeTable: "HR.EMPLOYEES" });
    expect((r as any).rowCount).toBe(5);
  });

  test("throws on wrong acknowledgeTable", async () => {
    setSession(fakeDmlConn(), "HR");
    setSessionSafety(stagingSafety());
    let caught: any;
    try { await queryExecute({ sql: "DELETE FROM hr.employees", acknowledgeTable: "HR.DEPARTMENTS" }); }
    catch (e) { caught = e; }
    expect(caught?.code).toBe(UNSAFE_DML_STAGING);
  });
});

// ─── Scenario D: TRUNCATE, staging → -32038 (confirmable) ──────────────────

describe("Scenario D — staging, TRUNCATE, double confirm", () => {
  test("throws UNSAFE_DML_STAGING for TRUNCATE without acknowledge", async () => {
    setSession(fakeDmlConn(), "HR");
    setSessionSafety(stagingSafety());
    let caught: any;
    try { await queryExecute({ sql: "TRUNCATE TABLE hr.employees" }); }
    catch (e) { caught = e; }
    expect(caught?.code).toBe(UNSAFE_DML_STAGING);
  });

  test("passes TRUNCATE on staging with correct acknowledgeTable", async () => {
    setSession(fakeDmlConn(), "HR");
    setSessionSafety(stagingSafety());
    const r = await queryExecute({ sql: "TRUNCATE TABLE hr.employees", acknowledgeTable: "HR.EMPLOYEES" });
    expect((r as any).rowCount).toBe(5);
  });
});

// ─── Scenario E: UPDATE without WHERE, prod, no unlock → -32039 ─────────────

describe("Scenario E — prod, UPDATE without WHERE, no unlock window", () => {
  test("throws UNSAFE_DML_PROD_BLOCKED (-32039) without unlock", async () => {
    setSession(fakeDmlConn(), "HR");
    setSessionSafety(prodSafety());
    let caught: any;
    try { await queryExecute({ sql: "UPDATE hr.employees SET salary = 0" }); }
    catch (e) { caught = e; }
    expect(caught?.code).toBe(UNSAFE_DML_PROD_BLOCKED);
    expect(caught?.code).toBe(-32039);
    expect(caught?.data?.table).toBe("HR.EMPLOYEES");
  });
});

// ─── Scenario F: UPDATE without WHERE, prod + valid unlock → passes + consumed

describe("Scenario F — prod, UPDATE without WHERE, valid unlock window", () => {
  test("passes and consumes the window", async () => {
    setSession(fakeDmlConn(), "HR");
    setSessionSafety(prodSafety());
    unlockUnsafeDml({ table: "HR.EMPLOYEES" });
    const r = await queryExecute({ sql: "UPDATE hr.employees SET salary = 0" });
    expect((r as any).rowCount).toBe(5);
  });

  test("window is one-shot — second execution is blocked", async () => {
    setSession(fakeDmlConn(), "HR");
    setSessionSafety(prodSafety());
    unlockUnsafeDml({ table: "HR.EMPLOYEES" });
    await queryExecute({ sql: "UPDATE hr.employees SET salary = 0" });
    let caught: any;
    try { await queryExecute({ sql: "UPDATE hr.employees SET salary = 0" }); }
    catch (e) { caught = e; }
    expect(caught?.code).toBe(UNSAFE_DML_PROD_BLOCKED);
  });
});

// ─── Scenario G: unlock for table A, run table B → blocked ──────────────────

describe("Scenario G — prod, unlock table mismatch", () => {
  test("wrong table in unlock window is blocked", async () => {
    setSession(fakeDmlConn(), "HR");
    setSessionSafety(prodSafety());
    unlockUnsafeDml({ table: "HR.DEPARTMENTS" });
    let caught: any;
    try { await queryExecute({ sql: "UPDATE hr.employees SET salary = 0" }); }
    catch (e) { caught = e; }
    expect(caught?.code).toBe(UNSAFE_DML_PROD_BLOCKED);
  });
});

// ─── Scenario H: TRUNCATE on prod → -32040 always ───────────────────────────

describe("Scenario H — prod, TRUNCATE, no bypass", () => {
  test("throws TRUNCATE_PROD_BLOCKED (-32040)", async () => {
    setSession(fakeDmlConn(), "HR");
    setSessionSafety(prodSafety());
    let caught: any;
    try { await queryExecute({ sql: "TRUNCATE TABLE hr.employees" }); }
    catch (e) { caught = e; }
    expect(caught?.code).toBe(TRUNCATE_PROD_BLOCKED);
    expect(caught?.code).toBe(-32040);
  });
});

// ─── Scenario I: unlock attempted before TRUNCATE, TRUNCATE still blocked ───

describe("Scenario I — prod, unlock then TRUNCATE still blocked", () => {
  test("unlockUnsafeDml does not unblock TRUNCATE", async () => {
    setSession(fakeDmlConn(), "HR");
    setSessionSafety(prodSafety());
    unlockUnsafeDml({ table: "HR.EMPLOYEES" });
    let caught: any;
    try { await queryExecute({ sql: "TRUNCATE TABLE hr.employees" }); }
    catch (e) { caught = e; }
    expect(caught?.code).toBe(TRUNCATE_PROD_BLOCKED);
  });
});

// ─── Scenario J: window expired (clock injection — automated) ───────────────

describe("Scenario J — prod, expired unlock window (clock-injected)", () => {
  test("expired window blocks execution", async () => {
    const BASE = 1_000_000;
    _testInjectClock({ now: () => BASE });
    setSession(fakeDmlConn(), "HR");
    setSessionSafety(prodSafety());
    unlockUnsafeDml({ table: "HR.EMPLOYEES" });
    // Advance clock past the 15-minute TTL
    _testInjectClock({ now: () => BASE + 16 * 60 * 1000 });
    let caught: any;
    try { await queryExecute({ sql: "UPDATE hr.employees SET salary = 0" }); }
    catch (e) { caught = e; }
    expect(caught?.code).toBe(UNSAFE_DML_PROD_BLOCKED);
  });

  test("window still valid just before TTL", async () => {
    const BASE = 1_000_000;
    _testInjectClock({ now: () => BASE });
    setSession(fakeDmlConn(), "HR");
    setSessionSafety(prodSafety());
    unlockUnsafeDml({ table: "HR.EMPLOYEES" });
    _testInjectClock({ now: () => BASE + 14 * 60 * 1000 });
    const r = await queryExecute({ sql: "UPDATE hr.employees SET salary = 0" });
    expect((r as any).rowCount).toBe(5);
  });
});

// ─── Scenario K: acknowledgeUnsafe=true ignored on prod ─────────────────────

describe("Scenario K — prod, acknowledgeUnsafe=true is ignored", () => {
  test("prod blocks even with acknowledgeUnsafe=true (window required)", async () => {
    setSession(fakeDmlConn(), "HR");
    setSessionSafety(prodSafety());
    let caught: any;
    try { await queryExecute({ sql: "UPDATE hr.employees SET salary = 0", acknowledgeUnsafe: true }); }
    catch (e) { caught = e; }
    expect(caught?.code).toBe(UNSAFE_DML_PROD_BLOCKED);
  });
});

// ─── Scenario L: WHERE 1=1 disguise on prod ─────────────────────────────────

describe("Scenario L — prod, WHERE 1=1 disguise", () => {
  test("UPDATE ... WHERE 1=1 is blocked on prod", async () => {
    setSession(fakeDmlConn(), "HR");
    setSessionSafety(prodSafety());
    let caught: any;
    try { await queryExecute({ sql: "UPDATE hr.employees SET salary = 0 WHERE 1=1" }); }
    catch (e) { caught = e; }
    expect(caught?.code).toBe(UNSAFE_DML_PROD_BLOCKED);
  });
});

// ─── Scenario N: MERGE on prod → blocked ────────────────────────────────────

describe("Scenario N — prod, MERGE blocked", () => {
  test("MERGE without unlock is blocked on prod", async () => {
    setSession(fakeDmlConn(), "HR");
    setSessionSafety(prodSafety());
    let caught: any;
    try {
      await queryExecute({ sql: "MERGE INTO hr.employees e USING dual ON (1=1) WHEN MATCHED THEN DELETE" });
    }
    catch (e) { caught = e; }
    expect(caught?.code).toBe(UNSAFE_DML_PROD_BLOCKED);
  });

  test("MERGE passes on prod with correct unlock window", async () => {
    setSession(fakeDmlConn(), "HR");
    setSessionSafety(prodSafety());
    unlockUnsafeDml({ table: "HR.EMPLOYEES" });
    const r = await queryExecute({ sql: "MERGE INTO hr.employees e USING dual ON (1=1) WHEN MATCHED THEN DELETE" });
    expect((r as any).rowCount).toBe(5);
  });

  test("MERGE in staging requires double confirm", async () => {
    setSession(fakeDmlConn(), "HR");
    setSessionSafety(stagingSafety());
    let caught: any;
    try {
      await queryExecute({ sql: "MERGE INTO hr.employees e USING dual ON (1=1) WHEN MATCHED THEN DELETE" });
    }
    catch (e) { caught = e; }
    expect(caught?.code).toBe(UNSAFE_DML_STAGING);
  });
});

// ─── unlockUnsafeDml validation ──────────────────────────────────────────────

describe("workspace.unlockUnsafeDml validation", () => {
  test("throws UNSAFE_DML_PROD_BLOCKED on non-prod connection", () => {
    setSession(fakeDmlConn(), "HR");
    setSessionSafety(stagingSafety());
    expect(() => unlockUnsafeDml({ table: "HR.EMPLOYEES" })).toThrow();
    try { unlockUnsafeDml({ table: "HR.EMPLOYEES" }); }
    catch (e: any) { expect(e.code).toBe(UNSAFE_DML_PROD_BLOCKED); }
  });

  test("throws when table is empty string", () => {
    setSession(fakeDmlConn(), "HR");
    setSessionSafety(prodSafety());
    expect(() => unlockUnsafeDml({ table: "" })).toThrow();
  });

  test("returns ok and expiresAt", () => {
    setSession(fakeDmlConn(), "HR");
    setSessionSafety(prodSafety());
    _testInjectClock({ now: () => 1_000_000 });
    const res = unlockUnsafeDml({ table: "HR.EMPLOYEES" });
    expect(res.ok).toBe(true);
    expect(res.expiresAt).toBe(1_000_000 + 15 * 60 * 1000);
  });
});
