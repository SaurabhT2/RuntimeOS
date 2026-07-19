import { describe, expect, it } from "vitest";
import { InMemoryModelStore, modelKeysEqual } from "../src/store/model-store.js";
import { SEED_MODELS } from "../src/seed-data.js";

describe("InMemoryModelStore", () => {
  it("returns null for a key that was never stored", async () => {
    const store = new InMemoryModelStore();
    expect(await store.get({ providerId: "groq", modelId: "nope" })).toBeNull();
  });

  it("round-trips a descriptor through upsert -> get", async () => {
    const store = new InMemoryModelStore();
    const model = SEED_MODELS[0]!;
    await store.upsert(model);
    expect(await store.get({ providerId: model.providerId, modelId: model.modelId })).toEqual(
      model,
    );
  });

  it("upsert overwrites an existing entry with the same key", async () => {
    const store = new InMemoryModelStore();
    const model = SEED_MODELS[0]!;
    await store.upsert(model);
    const updated = { ...model, availability: { ...model.availability, enabled: false } };
    await store.upsert(updated);

    const result = await store.get({ providerId: model.providerId, modelId: model.modelId });
    expect(result?.availability.enabled).toBe(false);
  });

  it("seeds from the constructor", async () => {
    const store = new InMemoryModelStore(SEED_MODELS);
    expect(await store.list()).toHaveLength(SEED_MODELS.length);
  });

  it("list returns every stored descriptor", async () => {
    const store = new InMemoryModelStore();
    await store.upsert(SEED_MODELS[0]!);
    await store.upsert(SEED_MODELS[1]!);
    const all = await store.list();
    expect(all).toHaveLength(2);
  });

  it("delete removes an entry and reports whether one was removed", async () => {
    const store = new InMemoryModelStore(SEED_MODELS);
    const key = { providerId: SEED_MODELS[0]!.providerId, modelId: SEED_MODELS[0]!.modelId };

    expect(await store.delete(key)).toBe(true);
    expect(await store.get(key)).toBeNull();
    expect(await store.delete(key)).toBe(false); // already gone
  });
});

describe("modelKeysEqual", () => {
  it("compares providerId and modelId", () => {
    expect(
      modelKeysEqual({ providerId: "groq", modelId: "a" }, { providerId: "groq", modelId: "a" }),
    ).toBe(true);
    expect(
      modelKeysEqual({ providerId: "groq", modelId: "a" }, { providerId: "groq", modelId: "b" }),
    ).toBe(false);
    expect(
      modelKeysEqual(
        { providerId: "groq", modelId: "a" },
        { providerId: "nvidia-nim", modelId: "a" },
      ),
    ).toBe(false);
  });
});
