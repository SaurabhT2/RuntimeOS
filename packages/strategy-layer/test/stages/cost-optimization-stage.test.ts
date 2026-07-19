import { describe, expect, it } from "vitest";
import { CostOptimizationStage } from "../../src/stages/cost-optimization-stage.js";
import { baseRequest, seededOptions, tenant } from "../fixtures.js";

const RESOLVED_PROFILE = {
  id: "reasoning" as const,
  preferredModelClasses: ["complex-reasoning"],
  inference: { temperature: 0.4, maxOutputTokens: 1024 },
  timeoutMs: 30_000,
  retryPolicy: {
    maxAttempts: 2,
    backoff: "exponential" as const,
    baseDelayMs: 200,
    maxDelayMs: 4_000,
    jitter: true,
    retryableErrorCodes: [],
  },
  streaming: { defaultEnabled: true, chunking: "token" as const },
  structuredOutput: { defaultEnabled: false },
  caching: { defaultEnabled: false, keyStrategy: "exact" as const },
};

const SHALLOW_CAPABILITIES = {
  structuredOutput: false,
  toolCalling: false,
  reasoningDepth: "shallow" as const,
  streamingPreferred: false,
  minContextTokens: 4_000,
};

describe("CostOptimizationStage", () => {
  it("throws if requiredCapabilities/executionProfile/runtimeProfile aren't resolved yet", async () => {
    const options = seededOptions();
    const stage = new CostOptimizationStage(options.costOptimizer, options.cache);
    await expect(stage.run({ request: baseRequest(), tenant: tenant() })).rejects.toThrow(
      /requiredCapabilities/,
    );
  });

  it("throws if optimizedPrompt isn't resolved yet", async () => {
    const options = seededOptions();
    const stage = new CostOptimizationStage(options.costOptimizer, options.cache);
    const runtimeProfile = await options.runtimeProfileRegistry.getActiveRuntimeProfile({
      organizationId: "org-1",
    });
    await expect(
      stage.run({
        request: baseRequest(),
        tenant: tenant(),
        requiredCapabilities: SHALLOW_CAPABILITIES,
        executionProfile: RESOLVED_PROFILE,
        runtimeProfile,
      }),
    ).rejects.toThrow(/optimizedPrompt/);
  });

  it("resolves costOptimization using optimizedPrompt.estimatedTokens as promptTokenEstimate", async () => {
    const options = seededOptions();
    const stage = new CostOptimizationStage(options.costOptimizer, options.cache);
    const runtimeProfile = await options.runtimeProfileRegistry.getActiveRuntimeProfile({
      organizationId: "org-1",
    });
    const result = await stage.run({
      request: baseRequest(),
      tenant: tenant(),
      requiredCapabilities: SHALLOW_CAPABILITIES,
      executionProfile: RESOLVED_PROFILE,
      runtimeProfile,
      optimizedPrompt: { messages: [], estimatedTokens: 123, transformationsApplied: [] },
    });
    expect(result.costOptimization).toBeDefined();
    expect(result.costOptimization?.recommendedModelClassDowngrade).toBe("fast-extraction");
  });

  it("never recommends a downgrade for a deep-reasoning task (capability preservation)", async () => {
    const options = seededOptions();
    const stage = new CostOptimizationStage(options.costOptimizer, options.cache);
    const runtimeProfile = await options.runtimeProfileRegistry.getActiveRuntimeProfile({
      organizationId: "org-1",
    });
    const result = await stage.run({
      request: baseRequest(),
      tenant: tenant(),
      requiredCapabilities: { ...SHALLOW_CAPABILITIES, reasoningDepth: "deep" },
      executionProfile: RESOLVED_PROFILE,
      runtimeProfile,
      optimizedPrompt: { messages: [], estimatedTokens: 123, transformationsApplied: [] },
    });
    expect(result.costOptimization?.recommendedModelClassDowngrade).toBeUndefined();
  });
});
