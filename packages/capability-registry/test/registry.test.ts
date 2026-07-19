import { describe, expect, it, vi } from "vitest";
import type { ExecuteRequest } from "@ai-gateway/core-contracts";
import { DefaultCapabilityRegistry } from "../src/registry.js";
import { CapabilityResolutionError } from "../src/errors.js";
import { SEED_CAPABILITIES } from "../src/seed-data.js";
import { InMemoryCapabilityStore } from "../src/store/capability-store.js";

function baseRequest(overrides: Partial<ExecuteRequest["constraints"]> = {}): ExecuteRequest {
  return {
    task: "summarization",
    input: { text: "hello" },
    tenant: { organizationId: "org-1" },
    constraints: overrides,
  };
}

describe("DefaultCapabilityRegistry", () => {
  it("resolves a seeded task to its capability set", async () => {
    const registry = new DefaultCapabilityRegistry({ seed: SEED_CAPABILITIES });
    const result = await registry.resolveCapabilities("summarization");
    expect(result).toEqual(SEED_CAPABILITIES.summarization);
  });

  it("throws CapabilityResolutionError for an unmapped task", async () => {
    const registry = new DefaultCapabilityRegistry();
    await expect(registry.resolveCapabilities("unmapped_task")).rejects.toThrow(
      CapabilityResolutionError,
    );
  });

  it("forces structuredOutput true when constraints.requiredSchema is present", async () => {
    const registry = new DefaultCapabilityRegistry({ seed: SEED_CAPABILITIES });
    const req = baseRequest({ requiredSchema: { type: "object" } });
    const result = await registry.resolveCapabilities("summarization", req);
    expect(result.structuredOutput).toBe(true);
    // Unrelated fields are untouched.
    expect(result.reasoningDepth).toBe(SEED_CAPABILITIES.summarization?.reasoningDepth);
  });

  it("raises minContextTokens to the request's constraint when it's higher than the default", async () => {
    const registry = new DefaultCapabilityRegistry({ seed: SEED_CAPABILITIES });
    const req = baseRequest({ minContextTokens: 100_000 });
    const result = await registry.resolveCapabilities("summarization", req);
    expect(result.minContextTokens).toBe(100_000);
  });

  it("never lowers minContextTokens below the task's default", async () => {
    const registry = new DefaultCapabilityRegistry({ seed: SEED_CAPABILITIES });
    const req = baseRequest({ minContextTokens: 10 });
    const result = await registry.resolveCapabilities("summarization", req);
    expect(result.minContextTokens).toBe(SEED_CAPABILITIES.summarization?.minContextTokens);
  });

  it("honors an explicit streaming: false override even though the task defaults to streaming preferred", async () => {
    const registry = new DefaultCapabilityRegistry({ seed: SEED_CAPABILITIES });
    const req = baseRequest({ streaming: false });
    const result = await registry.resolveCapabilities("summarization", req);
    expect(result.streamingPreferred).toBe(false);
  });

  it("is unaffected by a request with no constraints object", async () => {
    const registry = new DefaultCapabilityRegistry({ seed: SEED_CAPABILITIES });
    const req: ExecuteRequest = {
      task: "summarization",
      input: { text: "hello" },
      tenant: { organizationId: "org-1" },
    };
    const result = await registry.resolveCapabilities("summarization", req);
    expect(result).toEqual(SEED_CAPABILITIES.summarization);
  });

  it("registerMapping makes a previously-unmapped task resolvable (config-driven, no redeploy)", async () => {
    const registry = new DefaultCapabilityRegistry();
    await expect(registry.resolveCapabilities("brand_new_task")).rejects.toThrow(
      CapabilityResolutionError,
    );
    await registry.registerMapping("brand_new_task", SEED_CAPABILITIES.code_generation!);
    await expect(registry.resolveCapabilities("brand_new_task")).resolves.toBeDefined();
  });

  it("registerMapping overwrites a previously-seeded mapping and invalidates the cache", async () => {
    const registry = new DefaultCapabilityRegistry({ seed: SEED_CAPABILITIES });
    const first = await registry.resolveCapabilities("classification");
    expect(first.structuredOutput).toBe(true);

    await registry.registerMapping("classification", {
      ...SEED_CAPABILITIES.classification!,
      structuredOutput: false,
    });

    const second = await registry.resolveCapabilities("classification");
    expect(second.structuredOutput).toBe(false);
  });

  it("serves repeated resolves for the same task from cache (store.get called once)", async () => {
    const store = new InMemoryCapabilityStore(SEED_CAPABILITIES);
    const getSpy = vi.spyOn(store, "get");
    const registry = new DefaultCapabilityRegistry({ store });

    await registry.resolveCapabilities("summarization");
    await registry.resolveCapabilities("summarization");
    await registry.resolveCapabilities("summarization");

    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it("expires cached entries after the configured TTL", async () => {
    const store = new InMemoryCapabilityStore(SEED_CAPABILITIES);
    const getSpy = vi.spyOn(store, "get");
    const registry = new DefaultCapabilityRegistry({ store, cacheTtlMs: 1 });

    await registry.resolveCapabilities("summarization");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await registry.resolveCapabilities("summarization");

    expect(getSpy).toHaveBeenCalledTimes(2);
  });

  it("onCacheInvalidated notifies subscribers on registerMapping", async () => {
    const registry = new DefaultCapabilityRegistry({ seed: SEED_CAPABILITIES });
    const listener = vi.fn();
    const unsubscribe = registry.onCacheInvalidated(listener);

    await registry.registerMapping("summarization", SEED_CAPABILITIES.summarization!);
    expect(listener).toHaveBeenCalledWith("summarization");

    unsubscribe();
    await registry.registerMapping("summarization", SEED_CAPABILITIES.summarization!);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
