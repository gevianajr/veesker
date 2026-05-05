import { describe, it, expect } from "bun:test";
import { buildAad } from "./aad";
import { sodiumReady } from "./sodium";

const baseArgs = {
  sandboxId: "sandbox-abc",
  sandboxVersion: 1,
  recipientPubkey: new Uint8Array(32).fill(0xab),
  formatVersion: 2,
};

describe("buildAad", () => {
  it("is deterministic for the same inputs", async () => {
    await sodiumReady();
    const a = buildAad(baseArgs);
    const b = buildAad(baseArgs);
    expect(a).toEqual(b);
  });

  it("differs when sandboxId changes", async () => {
    await sodiumReady();
    const a = buildAad(baseArgs);
    const b = buildAad({ ...baseArgs, sandboxId: "sandbox-xyz" });
    expect(a).not.toEqual(b);
  });

  it("differs when version changes", async () => {
    await sodiumReady();
    const a = buildAad(baseArgs);
    const b = buildAad({ ...baseArgs, sandboxVersion: 2 });
    expect(a).not.toEqual(b);
  });

  it("rejects sandboxId containing NUL byte", () => {
    expect(() => buildAad({
      sandboxId: "abc\0def",
      sandboxVersion: 1,
      recipientPubkey: new Uint8Array(32),
      formatVersion: 2,
    })).toThrow(/NUL/);
  });
});
