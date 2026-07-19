import { describe, expect, it } from "vitest";
import { InMemoryCacheClient } from "../src/in-memory-cache-client.js";

describe("InMemoryCacheClient", () => {
  it("returns undefined for a key that was never seeded", async () => {
    const cache = new InMemoryCacheClient();
    expect(await cache.lookup("missing", "exact")).toBeUndefined();
  });

  it("returns a seeded entry by exact key match", async () => {
    const cache = new InMemoryCacheClient();
    cache.seed("k", { content: "hello", cachedAt: 123 });
    expect(await cache.lookup("k", "exact")).toEqual({ content: "hello", cachedAt: 123 });
  });

  it("ignores the strategy parameter for lookup purposes (no semantic index in this in-memory implementation)", async () => {
    const cache = new InMemoryCacheClient();
    cache.seed("k", { content: "hello", cachedAt: 123 });
    expect(await cache.lookup("k", "semantic")).toEqual({ content: "hello", cachedAt: 123 });
  });
});
