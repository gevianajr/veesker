import { sodiumReady, getSodium } from "./sodium";

export interface Keypair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/**
 * Generate a fresh X25519 keypair. Used by sandbox owners to seal blob
 * keys to recipient public keys (envelope encryption) and by recipients
 * to unwrap envelopes addressed to them.
 *
 * The private key is 32 random bytes. The public key is derived via
 * scalar multiplication with the curve's base point.
 */
export async function generateKeypair(): Promise<Keypair> {
  await sodiumReady();
  const sodium = getSodium();
  const kp = sodium.crypto_box_keypair();
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

/** Recompute a public key from a stored private key. */
export function publicKeyFromPrivate(privateKey: Uint8Array): Uint8Array {
  const sodium = getSodium();
  return sodium.crypto_scalarmult_base(privateKey);
}

/** Encode a 32-byte public key as a 44-char base64 string. */
export function pubkeyToBase64(pk: Uint8Array): string {
  return Buffer.from(pk).toString("base64");
}

/** Decode a base64-encoded public key. Length validation is the caller's job. */
export function pubkeyFromBase64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64"));
}
