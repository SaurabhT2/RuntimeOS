import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * architecture §20.1: "Secrets at rest: encrypted with envelope encryption
 * (data-encryption-key per secret, wrapped by a KMS-held key)." This class
 * implements the *data* half of envelope encryption (AES-256-GCM, using
 * Node's built-in `node:crypto` — no new dependency needed) — the *key*
 * half (a KMS unwrapping a data-encryption-key) is a deployment concern:
 * whatever constructs this class's key at `apps/gateway-server`'s
 * composition root (Blueprint §6.4, EM-5 scope) is where a real KMS
 * integration would supply that key. Passing a fixed key directly, as this
 * package's tests and `InMemoryCredentialStore`'s default do, is
 * appropriate for development/tests, not for a production deployment.
 */
export interface Encryptor {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;

export class AesGcmEncryptor implements Encryptor {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) {
      throw new RangeError(`AesGcmEncryptor key must be 32 bytes (aes-256), got ${key.length}`);
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // Pack iv + authTag + ciphertext into one opaque base64 blob so
    // `CredentialStore` implementations only ever handle a single string
    // column, matching architecture §20.1's "encrypted at rest" column
    // description rather than a multi-column encryption scheme.
    return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
  }

  decrypt(ciphertext: string): string {
    const raw = Buffer.from(ciphertext, "base64");
    const iv = raw.subarray(0, IV_LENGTH_BYTES);
    const authTag = raw.subarray(IV_LENGTH_BYTES, IV_LENGTH_BYTES + 16);
    const encrypted = raw.subarray(IV_LENGTH_BYTES + 16);
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  }
}

/** Generates a fresh 32-byte (aes-256) key. Convenience for tests/dev — see class docs for the production caveat. */
export function generateEncryptionKey(): Buffer {
  return randomBytes(32);
}
