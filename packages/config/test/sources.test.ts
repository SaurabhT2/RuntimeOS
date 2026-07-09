import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EnvConfigSource, FileConfigSource, InMemoryConfigSource } from "../src/sources.js";
import { ConfigError } from "../src/errors.js";
import { DEFAULT_GATEWAY_CONFIG } from "../src/schema.js";

describe("EnvConfigSource", () => {
  const ENV_VAR = "AI_GATEWAY_CONFIG_JSON_TEST";

  afterEach(() => {
    delete process.env[ENV_VAR];
  });

  it("reads and parses JSON from the configured env var", async () => {
    process.env[ENV_VAR] = JSON.stringify(DEFAULT_GATEWAY_CONFIG);
    const source = new EnvConfigSource(ENV_VAR);
    await expect(source.read()).resolves.toEqual(DEFAULT_GATEWAY_CONFIG);
  });

  it("throws ConfigError when the env var is unset", async () => {
    const source = new EnvConfigSource(ENV_VAR);
    await expect(source.read()).rejects.toBeInstanceOf(ConfigError);
  });

  it("throws ConfigError on malformed JSON", async () => {
    process.env[ENV_VAR] = "{not json";
    const source = new EnvConfigSource(ENV_VAR);
    await expect(source.read()).rejects.toBeInstanceOf(ConfigError);
  });

  it("watch() returns a no-op unsubscribe function", () => {
    const source = new EnvConfigSource(ENV_VAR);
    const unsubscribe = source.watch(() => undefined);
    expect(() => unsubscribe()).not.toThrow();
  });
});

describe("FileConfigSource", () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ai-gateway-config-test-"));
    filePath = join(dir, "config.json");
    await writeFile(filePath, JSON.stringify(DEFAULT_GATEWAY_CONFIG));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads and parses JSON from disk", async () => {
    const source = new FileConfigSource(filePath);
    await expect(source.read()).resolves.toEqual(DEFAULT_GATEWAY_CONFIG);
  });

  it("throws ConfigError when the file does not exist", async () => {
    const source = new FileConfigSource(join(dir, "missing.json"));
    await expect(source.read()).rejects.toBeInstanceOf(ConfigError);
  });

  it("throws ConfigError on malformed JSON", async () => {
    await writeFile(filePath, "{not json");
    const source = new FileConfigSource(filePath);
    await expect(source.read()).rejects.toBeInstanceOf(ConfigError);
  });

  it("notifies watchers when the file changes", async () => {
    const source = new FileConfigSource(filePath);
    const changes: number[] = [];
    const unsubscribe = source.watch(() => changes.push(1));

    await writeFile(
      filePath,
      JSON.stringify({ ...DEFAULT_GATEWAY_CONFIG, reliability: { maxRetries: 5 } }),
    );

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(changes.length).toBeGreaterThan(0);
    unsubscribe();
  });
});

describe("InMemoryConfigSource", () => {
  it("reads the current in-memory value", async () => {
    const source = new InMemoryConfigSource(DEFAULT_GATEWAY_CONFIG);
    await expect(source.read()).resolves.toEqual(DEFAULT_GATEWAY_CONFIG);
  });

  it("notifies watchers exactly once per set() call", async () => {
    const source = new InMemoryConfigSource(DEFAULT_GATEWAY_CONFIG);
    let calls = 0;
    const unsubscribe = source.watch(() => calls++);

    source.set({ ...DEFAULT_GATEWAY_CONFIG, reliability: { maxRetries: 9 } });
    expect(calls).toBe(1);

    unsubscribe();
    source.set({ ...DEFAULT_GATEWAY_CONFIG, reliability: { maxRetries: 10 } });
    expect(calls).toBe(1); // no longer subscribed
  });
});
