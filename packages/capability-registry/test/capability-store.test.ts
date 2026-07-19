import { describe, expect, it } from "vitest";
import { InMemoryCapabilityStore } from "../src/store/capability-store.js";
import { SEED_CAPABILITIES } from "../src/seed-data.js";

describe("InMemoryCapabilityStore", () => {
  it("returns null for an unmapped task", async () => {
    const store = new InMemoryCapabilityStore();
    await expect(store.get("nonexistent_task")).resolves.toBeNull();
  });

  it("seeds mappings passed to the constructor", async () => {
    const store = new InMemoryCapabilityStore(SEED_CAPABILITIES);
    await expect(store.get("summarization")).resolves.toEqual(SEED_CAPABILITIES.summarization);
  });

  it("upserts and retrieves a mapping", async () => {
    const store = new InMemoryCapabilityStore();
    await store.upsert("custom_task", SEED_CAPABILITIES.summarization);
    await expect(store.get("custom_task")).resolves.toEqual(SEED_CAPABILITIES.summarization);
  });

  it("overwrites an existing mapping on upsert", async () => {
    const store = new InMemoryCapabilityStore({ custom_task: SEED_CAPABILITIES.summarization });
    await store.upsert("custom_task", SEED_CAPABILITIES.classification);
    await expect(store.get("custom_task")).resolves.toEqual(SEED_CAPABILITIES.classification);
  });

  it("lists every stored mapping", async () => {
    const store = new InMemoryCapabilityStore(SEED_CAPABILITIES);
    const all = await store.list();
    expect(all).toHaveLength(Object.keys(SEED_CAPABILITIES).length);
  });

  it("deletes a mapping", async () => {
    const store = new InMemoryCapabilityStore({ custom_task: SEED_CAPABILITIES.summarization });
    await expect(store.delete("custom_task")).resolves.toBe(true);
    await expect(store.get("custom_task")).resolves.toBeNull();
  });

  it("delete returns false for a mapping that was never present", async () => {
    const store = new InMemoryCapabilityStore();
    await expect(store.delete("nonexistent_task")).resolves.toBe(false);
  });
});
