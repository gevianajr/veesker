import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const frontendPath = resolve(here, "./sql-splitter.ts");
const sidecarPath = resolve(here, "../../sidecar/src/sql-splitter.ts");

function stripLeadingCommentBlock(src: string): string {
  const lines = src.split("\n");
  let i = 0;
  while (i < lines.length && (lines[i].startsWith("//") || lines[i].trim() === "")) {
    i++;
  }
  return lines.slice(i).join("\n");
}

describe("sql-splitter drift check", () => {
  it("frontend copy matches the sidecar source of truth", () => {
    const frontend = readFileSync(frontendPath, "utf-8");
    const sidecar = readFileSync(sidecarPath, "utf-8");
    expect(stripLeadingCommentBlock(frontend)).toBe(sidecar);
  });
});
