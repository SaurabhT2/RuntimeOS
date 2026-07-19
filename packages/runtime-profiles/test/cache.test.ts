import { describe, expect, it, vi } from "vitest";
import { TtlCache } from "../src/cache.js";

describe("TtlCache", () => {
  it("returns undefined for a missing key", () => {
    const cache = new TtlCache<number>({ ttlMs: 1000 });
    expect(cache.get("missing")).toBeUndefined();
  });

  it("returns a set value before expiry", () => {
    const cache = new TtlCache<number>({ ttlMs: 1000 });
    cache.set("k", 42);
    expect(cache.get("k")).toBe(42);
  });

  it("expires a value after its TTL using an injected clock", () => {
    let now = 0;
    const cache = new TtlCache<number>({ ttlMs: 100, now: () => now });
    cache.set("k", 42);
    now = 101;
    expect(cache.get("k")).toBeUndefined();
  });

  it("invalidate(key) removes only that key", () => {
    const cache = new TtlCache<number>({ ttlMs: 1000 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.invalidate("a");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
  });

  it("invalidate() with no key clears everything", () => {
    const cache = new TtlCache<number>({ ttlMs: 1000 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.invalidate();
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
  });

  it("notifies onInvalidate listeners with the invalidated key, or null for a full clear", () => {
    const cache = new TtlCache<number>({ ttlMs: 1000 });
    const listener = vi.fn();
    cache.onInvalidate(listener);

    cache.invalidate("a");
    expect(listener).toHaveBeenCalledWith("a");

    cache.invalidate();
    expect(listener).toHaveBeenCalledWith(null);
  });

  it("unsubscribe stops further notifications", () => {
    const cache = new TtlCache<number>({ ttlMs: 1000 });
    const listener = vi.fn();
    const unsubscribe = cache.onInvalidate(listener);
    unsubscribe();
    cache.invalidate("a");
    expect(listener).not.toHaveBeenCalled();
  });
});
