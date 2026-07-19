import { describe, expect, it } from "vitest";
import { buildDefaultStages } from "../src/strategy-layer.js";
import {
  DefaultStrategyPipeline,
  IncompleteStrategyDecisionError,
} from "../src/strategy-pipeline.js";
import type { StrategyPipelineStage } from "../src/types.js";
import { baseRequest, seededOptions, tenant } from "./fixtures.js";

describe("DefaultStrategyPipeline — full pipeline integration", () => {
  it("produces a complete StrategyDecision matching architecture §30.3's frozen shape", async () => {
    const options = seededOptions();
    const pipeline = new DefaultStrategyPipeline(buildDefaultStages(options));
    const decision = await pipeline.run(baseRequest(), tenant());

    expect(decision).toMatchObject({
      requiredCapabilities: expect.any(Object),
      executionProfile: expect.any(Object),
      optimizations: {
        cost: expect.any(Object),
        prompt: expect.any(Object),
      },
    });
  });

  it("returns an immutable StrategyDecision (Object.freeze)", async () => {
    const options = seededOptions();
    const pipeline = new DefaultStrategyPipeline(buildDefaultStages(options));
    const decision = await pipeline.run(baseRequest(), tenant());

    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.optimizations)).toBe(true);
    expect(() => {
      // @ts-expect-error deliberate mutation attempt for the immutability test
      decision.requiredCapabilities = null;
    }).toThrow();
  });

  it("freezes every nested object and array reachable from the decision, not just the top two levels (Review Finding 1)", async () => {
    const options = seededOptions();
    const pipeline = new DefaultStrategyPipeline(buildDefaultStages(options));
    const decision = await pipeline.run(baseRequest(), tenant());

    // Every plain object/array anywhere in the tree must itself be frozen —
    // not merely `decision` and `decision.optimizations` (the pre-Finding-1
    // shallow behavior).
    expect(Object.isFrozen(decision.requiredCapabilities)).toBe(true);
    expect(Object.isFrozen(decision.executionProfile)).toBe(true);
    expect(Object.isFrozen(decision.executionProfile.inference)).toBe(true);
    expect(Object.isFrozen(decision.executionProfile.retryPolicy)).toBe(true);
    expect(Object.isFrozen(decision.executionProfile.retryPolicy.retryableErrorCodes)).toBe(true);
    expect(Object.isFrozen(decision.executionProfile.streaming)).toBe(true);
    expect(Object.isFrozen(decision.executionProfile.structuredOutput)).toBe(true);
    expect(Object.isFrozen(decision.executionProfile.caching)).toBe(true);
    expect(Object.isFrozen(decision.executionProfile.preferredModelClasses)).toBe(true);
    expect(Object.isFrozen(decision.optimizations.cost)).toBe(true);
    expect(Object.isFrozen(decision.optimizations.prompt)).toBe(true);
    expect(Object.isFrozen(decision.optimizations.prompt.messages)).toBe(true);
    expect(Object.isFrozen(decision.optimizations.prompt.transformationsApplied)).toBe(true);
  });

  it("makes downstream mutation of nested fields impossible — every attempt throws (Review Finding 1)", async () => {
    const options = seededOptions();
    const pipeline = new DefaultStrategyPipeline(buildDefaultStages(options));
    const decision = await pipeline.run(baseRequest(), tenant());

    expect(() => {
      // @ts-expect-error deliberate mutation attempt
      decision.requiredCapabilities.toolCalling = true;
    }).toThrow();

    expect(() => {
      // @ts-expect-error deliberate mutation attempt
      decision.executionProfile.retryPolicy.maxAttempts = 99;
    }).toThrow();

    expect(() => {
      decision.executionProfile.retryPolicy.retryableErrorCodes.push("RATE_LIMITED");
    }).toThrow();

    expect(() => {
      // @ts-expect-error deliberate mutation attempt
      decision.executionProfile.preferredModelClasses[0] = "tampered";
    }).toThrow();

    expect(() => {
      // @ts-expect-error deliberate mutation attempt
      decision.optimizations.cost.estimatedCostUsd = -1;
    }).toThrow();

    expect(() => {
      decision.optimizations.prompt.messages.push({ role: "user", content: "injected" });
    }).toThrow();

    expect(() => {
      // @ts-expect-error deliberate mutation attempt
      decision.optimizations.prompt.transformationsApplied.push("normalized");
    }).toThrow();

    // The nested objects/arrays are unchanged by every attempt above.
    expect(decision.requiredCapabilities.toolCalling).not.toBe(true);
    expect(decision.executionProfile.retryPolicy.maxAttempts).not.toBe(99);
  });

  it("threads Prompt Optimization's estimatedTokens into Cost Optimization (architecture §33/§34 ordering)", async () => {
    const options = seededOptions();
    const pipeline = new DefaultStrategyPipeline(buildDefaultStages(options));
    const decision = await pipeline.run(
      baseRequest({ input: { text: "x".repeat(4_000) } }),
      tenant(),
    );

    expect(decision.optimizations.prompt.estimatedTokens).toBeGreaterThan(0);
    expect(decision.optimizations.cost.estimatedCostUsd).toBeGreaterThanOrEqual(0);
  });

  it("throws IncompleteStrategyDecisionError if a required stage is missing from a custom pipeline", async () => {
    const options = seededOptions();
    const allStages = buildDefaultStages(options);
    const missingCostStage = allStages.filter((s) => s.name !== "cost_optimization");
    const pipeline = new DefaultStrategyPipeline(missingCostStage);

    await expect(pipeline.run(baseRequest(), tenant())).rejects.toThrow(
      IncompleteStrategyDecisionError,
    );
  });

  it("throws IncompleteStrategyDecisionError naming the specific missing field, for each of the four required fields", async () => {
    const full = {
      requiredCapabilities: {
        structuredOutput: false,
        toolCalling: false,
        reasoningDepth: "shallow" as const,
        streamingPreferred: false,
        minContextTokens: 100,
      },
      executionProfile: {
        id: "summarization" as const,
        preferredModelClasses: ["fast-extraction"],
        inference: { temperature: 0.3, maxOutputTokens: 512 },
        timeoutMs: 20_000,
        retryPolicy: {
          maxAttempts: 3,
          backoff: "exponential" as const,
          baseDelayMs: 200,
          maxDelayMs: 4_000,
          jitter: true,
          retryableErrorCodes: [],
        },
        streaming: { defaultEnabled: false },
        structuredOutput: { defaultEnabled: false },
        caching: { defaultEnabled: false, keyStrategy: "exact" as const },
      },
      costOptimization: {
        reasoningRequired: false,
        preferFreeTierProviders: false,
        estimatedCostUsd: 0,
        estimatedSavingsUsd: 0,
      },
      optimizedPrompt: { messages: [], estimatedTokens: 1, transformationsApplied: [] },
    };

    // A single fake stage that sets every field the real pipeline needs
    // except the one under test, isolating `assembleDecision`'s own guard
    // from any individual stage's own precondition checks.
    async function pipelineMissingOnly(omit: keyof typeof full) {
      const { [omit]: _omitted, ...rest } = full;
      const fakeStage = {
        name: "fake",
        run: async (ctx: Parameters<StrategyPipelineStage["run"]>[0]) => ({ ...ctx, ...rest }),
      };
      return new DefaultStrategyPipeline([fakeStage]).run(baseRequest(), tenant());
    }

    await expect(pipelineMissingOnly("requiredCapabilities")).rejects.toThrow(
      /requiredCapabilities/,
    );
    await expect(pipelineMissingOnly("executionProfile")).rejects.toThrow(/executionProfile/);
    await expect(pipelineMissingOnly("costOptimization")).rejects.toThrow(/costOptimization/);
    await expect(pipelineMissingOnly("optimizedPrompt")).rejects.toThrow(/optimizedPrompt/);
  });

  it("is deterministic for an identical request (same task/tenant/input twice)", async () => {
    const options = seededOptions();
    const pipeline = new DefaultStrategyPipeline(buildDefaultStages(options));
    const req = baseRequest();
    const first = await pipeline.run(req, tenant());
    const second = await pipeline.run(req, tenant());

    expect(second.requiredCapabilities).toEqual(first.requiredCapabilities);
    expect(second.executionProfile).toEqual(first.executionProfile);
  });

  it("never references any concrete provider or model id anywhere in the decision (provider-agnostic)", async () => {
    const options = seededOptions();
    const pipeline = new DefaultStrategyPipeline(buildDefaultStages(options));
    const decision = await pipeline.run(baseRequest(), tenant());
    const serialized = JSON.stringify(decision).toLowerCase();

    for (const providerName of ["groq", "openai", "anthropic", "gemini", "nvidia"]) {
      expect(serialized).not.toContain(providerName);
    }
  });
});
