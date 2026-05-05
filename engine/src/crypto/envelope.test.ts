import { describe, it, expect } from "bun:test";
import { sodiumReady } from "./sodium";
import { generateKeypair, publicKeyFromPrivate } from "./keypair";
import { sealEnvelope, openEnvelope, sealForRecipients } from "./envelope";
import { randomKey } from "./blob";
import { buildAad } from "./aad";

describe("sealForRecipients", () => {
  it("returns empty array for zero recipients", async () => {
    await sodiumReady();
    const sender = await generateKeypair();
    const contentKey = randomKey();
    const out = await sealForRecipients(contentKey, [], sender);
    expect(out).toEqual([]);
  });

  it("seals for one recipient and round-trips via openEnvelope", async () => {
    await sodiumReady();
    const sender = await generateKeypair();
    const recipient = await generateKeypair();
    const recipientPub = publicKeyFromPrivate(recipient.privateKey);
    const contentKey = randomKey();

    const sealed = await sealForRecipients(
      contentKey,
      [{ userId: "u1", x25519Pubkey: recipientPub }],
      sender,
    );

    expect(sealed).toHaveLength(1);
    expect(sealed[0].userId).toBe("u1");

    const senderPub = publicKeyFromPrivate(sender.privateKey);
    const recovered = await openEnvelope(
      sealed[0].envelope,
      senderPub,
      recipient,
    );
    expect(recovered).toEqual(contentKey);
  });

  it("seals for N recipients; each unseals the same content key", async () => {
    await sodiumReady();
    const sender = await generateKeypair();
    const r1 = await generateKeypair();
    const r2 = await generateKeypair();
    const r3 = await generateKeypair();
    const contentKey = randomKey();
    const senderPub = publicKeyFromPrivate(sender.privateKey);

    const sealed = await sealForRecipients(
      contentKey,
      [
        { userId: "u1", x25519Pubkey: publicKeyFromPrivate(r1.privateKey) },
        { userId: "u2", x25519Pubkey: publicKeyFromPrivate(r2.privateKey) },
        { userId: "u3", x25519Pubkey: publicKeyFromPrivate(r3.privateKey) },
      ],
      sender,
    );

    expect(sealed.map(s => s.userId)).toEqual(["u1", "u2", "u3"]);
    const out1 = await openEnvelope(sealed[0].envelope, senderPub, r1);
    const out2 = await openEnvelope(sealed[1].envelope, senderPub, r2);
    const out3 = await openEnvelope(sealed[2].envelope, senderPub, r3);
    expect(out1).toEqual(contentKey);
    expect(out2).toEqual(contentKey);
    expect(out3).toEqual(contentKey);
  });

  it("rejects pubkey shorter than 32 bytes with a typed error", async () => {
    await sodiumReady();
    const sender = await generateKeypair();
    const contentKey = randomKey();
    await expect(
      sealForRecipients(
        contentKey,
        [{ userId: "u1", x25519Pubkey: new Uint8Array(16) }],
        sender,
      ),
    ).rejects.toThrow(/x25519Pubkey must be 32 bytes/);
  });

  it("rejects pubkey longer than 32 bytes with a typed error", async () => {
    await sodiumReady();
    const sender = await generateKeypair();
    const contentKey = randomKey();
    await expect(
      sealForRecipients(
        contentKey,
        [{ userId: "u1", x25519Pubkey: new Uint8Array(64) }],
        sender,
      ),
    ).rejects.toThrow(/x25519Pubkey must be 32 bytes/);
  });

  it("v2 envelope from sandbox A cannot decrypt with sandbox B's AAD", async () => {
    await sodiumReady();
    const ownerKp = await generateKeypair();
    const recipKp = await generateKeypair();
    const recipPub = publicKeyFromPrivate(recipKp.privateKey);
    const ownerPub = publicKeyFromPrivate(ownerKp.privateKey);
    const contentKey = randomKey();

    const aadA = buildAad({ sandboxId: "A", sandboxVersion: 1, recipientPubkey: recipPub, formatVersion: 2 });
    const aadB = buildAad({ sandboxId: "B", sandboxVersion: 1, recipientPubkey: recipPub, formatVersion: 2 });

    const envA = await sealEnvelope(contentKey, recipPub, ownerKp, { aad: aadA });

    let caught: Error | undefined;
    try {
      await openEnvelope(envA, ownerPub, recipKp, { aad: aadB });
    } catch (e) { caught = e as Error; }
    expect(caught).toBeDefined();
  });

  it("cross-version replay: aad with version=1 seal cannot open with version=2 aad", async () => {
    await sodiumReady();
    const ownerKp = await generateKeypair();
    const recipKp = await generateKeypair();
    const recipPub = publicKeyFromPrivate(recipKp.privateKey);
    const ownerPub = publicKeyFromPrivate(ownerKp.privateKey);
    const contentKey = randomKey();

    const aadA = buildAad({ sandboxId: "sandbox-1", sandboxVersion: 1, recipientPubkey: recipPub, formatVersion: 2 });
    const aadB = buildAad({ sandboxId: "sandbox-1", sandboxVersion: 2, recipientPubkey: recipPub, formatVersion: 2 });

    const envA = await sealEnvelope(contentKey, recipPub, ownerKp, { aad: aadA });

    let caught: Error | undefined;
    try {
      await openEnvelope(envA, ownerPub, recipKp, { aad: aadB });
    } catch (e) { caught = e as Error; }
    expect(caught).toBeDefined();
  });

  it("cross-recipient replay: aad with recipKp1 seal cannot open with recipKp2 aad", async () => {
    await sodiumReady();
    const ownerKp = await generateKeypair();
    const recipKp1 = await generateKeypair();
    const recipKp2 = await generateKeypair();
    const recipPub1 = publicKeyFromPrivate(recipKp1.privateKey);
    const recipPub2 = publicKeyFromPrivate(recipKp2.privateKey);
    const ownerPub = publicKeyFromPrivate(ownerKp.privateKey);
    const contentKey = randomKey();

    const aadA = buildAad({ sandboxId: "sandbox-1", sandboxVersion: 1, recipientPubkey: recipPub1, formatVersion: 2 });
    const aadB = buildAad({ sandboxId: "sandbox-1", sandboxVersion: 1, recipientPubkey: recipPub2, formatVersion: 2 });

    const envA = await sealEnvelope(contentKey, recipPub1, ownerKp, { aad: aadA });

    let caught: Error | undefined;
    try {
      await openEnvelope(envA, ownerPub, recipKp1, { aad: aadB });
    } catch (e) { caught = e as Error; }
    expect(caught).toBeDefined();
  });

  it("cross-format replay: aad with formatVersion=1 seal cannot open with formatVersion=2 aad", async () => {
    await sodiumReady();
    const ownerKp = await generateKeypair();
    const recipKp = await generateKeypair();
    const recipPub = publicKeyFromPrivate(recipKp.privateKey);
    const ownerPub = publicKeyFromPrivate(ownerKp.privateKey);
    const contentKey = randomKey();

    const aadA = buildAad({ sandboxId: "sandbox-1", sandboxVersion: 1, recipientPubkey: recipPub, formatVersion: 1 });
    const aadB = buildAad({ sandboxId: "sandbox-1", sandboxVersion: 1, recipientPubkey: recipPub, formatVersion: 2 });

    const envA = await sealEnvelope(contentKey, recipPub, ownerKp, { aad: aadA });

    let caught: Error | undefined;
    try {
      await openEnvelope(envA, ownerPub, recipKp, { aad: aadB });
    } catch (e) { caught = e as Error; }
    expect(caught).toBeDefined();
  });

  it("does not corrupt envelopes if caller mutates contentKey after the call returns", async () => {
    await sodiumReady();
    const sender = await generateKeypair();
    const recipient = await generateKeypair();
    const recipientPub = publicKeyFromPrivate(recipient.privateKey);
    const contentKey = await randomKey();
    const original = contentKey.slice();
    const senderPub = publicKeyFromPrivate(sender.privateKey);

    const sealed = await sealForRecipients(
      contentKey,
      [{ userId: "u1", x25519Pubkey: recipientPub }],
      sender,
    );

    // Mutate the caller's buffer AFTER the call. The sealed envelope must
    // still decrypt to the ORIGINAL value because sealForRecipients took
    // a defensive copy.
    contentKey.fill(0xff);

    const recovered = await openEnvelope(sealed[0].envelope, senderPub, recipient);
    expect(recovered).toEqual(original);
  });
});
