import { describe, expect, it } from "vitest";
import { AesGcmEncryptor, generateEncryptionKey } from "../src/encryption.js";

describe("AesGcmEncryptor", () => {
  it("round-trips plaintext through encrypt -> decrypt", () => {
    const encryptor = new AesGcmEncryptor(generateEncryptionKey());
    const ciphertext = encryptor.encrypt("sk-super-secret-key");
    expect(encryptor.decrypt(ciphertext)).toBe("sk-super-secret-key");
  });

  it("never stores the plaintext inside the ciphertext blob", () => {
    const encryptor = new AesGcmEncryptor(generateEncryptionKey());
    const ciphertext = encryptor.encrypt("sk-super-secret-key");
    expect(ciphertext).not.toContain("sk-super-secret-key");
  });

  it("produces different ciphertext for the same plaintext on each call (random IV)", () => {
    const encryptor = new AesGcmEncryptor(generateEncryptionKey());
    const a = encryptor.encrypt("same-plaintext");
    const b = encryptor.encrypt("same-plaintext");
    expect(a).not.toBe(b);
    expect(encryptor.decrypt(a)).toBe("same-plaintext");
    expect(encryptor.decrypt(b)).toBe("same-plaintext");
  });

  it("fails to decrypt with the wrong key", () => {
    const encryptor1 = new AesGcmEncryptor(generateEncryptionKey());
    const encryptor2 = new AesGcmEncryptor(generateEncryptionKey());
    const ciphertext = encryptor1.encrypt("secret");
    expect(() => encryptor2.decrypt(ciphertext)).toThrow();
  });

  it("fails to decrypt tampered ciphertext (GCM auth tag mismatch)", () => {
    const encryptor = new AesGcmEncryptor(generateEncryptionKey());
    const ciphertext = encryptor.encrypt("secret");
    const tampered = ciphertext.slice(0, -4) + (ciphertext.endsWith("A") ? "B" : "A");
    expect(() => encryptor.decrypt(tampered)).toThrow();
  });

  it("rejects a key that is not exactly 32 bytes", () => {
    expect(() => new AesGcmEncryptor(Buffer.from("too-short"))).toThrow(RangeError);
  });

  it("generateEncryptionKey produces a fresh 32-byte key each call", () => {
    const a = generateEncryptionKey();
    const b = generateEncryptionKey();
    expect(a.length).toBe(32);
    expect(a.equals(b)).toBe(false);
  });
});
