import { describe, expect, it } from "vitest";
import {
  InMemoryRuntimeProfileStore,
  InMemoryTenantAssignmentStore,
} from "../src/store/runtime-profile-store.js";
import { SEED_RUNTIME_PROFILES } from "../src/seed-data.js";

describe("InMemoryRuntimeProfileStore", () => {
  it("returns null for an unregistered profile id", async () => {
    const store = new InMemoryRuntimeProfileStore();
    await expect(store.get("nonexistent")).resolves.toBeNull();
  });

  it("seeds profiles passed to the constructor", async () => {
    const store = new InMemoryRuntimeProfileStore(SEED_RUNTIME_PROFILES);
    await expect(store.get("production")).resolves.toEqual(
      SEED_RUNTIME_PROFILES.find((p) => p.id === "production"),
    );
  });

  it("upserts and retrieves a profile", async () => {
    const store = new InMemoryRuntimeProfileStore();
    const profile = SEED_RUNTIME_PROFILES[0]!;
    await store.upsert(profile);
    await expect(store.get(profile.id)).resolves.toEqual(profile);
  });

  it("overwrites an existing profile on upsert", async () => {
    const original = SEED_RUNTIME_PROFILES.find((p) => p.id === "production")!;
    const store = new InMemoryRuntimeProfileStore([original]);
    const updated = { ...original, telemetry: { verbosity: "verbose" as const } };
    await store.upsert(updated);
    await expect(store.get("production")).resolves.toEqual(updated);
  });

  it("lists every stored profile", async () => {
    const store = new InMemoryRuntimeProfileStore(SEED_RUNTIME_PROFILES);
    await expect(store.list()).resolves.toHaveLength(SEED_RUNTIME_PROFILES.length);
  });
});

describe("InMemoryTenantAssignmentStore", () => {
  it("returns null for a tenant with no assignment", async () => {
    const store = new InMemoryTenantAssignmentStore();
    await expect(store.get("org-1")).resolves.toBeNull();
  });

  it("sets and retrieves an assignment", async () => {
    const store = new InMemoryTenantAssignmentStore();
    await store.set("org-1", "enterprise");
    await expect(store.get("org-1")).resolves.toBe("enterprise");
  });

  it("overwrites an existing assignment", async () => {
    const store = new InMemoryTenantAssignmentStore();
    await store.set("org-1", "enterprise");
    await store.set("org-1", "free_tier");
    await expect(store.get("org-1")).resolves.toBe("free_tier");
  });
});
