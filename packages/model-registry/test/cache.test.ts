import { describe, expect, it, vi } from "vitest";
import { TtlCache } from "../src/cache.js";

describe("TtlCache", () => {
  it("returns undefined for a key never set", () => {
    const cache = new TtlCache<string>({ ttlMs: 1000 });
    expect(cache.get("missing")).toBeUndefined();
  });

  it("returns the value while within the TTL window", () => {
    let now = 0;
    const cache = new TtlCache<string>({ ttlMs: 1000, now: () => now });
    cache.set("a", "value");
    now = 999;
    expect(cache.get("a")).toBe("value");
  });

  it("expires the value once the TTL elapses", () => {
    let now = 0;
    const cache = new TtlCache<string>({ ttlMs: 1000, now: () => now });
    cache.set("a", "value");
    now = 1000;
    expect(cache.get("a")).toBeUndefined();
  });

  it("invalidate(key) removes only that key", () => {
    const cache = new TtlCache<string>({ ttlMs: 1000 });
    cache.set("a", "1");
    cache.set("b", "2");

    cache.invalidate("a");

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("2");
  });

  it("invalidate() with no key clears every entry", () => {
    const cache = new TtlCache<string>({ ttlMs: 1000 });
    cache.set("a", "1");
    cache.set("b", "2");

    cache.invalidate();

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
  });

  it("notifies onInvalidate subscribers with the invalidated key", () => {
    const cache = new TtlCache<string>({ ttlMs: 1000 });
    const listener = vi.fn();
    cache.onInvalidate(listener);

    cache.set("a", "1");
    cache.invalidate("a");

    expect(listener).toHaveBeenCalledWith("a");
  });

  it("notifies onInvalidate subscribers with null on a full clear", () => {
    const cache = new TtlCache<string>({ ttlMs: 1000 });
    const listener = vi.fn();
    cache.onInvalidate(listener);

    cache.invalidate();

    expect(listener).toHaveBeenCalledWith(null);
  });

  it("stops notifying after unsubscribe", () => {
    const cache = new TtlCache<string>({ ttlMs: 1000 });
    const listener = vi.fn();
    const unsubscribe = cache.onInvalidate(listener);
    unsubscribe();

    cache.invalidate("a");

    expect(listener).not.toHaveBeenCalled();
  });
});
