import { describe, it, expect } from "bun:test";
import { pubkeyFromBase64, pubkeyToBase64, generateKeypair } from "./keypair";
import { sodiumReady } from "./sodium";

describe("pubkeyFromBase64", () => {
  it("decodes a valid 32-byte base64 pubkey", async () => {
    await sodiumReady();
    const kp = await generateKeypair();
    const encoded = pubkeyToBase64(kp.publicKey);
    const decoded = pubkeyFromBase64(encoded);
    expect(decoded).toEqual(kp.publicKey);
  });

  it("rejects non-32-byte input", () => {
    expect(() => pubkeyFromBase64("Zm9v")).toThrow(/32 bytes/);
    expect(() => pubkeyFromBase64("")).toThrow(/32 bytes/);
  });
});
