import { sodiumReady, getSodium } from "./sodium";
import type { Keypair } from "./keypair";

export interface Envelope {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
}

/**
 * Derive a 32-byte symmetric key from an X25519 ECDH shared secret. We
 * pass the raw shared secret through BLAKE2b-256 (`crypto_generichash`)
 * to whiten any structure inherent in the curve point.
 *
 * Both sides of an exchange compute the SAME key when their (privkey,
 * peer-pubkey) pair multiplies to the same point — that's the property
 * X25519 ECDH guarantees.
 */
function deriveSharedKey(myPriv: Uint8Array, theirPub: Uint8Array): Uint8Array {
  const sodium = getSodium();
  const shared = sodium.crypto_scalarmult(myPriv, theirPub);
  return sodium.crypto_generichash(32, shared, null);
}

/**
 * Seal a 32-byte content key for `recipientPubkey`. The output envelope
 * is opaque — only someone holding the recipient's private key (and
 * knowing the sender's public key for ECDH) can recover the content key.
 *
 * Uses ChaCha20-Poly1305 IETF (12-byte nonces are fine here because each
 * envelope's symmetric key is derived from the unique ECDH pair).
 */
export async function sealEnvelope(
  contentKey: Uint8Array,
  recipientPubkey: Uint8Array,
  sender: Keypair,
): Promise<Envelope> {
  await sodiumReady();
  const sodium = getSodium();
  const sharedKey = deriveSharedKey(sender.privateKey, recipientPubkey);
  const nonce = sodium.randombytes_buf(
    sodium.crypto_aead_chacha20poly1305_ietf_NPUBBYTES,
  );
  const ciphertext = sodium.crypto_aead_chacha20poly1305_ietf_encrypt(
    contentKey,
    null,
    null,
    nonce,
    sharedKey,
  );
  return { ciphertext, nonce };
}

/**
 * Recover a content key from an envelope. Throws if the envelope was
 * not addressed to this recipient (or if the sender pubkey is wrong, or
 * the envelope is tampered).
 */
export async function openEnvelope(
  envelope: Envelope,
  senderPubkey: Uint8Array,
  recipient: Keypair,
): Promise<Uint8Array> {
  await sodiumReady();
  const sodium = getSodium();
  const sharedKey = deriveSharedKey(recipient.privateKey, senderPubkey);
  return sodium.crypto_aead_chacha20poly1305_ietf_decrypt(
    null,
    envelope.ciphertext,
    null,
    envelope.nonce,
    sharedKey,
  );
}
