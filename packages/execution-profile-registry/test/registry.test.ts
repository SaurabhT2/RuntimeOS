import { describe, expect, it, vi } from "vitest";
import {
  DefaultExecutionProfileRegistry,
  createSeededExecutionProfileRegistry,
} from "../src/registry.js";
import { ExecutionProfileResolutionError } from "../src/errors.js";
import { SEED_EXECUTION_PROFILES, TASK_TO_EXECUTION_PROFILE_ID } from "../src/seed-data.js";
import { InMemoryProfileStore } from "../src/store/profile-store.js";

describe("DefaultExecutionProfileRegistry", () => {
  it("resolves a mapped task to its execution profile", async () => {
    const registry = createSeededExecutionProfileRegistry();
    const profile = await registry.resolveProfile("summarization");
    expect(profile.id).toBe("summarization");
  });

  it("resolves every core-contracts task type end to end", async () => {
    const registry = createSeededExecutionProfileRegistry();
    for (const [task, expectedProfileId] of Object.entries(TASK_TO_EXECUTION_PROFILE_ID)) {
      const profile = await registry.resolveProfile(task);
      expect(profile.id).toBe(expectedProfileId);
    }
  });

  it("throws ExecutionProfileResolutionError for an unmapped task", async () => {
    const registry = new DefaultExecutionProfileRegistry();
    await expect(registry.resolveProfile("unmapped_task")).rejects.toThrow(
      ExecutionProfileResolutionError,
    );
  });

  it("throws ExecutionProfileResolutionError when a task maps to an unregistered profile id", async () => {
    const registry = new DefaultExecutionProfileRegistry({
      seedTaskMapping: { some_task: "ghost_profile" },
    });
    await expect(registry.resolveProfile("some_task")).rejects.toThrow(
      ExecutionProfileResolutionError,
    );
  });

  it("honors an explicit override profile id, bypassing task mapping entirely", async () => {
    const registry = createSeededExecutionProfileRegistry();
    const profile = await registry.resolveProfile("classification", "coding");
    expect(profile.id).toBe("coding");
  });

  it("throws ExecutionProfileResolutionError for an unknown override profile id", async () => {
    const registry = createSeededExecutionProfileRegistry();
    await expect(registry.resolveProfile("summarization", "does_not_exist")).rejects.toThrow(
      ExecutionProfileResolutionError,
    );
  });

  it("getProfileById returns null for an unregistered id", async () => {
    const registry = new DefaultExecutionProfileRegistry();
    await expect(registry.getProfileById("extraction")).resolves.toBeNull();
  });

  it("upsertProfile registers a new profile and invalidates its cache entry", async () => {
    const registry = new DefaultExecutionProfileRegistry();
    const custom = { ...SEED_EXECUTION_PROFILES[0]!, id: "custom_profile" };
    await registry.upsertProfile(custom);
    await expect(registry.getProfileById("custom_profile")).resolves.toEqual(custom);
  });

  it("upsertProfile overwrites an existing profile", async () => {
    const registry = createSeededExecutionProfileRegistry();
    const before = await registry.getProfileById("coding");
    const updated = { ...before!, timeoutMs: 12_345 };
    await registry.upsertProfile(updated);
    const after = await registry.getProfileById("coding");
    expect(after?.timeoutMs).toBe(12_345);
  });

  it("registerTaskMapping adds a new task->profile route usable by resolveProfile", async () => {
    const registry = createSeededExecutionProfileRegistry();
    await registry.registerTaskMapping("my_custom_task", "coding");
    const profile = await registry.resolveProfile("my_custom_task");
    expect(profile.id).toBe("coding");
  });

  it("caches getProfileById reads (store.get called once across repeated lookups)", async () => {
    const store = new InMemoryProfileStore(SEED_EXECUTION_PROFILES);
    const getSpy = vi.spyOn(store, "get");
    const registry = new DefaultExecutionProfileRegistry({ store });

    await registry.getProfileById("summarization");
    await registry.getProfileById("summarization");
    await registry.getProfileById("summarization");

    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it("expires cached profile entries after the configured TTL", async () => {
    const store = new InMemoryProfileStore(SEED_EXECUTION_PROFILES);
    const getSpy = vi.spyOn(store, "get");
    const registry = new DefaultExecutionProfileRegistry({ store, cacheTtlMs: 1 });

    await registry.getProfileById("summarization");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await registry.getProfileById("summarization");

    expect(getSpy).toHaveBeenCalledTimes(2);
  });

  it("onCacheInvalidated notifies subscribers on upsertProfile", async () => {
    const registry = createSeededExecutionProfileRegistry();
    const listener = vi.fn();
    const unsubscribe = registry.onCacheInvalidated(listener);

    const profile = SEED_EXECUTION_PROFILES.find((p) => p.id === "coding")!;
    await registry.upsertProfile(profile);
    expect(listener).toHaveBeenCalledWith("coding");

    unsubscribe();
    await registry.upsertProfile(profile);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
