import { afterEach, describe, expect, it } from "vitest";
import { EnvSecretSource } from "../src/sources/env-secret-source.js";
import { DbSecretSource } from "../src/sources/db-secret-source.js";
import { InMemoryCredentialStore } from "../src/store/credential-store.js";
import { AesGcmEncryptor, generateEncryptionKey } from "../src/encryption.js";
import { makeCredentialReference } from "../src/types.js";
import type { TenantContext } from "../src/types.js";

const tenantA: TenantContext = { organizationId: "org-a", workspaceId: "ws-a" };

describe("EnvSecretSource", () => {
  const ORIGINAL = process.env.TEST_CRED_RESOLVER_KEY;

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.TEST_CRED_RESOLVER_KEY;
    } else {
      process.env.TEST_CRED_RESOLVER_KEY = ORIGINAL;
    }
  });

  it("reads the named environment variable", async () => {
    process.env.TEST_CRED_RESOLVER_KEY = "sk-from-env";
    const source = new EnvSecretSource();
    const value = await source.fetch(makeCredentialReference("env", "TEST_CRED_RESOLVER_KEY"));
    expect(value).toBe("sk-from-env");
  });

  it("rejects with CREDENTIAL_NOT_FOUND when the env var is unset", async () => {
    delete process.env.TEST_CRED_RESOLVER_KEY;
    const source = new EnvSecretSource();
    await expect(
      source.fetch(makeCredentialReference("env", "TEST_CRED_RESOLVER_KEY")),
    ).rejects.toMatchObject({ code: "CREDENTIAL_NOT_FOUND" });
  });

  it("rejects with CREDENTIAL_NOT_FOUND when the env var is empty", async () => {
    process.env.TEST_CRED_RESOLVER_KEY = "";
    const source = new EnvSecretSource();
    await expect(
      source.fetch(makeCredentialReference("env", "TEST_CRED_RESOLVER_KEY")),
    ).rejects.toMatchObject({ code: "CREDENTIAL_NOT_FOUND" });
  });

  it("rejects a reference belonging to a different source scheme", async () => {
    const source = new EnvSecretSource();
    await expect(source.fetch(makeCredentialReference("db", "some-row-id"))).rejects.toMatchObject({
      code: "CREDENTIAL_INVALID",
    });
  });

  it("rejects a malformed reference", async () => {
    const source = new EnvSecretSource();
    await expect(source.fetch("not-a-valid-reference")).rejects.toMatchObject({
      code: "CREDENTIAL_INVALID",
    });
  });
});

describe("DbSecretSource", () => {
  it("fetches and decrypts the row's encrypted key", async () => {
    const store = new InMemoryCredentialStore();
    const encryptor = new AesGcmEncryptor(generateEncryptionKey());
    const row = await store.put({
      scope: "workspace",
      provider: "groq",
      tenant: tenantA,
      encryptedKey: encryptor.encrypt("sk-byok-key"),
    });

    const source = new DbSecretSource(store, encryptor);
    const value = await source.fetch(makeCredentialReference("db", row.rowId));
    expect(value).toBe("sk-byok-key");
  });

  it("rejects with CREDENTIAL_NOT_FOUND for an unknown row id", async () => {
    const store = new InMemoryCredentialStore();
    const encryptor = new AesGcmEncryptor(generateEncryptionKey());
    const source = new DbSecretSource(store, encryptor);

    await expect(source.fetch(makeCredentialReference("db", "unknown-row"))).rejects.toMatchObject({
      code: "CREDENTIAL_NOT_FOUND",
    });
  });

  it("rejects with CREDENTIAL_INVALID when decryption fails (wrong key)", async () => {
    const store = new InMemoryCredentialStore();
    const encryptor1 = new AesGcmEncryptor(generateEncryptionKey());
    const encryptor2 = new AesGcmEncryptor(generateEncryptionKey());
    const row = await store.put({
      scope: "workspace",
      provider: "groq",
      tenant: tenantA,
      encryptedKey: encryptor1.encrypt("sk-byok-key"),
    });

    const source = new DbSecretSource(store, encryptor2);
    await expect(source.fetch(makeCredentialReference("db", row.rowId))).rejects.toMatchObject({
      code: "CREDENTIAL_INVALID",
    });
  });

  it("rejects a reference belonging to a different source scheme", async () => {
    const store = new InMemoryCredentialStore();
    const encryptor = new AesGcmEncryptor(generateEncryptionKey());
    const source = new DbSecretSource(store, encryptor);

    await expect(
      source.fetch(makeCredentialReference("env", "SOME_ENV_VAR")),
    ).rejects.toMatchObject({ code: "CREDENTIAL_INVALID" });
  });
});
