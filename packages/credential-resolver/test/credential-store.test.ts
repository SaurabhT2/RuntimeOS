import { describe, expect, it } from "vitest";
import { InMemoryCredentialStore } from "../src/store/credential-store.js";
import type { TenantContext } from "../src/types.js";

const tenantA: TenantContext = { organizationId: "org-a", workspaceId: "ws-a", userId: "user-a" };
const tenantB: TenantContext = { organizationId: "org-b", workspaceId: "ws-b", userId: "user-b" };

describe("InMemoryCredentialStore", () => {
  it("stores and retrieves a row by id", async () => {
    const store = new InMemoryCredentialStore();
    const row = await store.put({
      scope: "workspace",
      provider: "groq",
      tenant: tenantA,
      encryptedKey: "cipher-a",
    });

    const fetched = await store.getById(row.rowId);
    expect(fetched).toEqual(row);
  });

  it("getById returns null for an unknown row id", async () => {
    const store = new InMemoryCredentialStore();
    expect(await store.getById("does-not-exist")).toBeNull();
  });

  it("findByScope finds a row registered for the matching tenant scope value", async () => {
    const store = new InMemoryCredentialStore();
    await store.put({
      scope: "workspace",
      provider: "groq",
      tenant: tenantA,
      encryptedKey: "cipher-a",
    });

    const found = await store.findByScope("workspace", "groq", tenantA);
    expect(found?.tenant).toEqual(tenantA);
  });

  it("findByScope returns null for a different tenant at the same scope (isolation)", async () => {
    const store = new InMemoryCredentialStore();
    await store.put({
      scope: "workspace",
      provider: "groq",
      tenant: tenantA,
      encryptedKey: "cipher-a",
    });

    expect(await store.findByScope("workspace", "groq", tenantB)).toBeNull();
  });

  it("findByScope returns null when the tenant lacks the field the scope requires", async () => {
    const store = new InMemoryCredentialStore();
    await store.put({
      scope: "workspace",
      provider: "groq",
      tenant: tenantA,
      encryptedKey: "cipher-a",
    });

    const tenantWithoutWorkspace: TenantContext = { organizationId: "org-a" };
    expect(await store.findByScope("workspace", "groq", tenantWithoutWorkspace)).toBeNull();
  });

  it("findByScope distinguishes provider even for the same tenant/scope", async () => {
    const store = new InMemoryCredentialStore();
    await store.put({
      scope: "workspace",
      provider: "groq",
      tenant: tenantA,
      encryptedKey: "cipher-a",
    });

    expect(await store.findByScope("workspace", "nvidia-nim", tenantA)).toBeNull();
  });

  it("findByScope distinguishes scope level for the same tenant/provider", async () => {
    const store = new InMemoryCredentialStore();
    await store.put({
      scope: "workspace",
      provider: "groq",
      tenant: tenantA,
      encryptedKey: "cipher-a",
    });

    expect(await store.findByScope("organization", "groq", tenantA)).toBeNull();
  });

  it("rejects storing a scoped credential when the tenant lacks the required field", async () => {
    const store = new InMemoryCredentialStore();
    const tenantWithoutWorkspace: TenantContext = { organizationId: "org-a" };
    await expect(
      store.put({
        scope: "workspace",
        provider: "groq",
        tenant: tenantWithoutWorkspace,
        encryptedKey: "cipher-a",
      }),
    ).rejects.toThrow(RangeError);
  });

  it("supports platform scope with no tenant-specific field", async () => {
    const store = new InMemoryCredentialStore();
    await store.put({
      scope: "platform",
      provider: "groq",
      tenant: {},
      encryptedKey: "cipher-platform",
    });

    const found = await store.findByScope("platform", "groq", tenantA);
    expect(found?.encryptedKey).toBe("cipher-platform");
  });

  it("delete removes a row and later lookups (by id and by scope) both miss", async () => {
    const store = new InMemoryCredentialStore();
    const row = await store.put({
      scope: "workspace",
      provider: "groq",
      tenant: tenantA,
      encryptedKey: "cipher-a",
    });

    expect(await store.delete(row.rowId)).toBe(true);
    expect(await store.getById(row.rowId)).toBeNull();
    expect(await store.findByScope("workspace", "groq", tenantA)).toBeNull();
  });

  it("delete returns false for a row that doesn't exist", async () => {
    const store = new InMemoryCredentialStore();
    expect(await store.delete("nope")).toBe(false);
  });

  it("upserting a new row for the same scope/provider/tenant does not corrupt the old row's independent id", async () => {
    const store = new InMemoryCredentialStore();
    const first = await store.put({
      scope: "workspace",
      provider: "groq",
      tenant: tenantA,
      encryptedKey: "cipher-a-1",
    });
    const second = await store.put({
      scope: "workspace",
      provider: "groq",
      tenant: tenantA,
      encryptedKey: "cipher-a-2",
    });

    expect(first.rowId).not.toBe(second.rowId);
    // The scope-lookup index now points at whichever was registered most
    // recently (last-write-wins for the "current" credential at this scope).
    const found = await store.findByScope("workspace", "groq", tenantA);
    expect(found?.rowId).toBe(second.rowId);
    // The old row is still independently fetchable by id (e.g. for audit/rotation history).
    expect(await store.getById(first.rowId)).not.toBeNull();
  });
});
