import { describe, expect, it } from "vitest";
import { InMemoryProfileStore } from "../src/store/profile-store.js";
import { SEED_EXECUTION_PROFILES } from "../src/seed-data.js";

describe("InMemoryProfileStore", () => {
  it("returns null for an unregistered profile id", async () => {
    const store = new InMemoryProfileStore();
    await expect(store.get("nonexistent")).resolves.toBeNull();
  });

  it("seeds profiles passed to the constructor", async () => {
    const store = new InMemoryProfileStore(SEED_EXECUTION_PROFILES);
    await expect(store.get("summarization")).resolves.toEqual(
      SEED_EXECUTION_PROFILES.find((p) => p.id === "summarization"),
    );
  });

  it("upserts and retrieves a profile", async () => {
    const store = new InMemoryProfileStore();
    const profile = SEED_EXECUTION_PROFILES[0]!;
    await store.upsert(profile);
    await expect(store.get(profile.id)).resolves.toEqual(profile);
  });

  it("overwrites an existing profile on upsert", async () => {
    const original = SEED_EXECUTION_PROFILES.find((p) => p.id === "coding")!;
    const store = new InMemoryProfileStore([original]);
    const updated = { ...original, timeoutMs: 999 };
    await store.upsert(updated);
    await expect(store.get("coding")).resolves.toEqual(updated);
  });

  it("lists every stored profile", async () => {
    const store = new InMemoryProfileStore(SEED_EXECUTION_PROFILES);
    await expect(store.list()).resolves.toHaveLength(SEED_EXECUTION_PROFILES.length);
  });

  it("deletes a profile", async () => {
    const profile = SEED_EXECUTION_PROFILES[0]!;
    const store = new InMemoryProfileStore([profile]);
    await expect(store.delete(profile.id)).resolves.toBe(true);
    await expect(store.get(profile.id)).resolves.toBeNull();
  });

  it("delete returns false for a profile that was never present", async () => {
    const store = new InMemoryProfileStore();
    await expect(store.delete("nonexistent")).resolves.toBe(false);
  });
});
