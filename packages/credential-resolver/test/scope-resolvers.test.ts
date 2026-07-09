import { describe, expect, it } from "vitest";
import { PlatformScopeResolver, DbScopeResolver } from "../src/scope-resolvers.js";
import { InMemoryCredentialStore } from "../src/store/credential-store.js";
import { parseCredentialReference } from "../src/types.js";
import type { TenantContext } from "../src/types.js";

const tenantA: TenantContext = { organizationId: "org-a", workspaceId: "ws-a" };
const tenantB: TenantContext = { organizationId: "org-b", workspaceId: "ws-b" };

describe("PlatformScopeResolver", () => {
  it("returns an env:// reference for a configured provider", async () => {
    const resolver = new PlatformScopeResolver({ groq: "GROQ_PLATFORM_KEY" });
    const ref = await resolver.lookup("groq", tenantA);
    expect(ref).toBe("env://GROQ_PLATFORM_KEY");
  });

  it("returns null for a provider with no configured env var", async () => {
    const resolver = new PlatformScopeResolver({ groq: "GROQ_PLATFORM_KEY" });
    expect(await resolver.lookup("nvidia-nim", tenantA)).toBeNull();
  });

  it("reports scope as 'platform'", () => {
    const resolver = new PlatformScopeResolver({});
    expect(resolver.scope).toBe("platform");
  });
});

describe("DbScopeResolver", () => {
  it("returns a db:// reference pointing at the matching row", async () => {
    const store = new InMemoryCredentialStore();
    const row = await store.put({
      scope: "workspace",
      provider: "groq",
      tenant: tenantA,
      encryptedKey: "cipher",
    });
    const resolver = new DbScopeResolver("workspace", store);

    const ref = await resolver.lookup("groq", tenantA);
    expect(ref).toBe(`db://${row.rowId}`);
  });

  it("returns null when the store has no matching row", async () => {
    const store = new InMemoryCredentialStore();
    const resolver = new DbScopeResolver("workspace", store);
    expect(await resolver.lookup("groq", tenantA)).toBeNull();
  });

  it("returns null (never another tenant's reference) when queried for a different tenant", async () => {
    const store = new InMemoryCredentialStore();
    await store.put({
      scope: "workspace",
      provider: "groq",
      tenant: tenantA,
      encryptedKey: "cipher",
    });
    const resolver = new DbScopeResolver("workspace", store);

    expect(await resolver.lookup("groq", tenantB)).toBeNull();
  });

  it("the resolver-layer re-verification independently catches a store that returns the wrong tenant's row", async () => {
    // Simulates exactly the bug architecture §16.3's "defense in depth"
    // guards against: a `CredentialStore` whose row-level scoping has a
    // bug and returns tenant A's row for a tenant B lookup. Even though
    // the (buggy) store handed back a row, `DbScopeResolver`'s own
    // independent tenant-field check must still refuse it.
    class BuggyStore extends InMemoryCredentialStore {
      override async findByScope() {
        // Always returns tenant A's row, regardless of which tenant was asked for.
        return {
          rowId: "row-a",
          scope: "workspace" as const,
          provider: "groq",
          tenant: tenantA,
          encryptedKey: "cipher",
          createdAt: new Date().toISOString(),
        };
      }
    }

    const resolver = new DbScopeResolver("workspace", new BuggyStore());
    const result = await resolver.lookup("groq", tenantB);
    expect(result).toBeNull();
  });

  it("produces a reference that parses back to the db source id and the row id", async () => {
    const store = new InMemoryCredentialStore();
    const row = await store.put({
      scope: "organization",
      provider: "nvidia-nim",
      tenant: tenantA,
      encryptedKey: "cipher",
    });
    const resolver = new DbScopeResolver("organization", store);

    const ref = await resolver.lookup("nvidia-nim", tenantA);
    expect(parseCredentialReference(ref!)).toEqual({ sourceId: "db", pointer: row.rowId });
  });
});
