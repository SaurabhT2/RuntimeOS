import { describe, expect, it } from "vitest";
import { gatewayConfigSchema, DEFAULT_GATEWAY_CONFIG } from "../src/schema.js";

describe("gatewayConfigSchema", () => {
  it("accepts the default config", () => {
    const result = gatewayConfigSchema.safeParse(DEFAULT_GATEWAY_CONFIG);
    expect(result.success).toBe(true);
  });

  it("accepts a fully-populated config, including perTaskOverrides and runtimeProfileId", () => {
    const result = gatewayConfigSchema.safeParse({
      credentialPriority: ["organization", "platform"],
      routing: {
        defaultStrategy: "cost_optimized",
        perTaskOverrides: {
          summarization: { strategy: "latency_optimized", preferredProviders: ["groq"] },
        },
      },
      reliability: {
        maxRetries: 3,
        backoff: "linear",
        circuitBreakerThreshold: 10,
      },
      runtimeProfileId: "enterprise",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a config with runtimeProfileId omitted (v1.0 configs remain valid)", () => {
    const result = gatewayConfigSchema.safeParse(DEFAULT_GATEWAY_CONFIG);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.runtimeProfileId).toBeUndefined();
    }
  });

  it("rejects an empty-string runtimeProfileId", () => {
    const result = gatewayConfigSchema.safeParse({
      ...DEFAULT_GATEWAY_CONFIG,
      runtimeProfileId: "",
    });
    expect(result.success).toBe(false);
  });

  it("accepts enableStrategyLayer: true (ADR-0017)", () => {
    const result = gatewayConfigSchema.safeParse({
      ...DEFAULT_GATEWAY_CONFIG,
      enableStrategyLayer: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a config with enableStrategyLayer omitted, defaulting to falsy/undefined (v1.1 configs remain valid)", () => {
    const result = gatewayConfigSchema.safeParse(DEFAULT_GATEWAY_CONFIG);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enableStrategyLayer).toBeUndefined();
    }
  });

  it("rejects a non-boolean enableStrategyLayer", () => {
    const result = gatewayConfigSchema.safeParse({
      ...DEFAULT_GATEWAY_CONFIG,
      enableStrategyLayer: "true",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty credentialPriority", () => {
    const result = gatewayConfigSchema.safeParse({
      ...DEFAULT_GATEWAY_CONFIG,
      credentialPriority: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown credential scope", () => {
    const result = gatewayConfigSchema.safeParse({
      ...DEFAULT_GATEWAY_CONFIG,
      credentialPriority: ["superuser"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown routing strategy", () => {
    const result = gatewayConfigSchema.safeParse({
      ...DEFAULT_GATEWAY_CONFIG,
      routing: { defaultStrategy: "vibes_optimized" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative maxRetries", () => {
    const result = gatewayConfigSchema.safeParse({
      ...DEFAULT_GATEWAY_CONFIG,
      reliability: { ...DEFAULT_GATEWAY_CONFIG.reliability, maxRetries: -1 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-positive circuitBreakerThreshold", () => {
    const result = gatewayConfigSchema.safeParse({
      ...DEFAULT_GATEWAY_CONFIG,
      reliability: { ...DEFAULT_GATEWAY_CONFIG.reliability, circuitBreakerThreshold: 0 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const { routing: _routing, ...withoutRouting } = DEFAULT_GATEWAY_CONFIG;
    const result = gatewayConfigSchema.safeParse(withoutRouting);
    expect(result.success).toBe(false);
  });
});
