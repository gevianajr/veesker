/**
 * Build canonical AAD bytes binding the cryptogram to the
 * (sandbox, version, recipient, format-version) tuple.
 *
 * Format (binary):
 *   "VSK\0AAD\0v1\0" || sandbox_id_bytes || "\0" || version_bytes || "\0"
 *   || recipient_pubkey_bytes || "\0" || format_version_be16
 */
export function buildAad(args: {
  sandboxId: string;
  sandboxVersion: number;
  recipientPubkey: Uint8Array;
  formatVersion: number;
}): Uint8Array {
  const enc = new TextEncoder();
  const parts = [
    enc.encode("VSK\0AAD\0v1\0"),
    enc.encode(args.sandboxId),
    new Uint8Array([0]),
    enc.encode(String(args.sandboxVersion)),
    new Uint8Array([0]),
    args.recipientPubkey,
    new Uint8Array([0]),
    new Uint8Array([
      (args.formatVersion >> 8) & 0xff,
      args.formatVersion & 0xff,
    ]),
  ];
  const total = parts.reduce((s, p) => s + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}
