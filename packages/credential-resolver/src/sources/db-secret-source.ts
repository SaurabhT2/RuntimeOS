import { GatewayError } from "@ai-gateway/core-contracts";
import type { CredentialReference, SecretSource } from "../types.js";
import { parseCredentialReference } from "../types.js";
import type { CredentialStore } from "../store/credential-store.js";
import type { Encryptor } from "../encryption.js";

export const DB_SECRET_SOURCE_ID = "db";

/**
 * architecture §15.3: "`db` (for workspace/org/user BYOK keys, encrypted
 * at rest)." The reference's `pointer` (the part after `db://`) is the
 * `CredentialStore` row ID; this class's whole job is dereference-then-
 * decrypt, using the injected `Encryptor` (architecture §20.1's envelope
 * encryption, data half — see `encryption.ts`).
 */
export class DbSecretSource implements SecretSource {
  public readonly id = DB_SECRET_SOURCE_ID;

  constructor(
    private readonly store: CredentialStore,
    private readonly encryptor: Encryptor,
  ) {}

  async fetch(reference: CredentialReference): Promise<string> {
    const parsed = parseCredentialReference(reference);
    if (!parsed || parsed.sourceId !== this.id) {
      throw new GatewayError(
        "CREDENTIAL_INVALID",
        `DbSecretSource cannot dereference a reference outside its own scheme: ${reference}`,
        false,
      );
    }

    const row = await this.store.getById(parsed.pointer);
    if (!row) {
      throw new GatewayError(
        "CREDENTIAL_NOT_FOUND",
        `No credential row found for id "${parsed.pointer}".`,
        false,
      );
    }

    try {
      return this.encryptor.decrypt(row.encryptedKey);
    } catch (cause) {
      // A decryption failure (bad key, corrupted ciphertext) is a
      // credential-integrity problem, not a "we retried and it'll work
      // next time" problem — always non-retryable.
      throw new GatewayError(
        "CREDENTIAL_INVALID",
        `Failed to decrypt credential row "${parsed.pointer}".`,
        false,
        { cause: cause instanceof Error ? cause.message : String(cause) },
      );
    }
  }
}
