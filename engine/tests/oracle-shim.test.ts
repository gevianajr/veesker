import { describe, expect, it } from "bun:test";
import { mapOracleType, mapDuckDBType } from "../src/oracle-shim/types";

describe("oracle-shim type adapter — Oracle → DuckDB", () => {
  const cases: Array<[string, string]> = [
    ["NUMBER(10,2)", "DECIMAL(10,2)"],
    ["NUMBER(10)", "DECIMAL(10,0)"],
    ["NUMBER", "DOUBLE"],
    ["VARCHAR2(100)", "VARCHAR"],
    ["VARCHAR2(100 CHAR)", "VARCHAR"],
    ["NVARCHAR2(50)", "VARCHAR"],
    ["CHAR(10)", "VARCHAR"],
    ["CLOB", "VARCHAR"],
    ["NCLOB", "VARCHAR"],
    ["DATE", "TIMESTAMP"],
    ["TIMESTAMP", "TIMESTAMP"],
    ["TIMESTAMP(6)", "TIMESTAMP"],
    ["TIMESTAMP WITH TIME ZONE", "TIMESTAMPTZ"],
    ["TIMESTAMP(6) WITH TIME ZONE", "TIMESTAMPTZ"],
    ["TIMESTAMP WITH LOCAL TIME ZONE", "TIMESTAMPTZ"],
    ["BLOB", "BLOB"],
    ["RAW(16)", "BLOB"],
    ["BFILE", "BLOB"],
    ["FLOAT", "DOUBLE"],
    ["FLOAT(53)", "DOUBLE"],
    ["BINARY_FLOAT", "FLOAT"],
    ["BINARY_DOUBLE", "DOUBLE"],
  ];

  for (const [oracle, duck] of cases) {
    it(`maps ${oracle} → ${duck}`, () => {
      expect(mapOracleType(oracle)).toBe(duck);
    });
  }

  it("treats Oracle types as case-insensitive", () => {
    expect(mapOracleType("number(10,2)")).toBe("DECIMAL(10,2)");
    expect(mapOracleType("varchar2(50)")).toBe("VARCHAR");
  });

  it("trims surrounding whitespace", () => {
    expect(mapOracleType("  NUMBER(5)  ")).toBe("DECIMAL(5,0)");
  });

  it("falls back to VARCHAR for unknown Oracle types", () => {
    expect(mapOracleType("XMLTYPE")).toBe("VARCHAR");
    expect(mapOracleType("SDO_GEOMETRY")).toBe("VARCHAR");
    expect(mapOracleType("")).toBe("VARCHAR");
  });
});

describe("oracle-shim type adapter — DuckDB → Oracle", () => {
  it("maps DECIMAL(p,s) back to NUMBER(p,s)", () => {
    expect(mapDuckDBType("DECIMAL(10,2)")).toBe("NUMBER(10,2)");
    expect(mapDuckDBType("DECIMAL(38,0)")).toBe("NUMBER(38,0)");
  });

  it("maps DuckDB integer types to Oracle NUMBER(p,0)", () => {
    expect(mapDuckDBType("INTEGER")).toBe("NUMBER(10,0)");
    expect(mapDuckDBType("INT")).toBe("NUMBER(10,0)");
    expect(mapDuckDBType("BIGINT")).toBe("NUMBER(19,0)");
    expect(mapDuckDBType("SMALLINT")).toBe("NUMBER(5,0)");
    expect(mapDuckDBType("TINYINT")).toBe("NUMBER(3,0)");
  });

  it("maps DuckDB string types to VARCHAR2", () => {
    expect(mapDuckDBType("VARCHAR")).toBe("VARCHAR2(4000)");
  });

  it("maps DuckDB timestamps", () => {
    expect(mapDuckDBType("TIMESTAMP")).toBe("TIMESTAMP");
    expect(mapDuckDBType("TIMESTAMPTZ")).toBe("TIMESTAMP WITH TIME ZONE");
  });

  it("maps DuckDB BLOB → Oracle BLOB", () => {
    expect(mapDuckDBType("BLOB")).toBe("BLOB");
  });

  it("maps DuckDB FLOAT/DOUBLE", () => {
    expect(mapDuckDBType("FLOAT")).toBe("BINARY_FLOAT");
    expect(mapDuckDBType("DOUBLE")).toBe("BINARY_DOUBLE");
  });

  it("falls back to VARCHAR2(4000) for unknown DuckDB types", () => {
    expect(mapDuckDBType("UNION")).toBe("VARCHAR2(4000)");
    expect(mapDuckDBType("MAP(VARCHAR, INTEGER)")).toBe("VARCHAR2(4000)");
  });

  it("is case-insensitive", () => {
    expect(mapDuckDBType("decimal(5,2)")).toBe("NUMBER(5,2)");
    expect(mapDuckDBType("bigint")).toBe("NUMBER(19,0)");
  });
});

describe("type adapter round-trip stability", () => {
  it("round-trips common Oracle types stably (where lossless)", () => {
    expect(mapDuckDBType(mapOracleType("NUMBER(10,2)"))).toBe("NUMBER(10,2)");
    expect(mapDuckDBType(mapOracleType("BLOB"))).toBe("BLOB");
    expect(mapDuckDBType(mapOracleType("BINARY_FLOAT"))).toBe("BINARY_FLOAT");
    expect(mapDuckDBType(mapOracleType("BINARY_DOUBLE"))).toBe("BINARY_DOUBLE");
  });
});
