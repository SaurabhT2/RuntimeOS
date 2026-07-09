import { describe, expect, it } from "vitest";
import { DefaultModelRegistry } from "../src/registry.js";
import { InMemoryModelStore } from "../src/store/model-store.js";
import { SEED_MODELS } from "../src/seed-data.js";
import type { ModelDescriptor } from "../src/model-descriptor.js";

function registry(
  seed: ModelDescriptor[] = SEED_MODELS,
  cacheTtlMs = 30_000,
): DefaultModelRegistry {
  return new DefaultModelRegistry({ seed, cacheTtlMs });
}

describe("DefaultModelRegistry — queryModels filtering", () => {
  it("returns every enabled model with an empty filter", async () => {
    const reg = registry();
    const results = await reg.queryModels({});
    expect(results).toHaveLength(SEED_MODELS.length);
  });

  it("filters by providerId", async () => {
    const reg = registry();
    const results = await reg.queryModels({ providerId: "groq" });
    expect(results.every((m) => m.providerId === "groq")).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });

  it("filters by modelClass", async () => {
    const reg = registry();
    const results = await reg.queryModels({ modelClass: "fast-extraction" });
    expect(results.every((m) => m.modelClass === "fast-extraction")).toBe(true);
    expect(results).toHaveLength(2); // groq + nvidia-nim per seed data
  });

  it("excludes availability.enabled === false models by default", async () => {
    const disabled: ModelDescriptor = {
      ...SEED_MODELS[0]!,
      modelId: "disabled-model",
      availability: { ...SEED_MODELS[0]!.availability, enabled: false },
    };
    const reg = registry([...SEED_MODELS, disabled]);
    const results = await reg.queryModels({});
    expect(results.some((m) => m.modelId === "disabled-model")).toBe(false);
  });

  it("includes disabled models when enabledOnly is explicitly false", async () => {
    const disabled: ModelDescriptor = {
      ...SEED_MODELS[0]!,
      modelId: "disabled-model",
      availability: { ...SEED_MODELS[0]!.availability, enabled: false },
    };
    const reg = registry([...SEED_MODELS, disabled]);
    const results = await reg.queryModels({ enabledOnly: false });
    expect(results.some((m) => m.modelId === "disabled-model")).toBe(true);
  });

  it("filters by minContextWindow", async () => {
    const reg = registry();
    const results = await reg.queryModels({ minContextWindow: 100_000 });
    expect(results.every((m) => m.capabilities.contextWindow >= 100_000)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });

  it("filters by requiresStructuredOutput", async () => {
    const reg = registry();
    const results = await reg.queryModels({ requiresStructuredOutput: true });
    expect(results.every((m) => m.capabilities.structuredOutput)).toBe(true);
    // The seeded "creative" model has structuredOutput: false and must be excluded.
    expect(results.some((m) => m.modelClass === "creative")).toBe(false);
  });

  it("filters by requiresToolCalling", async () => {
    const reg = registry();
    const results = await reg.queryModels({ requiresToolCalling: true });
    expect(results.every((m) => m.capabilities.toolCalling)).toBe(true);
  });

  it("filters by costTier", async () => {
    const reg = registry();
    const free = await reg.queryModels({ costTier: "free" });
    const paid = await reg.queryModels({ costTier: "paid" });
    expect(free.every((m) => m.cost.tier === "free")).toBe(true);
    expect(paid.every((m) => m.cost.tier === "paid")).toBe(true);
    expect(free.length + paid.length).toBe(SEED_MODELS.length);
  });

  it("combines multiple filters with AND semantics", async () => {
    const reg = registry();
    const results = await reg.queryModels({ providerId: "nvidia-nim", costTier: "paid" });
    expect(results.every((m) => m.providerId === "nvidia-nim" && m.cost.tier === "paid")).toBe(
      true,
    );
  });
});

describe("DefaultModelRegistry — getModel", () => {
  it("returns the matching descriptor", async () => {
    const reg = registry();
    const seedModel = SEED_MODELS[0]!;
    const result = await reg.getModel(seedModel.providerId, seedModel.modelId);
    expect(result).toEqual(seedModel);
  });

  it("returns null for an unknown (providerId, modelId) pair", async () => {
    const reg = registry();
    expect(await reg.getModel("groq", "does-not-exist")).toBeNull();
  });
});

describe("DefaultModelRegistry — cache invalidation (architecture §14.2)", () => {
  it("serves queryModels from cache within the TTL, without re-scanning the store", async () => {
    const store = new InMemoryModelStore(SEED_MODELS);
    let listCalls = 0;
    const originalList = store.list.bind(store);
    store.list = async () => {
      listCalls += 1;
      return originalList();
    };
    const reg = new DefaultModelRegistry({ store, cacheTtlMs: 30_000 });

    await reg.queryModels({ providerId: "groq" });
    await reg.queryModels({ providerId: "groq" });
    await reg.queryModels({ providerId: "groq" });

    expect(listCalls).toBe(1);
  });

  it("upsertModel invalidates the query cache so subsequent queries see the write", async () => {
    const reg = registry(SEED_MODELS, 30_000);
    const before = await reg.queryModels({ providerId: "groq" });
    expect(before.some((m) => m.modelId === "brand-new-model")).toBe(false);

    const newModel: ModelDescriptor = { ...SEED_MODELS[0]!, modelId: "brand-new-model" };
    await reg.upsertModel(newModel);

    const after = await reg.queryModels({ providerId: "groq" });
    expect(after.some((m) => m.modelId === "brand-new-model")).toBe(true);
  });

  it("upsertModel invalidates only the affected getModel cache key", async () => {
    const reg = registry(SEED_MODELS, 30_000);
    const seedModel = SEED_MODELS[0]!;
    const otherModel = SEED_MODELS[1]!;

    // Warm both cache entries.
    await reg.getModel(seedModel.providerId, seedModel.modelId);
    await reg.getModel(otherModel.providerId, otherModel.modelId);

    const updated = { ...seedModel, cost: { ...seedModel.cost, inputPer1kTokensUsd: 999 } };
    await reg.upsertModel(updated);

    const refetched = await reg.getModel(seedModel.providerId, seedModel.modelId);
    expect(refetched?.cost.inputPer1kTokensUsd).toBe(999);
  });

  it("onCacheInvalidated notifies subscribers on upsertModel", async () => {
    const reg = registry(SEED_MODELS, 30_000);
    const seenKeys: (string | null)[] = [];
    reg.onCacheInvalidated((key) => seenKeys.push(key));

    await reg.upsertModel({ ...SEED_MODELS[0]!, modelId: "notify-model" });

    expect(seenKeys.length).toBeGreaterThan(0);
  });
});
