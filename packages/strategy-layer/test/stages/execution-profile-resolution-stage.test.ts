import { describe, expect, it } from "vitest";
import { ExecutionProfileResolutionStage } from "../../src/stages/execution-profile-resolution-stage.js";
import { baseRequest, seededOptions, tenant } from "../fixtures.js";

describe("ExecutionProfileResolutionStage", () => {
  it("resolves an executionProfile for the request's task", async () => {
    const options = seededOptions();
    const stage = new ExecutionProfileResolutionStage(options.executionProfileRegistry);
    const result = await stage.run({ request: baseRequest(), tenant: tenant() });
    expect(result.executionProfile).toBeDefined();
    expect(result.executionProfile?.id).toBeTruthy();
  });

  it("respects preferences.executionProfileOverride", async () => {
    const options = seededOptions();
    const stage = new ExecutionProfileResolutionStage(options.executionProfileRegistry);
    const result = await stage.run({
      request: baseRequest({ preferences: { executionProfileOverride: "coding" } }),
      tenant: tenant(),
    });
    expect(result.executionProfile?.id).toBe("coding");
  });

  it("is independently replaceable — any ExecutionProfileRegistry-shaped object works", async () => {
    const stub = {
      resolveProfile: async () => ({
        id: "reasoning" as const,
        preferredModelClasses: ["complex-reasoning"],
        inference: { temperature: 0.5, maxOutputTokens: 2048 },
        timeoutMs: 30_000,
        retryPolicy: {
          maxAttempts: 2,
          backoff: "exponential" as const,
          baseDelayMs: 200,
          maxDelayMs: 4_000,
          jitter: true,
          retryableErrorCodes: [],
        },
        streaming: { defaultEnabled: false },
        structuredOutput: { defaultEnabled: false },
        caching: { defaultEnabled: false, keyStrategy: "exact" as const },
      }),
      getProfileById: async () => null,
      upsertProfile: async () => undefined,
      registerTaskMapping: async () => undefined,
    };
    const stage = new ExecutionProfileResolutionStage(stub);
    const result = await stage.run({ request: baseRequest(), tenant: tenant() });
    expect(result.executionProfile?.id).toBe("reasoning");
  });

  // EM-9 (Independent Architecture & Engineering Review of EM-9, activating
  // architecture §37.4's first read site).
  describe("EM-9: Runtime Profile adjustment merge", () => {
    const runtimeProfile = (
      overrides: Partial<{
        retryAggressiveness: "conservative" | "standard" | "aggressive";
        cachingAggressiveness: "off" | "standard" | "aggressive";
      }> = {},
    ) => ({
      id: "test-runtime-profile",
      provider: {
        preferFreeTier: false,
        allowedLifecycleStates: ["stable" as const],
        maxProvidersInFailoverChain: 3,
      },
      reliability: {
        retryAggressiveness: overrides.retryAggressiveness ?? "standard",
        failoverAggressiveness: "standard" as const,
      },
      cost: {},
      telemetry: { verbosity: "standard" as const },
      caching: { aggressiveness: overrides.cachingAggressiveness ?? "standard" },
    });

    it("'standard'/'standard' (the default production runtime profile) changes nothing and sets no adjustedBy", async () => {
      const options = seededOptions();
      const stage = new ExecutionProfileResolutionStage(options.executionProfileRegistry);
      const baseline = await stage.run({ request: baseRequest(), tenant: tenant() });
      const withStandardRuntimeProfile = await stage.run({
        request: baseRequest(),
        tenant: tenant(),
        runtimeProfile: runtimeProfile(),
      });
      expect(withStandardRuntimeProfile.executionProfile).toEqual(baseline.executionProfile);
      expect(withStandardRuntimeProfile.executionProfile?.adjustedBy).toBeUndefined();
    });

    it("'conservative' retryAggressiveness reduces maxAttempts and slows backoff, and records adjustedBy", async () => {
      const options = seededOptions();
      const stage = new ExecutionProfileResolutionStage(options.executionProfileRegistry);
      const baseline = await stage.run({ request: baseRequest(), tenant: tenant() });
      const result = await stage.run({
        request: baseRequest(),
        tenant: tenant(),
        runtimeProfile: runtimeProfile({ retryAggressiveness: "conservative" }),
      });
      const baseRetry = baseline.executionProfile!.retryPolicy;
      const adjustedRetry = result.executionProfile!.retryPolicy;
      expect(adjustedRetry.maxAttempts).toBe(Math.max(1, baseRetry.maxAttempts - 1));
      expect(adjustedRetry.baseDelayMs).toBe(baseRetry.baseDelayMs * 2);
      expect(adjustedRetry.maxDelayMs).toBe(baseRetry.maxDelayMs * 2);
      expect(result.executionProfile?.adjustedBy).toEqual({
        runtimeProfileId: "test-runtime-profile",
        fieldsOverridden: ["retryPolicy"],
      });
    });

    it("'aggressive' retryAggressiveness increases maxAttempts and speeds up backoff", async () => {
      const options = seededOptions();
      const stage = new ExecutionProfileResolutionStage(options.executionProfileRegistry);
      const baseline = await stage.run({ request: baseRequest(), tenant: tenant() });
      const result = await stage.run({
        request: baseRequest(),
        tenant: tenant(),
        runtimeProfile: runtimeProfile({ retryAggressiveness: "aggressive" }),
      });
      const baseRetry = baseline.executionProfile!.retryPolicy;
      const adjustedRetry = result.executionProfile!.retryPolicy;
      expect(adjustedRetry.maxAttempts).toBe(baseRetry.maxAttempts + 2);
      expect(adjustedRetry.baseDelayMs).toBeLessThan(baseRetry.baseDelayMs);
    });

    it("'off' caching aggressiveness disables caching regardless of the profile's own default", async () => {
      const options = seededOptions();
      const stage = new ExecutionProfileResolutionStage(options.executionProfileRegistry);
      // "extraction" defaults to caching on (see SEED_EXECUTION_PROFILES).
      const result = await stage.run({
        request: baseRequest({ task: "knowledge_extraction" }),
        tenant: tenant(),
        runtimeProfile: runtimeProfile({ cachingAggressiveness: "off" }),
      });
      expect(result.executionProfile?.caching.defaultEnabled).toBe(false);
      expect(result.executionProfile?.adjustedBy?.fieldsOverridden).toContain("caching");
    });

    it("'aggressive' caching aggressiveness enables caching even for a profile whose own default is off, with an extended TTL", async () => {
      const options = seededOptions();
      const stage = new ExecutionProfileResolutionStage(options.executionProfileRegistry);
      // "summarization" defaults to caching off (see SEED_EXECUTION_PROFILES).
      const result = await stage.run({
        request: baseRequest({ task: "summarization" }),
        tenant: tenant(),
        runtimeProfile: runtimeProfile({ cachingAggressiveness: "aggressive" }),
      });
      expect(result.executionProfile?.caching.defaultEnabled).toBe(true);
      expect(result.executionProfile?.caching.ttlSeconds).toBeGreaterThan(0);
      expect(result.executionProfile?.adjustedBy?.fieldsOverridden).toContain("caching");
    });

    it("falls back to the unmodified profile (no adjustedBy) when no runtimeProfile is present in context", async () => {
      const options = seededOptions();
      const stage = new ExecutionProfileResolutionStage(options.executionProfileRegistry);
      const result = await stage.run({ request: baseRequest(), tenant: tenant() });
      expect(result.executionProfile?.adjustedBy).toBeUndefined();
    });
  });
});
