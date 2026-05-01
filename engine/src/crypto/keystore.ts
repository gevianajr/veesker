import { Entry } from "@napi-rs/keyring";

/**
 * Persistent storage for a user's X25519 private key. The CLI default
 * uses {@link OsKeyringStore} (Windows Credential Manager / macOS Keychain
 * / Linux Secret Service via `@napi-rs/keyring`); tests use
 * {@link InMemoryKeyStore}.
 *
 * `setPrivateKey` overwrites any existing entry. `getPrivateKey` returns
 * `null` when no key is stored. `deletePrivateKey` is idempotent — calling
 * it on a missing key does not throw.
 */
export interface KeyStore {
  setPrivateKey(pk: Uint8Array): Promise<void>;
  getPrivateKey(): Promise<Uint8Array | null>;
  deletePrivateKey(): Promise<void>;
}

/**
 * KeyStore backed by the OS credential manager. Service + account form
 * the lookup key; the convention for VeeskerDB is service `"veesker-engine"`
 * and account = the user's email (or any stable identifier).
 *
 * The private key bytes are stored as a base64 string because the
 * underlying OS APIs accept only strings.
 */
export class OsKeyringStore implements KeyStore {
  private entry: Entry;

  constructor(service: string, account: string) {
    this.entry = new Entry(service, account);
  }

  async setPrivateKey(pk: Uint8Array): Promise<void> {
    this.entry.setPassword(Buffer.from(pk).toString("base64"));
  }

  async getPrivateKey(): Promise<Uint8Array | null> {
    try {
      const s = this.entry.getPassword();
      if (!s) return null;
      return new Uint8Array(Buffer.from(s, "base64"));
    } catch {
      return null;
    }
  }

  async deletePrivateKey(): Promise<void> {
    try {
      this.entry.deletePassword();
    } catch {
      /* idempotent — entry may not exist */
    }
  }
}

/**
 * In-process KeyStore backed by a single field. Used by tests and short-
 * lived CLI flows that don't want to touch the OS keyring.
 */
export class InMemoryKeyStore implements KeyStore {
  private pk: Uint8Array | null = null;

  async setPrivateKey(pk: Uint8Array): Promise<void> {
    this.pk = pk;
  }

  async getPrivateKey(): Promise<Uint8Array | null> {
    return this.pk;
  }

  async deletePrivateKey(): Promise<void> {
    this.pk = null;
  }
}
