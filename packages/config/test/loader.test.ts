import { describe, expect, it } from "vitest";
import { loadConfig, watchConfig } from "../src/loader.js";
import { InMemoryConfigSource } from "../src/sources.js";
import { ConfigError } from "../src/errors.js";
import { DEFAULT_GATEWAY_CONFIG } from "../src/schema.js";

describe("loadConfig", () => {
  it("returns a validated config from the source", async () => {
    const source = new InMemoryConfigSource(DEFAULT_GATEWAY_CONFIG);
    await expect(loadConfig(source)).resolves.toEqual(DEFAULT_GATEWAY_CONFIG);
  });

  it("throws ConfigError with a readable message when validation fails", async () => {
    const source = new InMemoryConfigSource({ nonsense: true });
    await expect(loadConfig(source)).rejects.toThrow(ConfigError);
    await expect(loadConfig(source)).rejects.toThrow(/failed validation/);
  });
});

describe("watchConfig", () => {
  it("loads the initial config and exposes it as .current", async () => {
    const source = new InMemoryConfigSource(DEFAULT_GATEWAY_CONFIG);
    const handle = await watchConfig(source, () => undefined);
    expect(handle.current).toEqual(DEFAULT_GATEWAY_CONFIG);
    handle.close();
  });

  it("fires onChange exactly once per actual change", async () => {
    const source = new InMemoryConfigSource(DEFAULT_GATEWAY_CONFIG);
    const seen: unknown[] = [];
    const handle = await watchConfig(source, (config) => seen.push(config));

    const updated = {
      ...DEFAULT_GATEWAY_CONFIG,
      reliability: { ...DEFAULT_GATEWAY_CONFIG.reliability, maxRetries: 7 },
    };
    source.set(updated);

    // allow the async validate-then-compare chain to settle
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(seen).toEqual([updated]);
    expect(handle.current).toEqual(updated);
    handle.close();
  });

  it("does not fire onChange when a reload produces an identical config", async () => {
    const source = new InMemoryConfigSource(DEFAULT_GATEWAY_CONFIG);
    let calls = 0;
    const handle = await watchConfig(source, () => calls++);

    // "change" to a structurally-identical value (new object identity, same content)
    source.set({ ...DEFAULT_GATEWAY_CONFIG });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(calls).toBe(0);
    handle.close();
  });

  it("invokes onError, not onChange, when a reload is invalid, and keeps .current unchanged", async () => {
    const source = new InMemoryConfigSource(DEFAULT_GATEWAY_CONFIG);
    let changeCalls = 0;
    const errors: ConfigError[] = [];
    const handle = await watchConfig(
      source,
      () => changeCalls++,
      (error) => errors.push(error),
    );

    source.set({ nonsense: true });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(changeCalls).toBe(0);
    expect(errors).toHaveLength(1);
    expect(handle.current).toEqual(DEFAULT_GATEWAY_CONFIG);
    handle.close();
  });

  it("close() unsubscribes from further changes", async () => {
    const source = new InMemoryConfigSource(DEFAULT_GATEWAY_CONFIG);
    let calls = 0;
    const handle = await watchConfig(source, () => calls++);
    handle.close();

    source.set({
      ...DEFAULT_GATEWAY_CONFIG,
      reliability: { ...DEFAULT_GATEWAY_CONFIG.reliability, maxRetries: 99 },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(calls).toBe(0);
  });
});
