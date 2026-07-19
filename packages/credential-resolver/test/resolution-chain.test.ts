import { describe, expect, it } from "vitest";
import { DefaultResolutionChain } from "../src/resolution-chain.js";
import { PlatformScopeResolver, DbScopeResolver } from "../src/scope-resolvers.js";
import { EnvSecretSource } from "../src/sources/env-secret-source.js";
import { DbSecretSource } from "../src/sources/db-secret-source.js";
import { InMemoryCredentialStore } from "../src/store/credential-store.js";
import { AesGcmEncryptor, generateEncryptionKey } from "../src/encryption.js";
import type { TenantContext } from "../src/types.js";
import type { CredentialScope } from "@ai-gateway/config";

const tenant: TenantContext = { organizationId: "org-a", workspaceId: "ws-a", userId: "user-a" };
const DEFAULT_PRIORITY: CredentialScope[] = [
  "user",
  "project",
  "workspace",
  "organization",
  "platform",
];

function buildChain() {
  const store = new InMemoryCredentialStore();
  const encryptor = new AesGcmEncryptor(generateEncryptionKey());
  process.env.GROQ_PLATFORM_KEY = "sk-platform";

  const chain = new DefaultResolutionChain({
    resolvers: [
      new DbScopeResolver("user", store),
      new DbScopeResolver("project", store),
      new DbScopeResolver("workspace", store),
      new DbScopeResolver("organization", store),
      new PlatformScopeResolver({ groq: "GROQ_PLATFORM_KEY" }),
    ],
    sources: [new EnvSecretSource(), new DbSecretSource(store, encryptor)],
    priority: DEFAULT_PRIORITY,
  });

  return { chain, store, encryptor };
}

describe("DefaultResolutionChain", () => {
  it("returns null when no scope resolves anything", async () => {
    const store = new InMemoryCredentialStore();
    const chain = new DefaultResolutionChain({
      resolvers: [new DbScopeResolver("user", store), new PlatformScopeResolver({})], // "groq" has no configured platform env var
      sources: [
        new EnvSecretSource(),
        new DbSecretSource(store, new AesGcmEncryptor(generateEncryptionKey())),
      ],
      priority: DEFAULT_PRIORITY,
    });
    const result = await chain.resolve("groq", { organizationId: "org-a" });
    expect(result).toBeNull();
  });

  it("falls through to platform when no more specific scope has a credential", async () => {
    const { chain } = buildChain();
    const result = await chain.resolve("groq", tenant);
    expect(result).toEqual({ key: "sk-platform", scope: "platform", ttl: undefined });
  });

  it("prefers a more specific scope over platform (priority order)", async () => {
    const { chain, store, encryptor } = buildChain();
    await store.put({
      scope: "workspace",
      provider: "groq",
      tenant,
      encryptedKey: encryptor.encrypt("sk-workspace-key"),
    });

    const result = await chain.resolve("groq", tenant);
    expect(result?.key).toBe("sk-workspace-key");
    expect(result?.scope).toBe("workspace");
  });

  it("prefers user scope over workspace scope even when both exist (most-specific-first)", async () => {
    const { chain, store, encryptor } = buildChain();
    await store.put({
      scope: "workspace",
      provider: "groq",
      tenant,
      encryptedKey: encryptor.encrypt("sk-workspace-key"),
    });
    await store.put({
      scope: "user",
      provider: "groq",
      tenant,
      encryptedKey: encryptor.encrypt("sk-user-key"),
    });

    const result = await chain.resolve("groq", tenant);
    expect(result?.key).toBe("sk-user-key");
    expect(result?.scope).toBe("user");
  });

  it("short-circuits: does not consult lower-priority resolvers once a hit is found", async () => {
    const store = new InMemoryCredentialStore();
    const encryptor = new AesGcmEncryptor(generateEncryptionKey());
    await store.put({
      scope: "user",
      provider: "groq",
      tenant,
      encryptedKey: encryptor.encrypt("sk-user-key"),
    });

    let platformLookupCalls = 0;
    class CountingPlatformResolver extends PlatformScopeResolver {
      override async lookup(provider: string, t: TenantContext) {
        platformLookupCalls += 1;
        return super.lookup(provider, t);
      }
    }
    process.env.GROQ_PLATFORM_KEY = "sk-platform";

    const chain = new DefaultResolutionChain({
      resolvers: [
        new DbScopeResolver("user", store),
        new CountingPlatformResolver({ groq: "GROQ_PLATFORM_KEY" }),
      ],
      sources: [new EnvSecretSource(), new DbSecretSource(store, encryptor)],
      priority: DEFAULT_PRIORITY,
    });

    const result = await chain.resolve("groq", tenant);
    expect(result?.scope).toBe("user");
    expect(platformLookupCalls).toBe(0);
  });

  it("only tries resolvers whose scope appears in priority", async () => {
    const store = new InMemoryCredentialStore();
    const encryptor = new AesGcmEncryptor(generateEncryptionKey());
    await store.put({
      scope: "user",
      provider: "groq",
      tenant,
      encryptedKey: encryptor.encrypt("sk-user-key"),
    });

    const chain = new DefaultResolutionChain({
      resolvers: [new DbScopeResolver("user", store)],
      sources: [new DbSecretSource(store, encryptor)],
      priority: ["organization", "platform"], // "user" deliberately excluded
    });

    const result = await chain.resolve("groq", tenant);
    expect(result).toBeNull();
  });

  it("attaches the configured ttlSeconds to the resolved credential", async () => {
    const store = new InMemoryCredentialStore();
    const encryptor = new AesGcmEncryptor(generateEncryptionKey());
    await store.put({
      scope: "user",
      provider: "groq",
      tenant,
      encryptedKey: encryptor.encrypt("sk-user-key"),
    });

    const chain = new DefaultResolutionChain({
      resolvers: [new DbScopeResolver("user", store)],
      sources: [new DbSecretSource(store, encryptor)],
      priority: DEFAULT_PRIORITY,
      ttlSeconds: 300,
    });

    const result = await chain.resolve("groq", tenant);
    expect(result?.ttl).toBe(300);
  });

  it("throws CREDENTIAL_INVALID when no SecretSource is registered for the resolved reference's scheme", async () => {
    const store = new InMemoryCredentialStore();
    await store.put({ scope: "user", provider: "groq", tenant, encryptedKey: "cipher" });

    const chain = new DefaultResolutionChain({
      resolvers: [new DbScopeResolver("user", store)],
      sources: [], // no DbSecretSource registered
      priority: DEFAULT_PRIORITY,
    });

    await expect(chain.resolve("groq", tenant)).rejects.toMatchObject({
      code: "CREDENTIAL_INVALID",
    });
  });
});
