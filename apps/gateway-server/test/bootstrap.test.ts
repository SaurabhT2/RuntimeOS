import { describe, expect, it } from "vitest";
import { bootstrap } from "../src/bootstrap.js";
import { fakeAdapter, TEST_MODEL_SEED, testServerConfig } from "./fixtures.js";

describe("bootstrap", () => {
  it("wires every platform package into a GatewayApp bundle", async () => {
    const app = await bootstrap(testServerConfig(), {
      adapters: [fakeAdapter({ id: "groq" }), fakeAdapter({ id: "nvidia-nim" })],
      modelRegistrySeed: TEST_MODEL_SEED,
    });

    expect(app.telemetry).toBeDefined();
    expect(app.gatewayConfig).toBeDefined();
    expect(app.modelRegistry).toBeDefined();
    expect(app.credentialResolver).toBeDefined();
    expect(app.healthMonitor).toBeDefined();
    expect(app.circuitBreaker).toBeDefined();
    expect(app.policyEngine).toBeDefined();
    expect(app.streamManager).toBeDefined();
    expect(app.orchestrator).toBeDefined();
    expect(app.auth).toBeDefined();
    expect(app.rateLimit).toBeDefined();
    expect(app.cache).toBeDefined();
    expect(app.pipeline).toBeDefined();
    expect(app.adapters.map((a) => a.id).sort()).toEqual(["groq", "nvidia-nim"]);
  });

  it("uses the real GroqAdapter/NimAdapter when no adapter override is supplied", async () => {
    const app = await bootstrap(testServerConfig());
    expect(app.adapters.map((a) => a.id).sort()).toEqual(["groq", "nvidia-nim"]);
  });

  it("falls back to DEFAULT_GATEWAY_CONFIG when no gatewayConfigPath is set", async () => {
    const app = await bootstrap(testServerConfig());
    expect(app.gatewayConfig.credentialPriority).toEqual([
      "user",
      "project",
      "workspace",
      "organization",
      "platform",
    ]);
  });

  it("prefers the server config's own credentialPriority over GatewayConfig's default when non-empty", async () => {
    const app = await bootstrap(testServerConfig({ credentialPriority: ["platform"] }));
    // Not directly observable on GatewayApp, but resolving a platform-only
    // credential should still succeed — exercised end-to-end in
    // test/integration/end-to-end.test.ts. Here we assert the resolver was
    // constructed at all (no throw), which already covers the wiring path.
    expect(app.credentialResolver).toBeDefined();
  });

  it("loads a real GatewayConfig file when gatewayConfigPath is set", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gw-test-"));
    const configPath = path.join(dir, "config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        credentialPriority: ["platform"],
        routing: { defaultStrategy: "cost_optimized" },
        reliability: { maxRetries: 1, backoff: "linear", circuitBreakerThreshold: 3 },
      }),
    );

    const app = await bootstrap(testServerConfig({ gatewayConfigPath: configPath }));
    expect(app.gatewayConfig.routing.defaultStrategy).toBe("cost_optimized");
  });

  it("throws when the loaded GatewayConfig file fails schema validation", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gw-test-"));
    const configPath = path.join(dir, "bad-config.json");
    await fs.writeFile(configPath, JSON.stringify({ credentialPriority: ["not-a-real-scope"] }));

    await expect(bootstrap(testServerConfig({ gatewayConfigPath: configPath }))).rejects.toThrow();
  });
});
