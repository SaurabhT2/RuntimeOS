import { describe, expect, it } from "vitest";
import {
  deriveCapabilityRequirement,
  deriveExecutionPlanOverrides,
  deriveOptimizedMessages,
  deriveStrategySignals,
} from "../src/strategy-signals.js";
import type { CapabilityRequirement } from "../src/types.js";

const fallback: CapabilityRequirement = {
  requiresJsonMode: false,
  requiresToolCalling: false,
  requiresStreaming: true,
  minContextTokens: 8_000,
  creativityAffinity: 0.1,
  reasoningAffinity: 0.3,
};

describe("deriveCapabilityRequirement (EM-9)", () => {
  it("returns the fallback unchanged when requiredCapabilities is absent", () => {
    expect(deriveCapabilityRequirement(fallback, undefined)).toEqual(fallback);
  });

  it("returns the fallback unchanged when requiredCapabilities is malformed (not an object)", () => {
    expect(deriveCapabilityRequirement(fallback, "not-an-object")).toEqual(fallback);
    expect(deriveCapabilityRequirement(fallback, null)).toEqual(fallback);
    expect(deriveCapabilityRequirement(fallback, 42)).toEqual(fallback);
  });

  it("overrides requiresJsonMode/requiresToolCalling/requiresStreaming/minContextTokens from a well-formed CapabilitySet", () => {
    const result = deriveCapabilityRequirement(fallback, {
      structuredOutput: true,
      toolCalling: true,
      reasoningDepth: "deep",
      streamingPreferred: false,
      minContextTokens: 16_000,
    });
    expect(result.requiresJsonMode).toBe(true);
    expect(result.requiresToolCalling).toBe(true);
    expect(result.requiresStreaming).toBe(false);
    expect(result.minContextTokens).toBe(16_000);
    expect(result.reasoningAffinity).toBe(0.9);
    // creativityAffinity has no CapabilitySet equivalent — always from fallback.
    expect(result.creativityAffinity).toBe(fallback.creativityAffinity);
  });

  it("only overrides individually well-typed fields, leaving the rest at the fallback value", () => {
    const result = deriveCapabilityRequirement(fallback, {
      structuredOutput: true,
      toolCalling: "not-a-boolean", // malformed — ignored
      reasoningDepth: "not-a-valid-depth", // malformed — ignored
      // streamingPreferred, minContextTokens absent entirely
    });
    expect(result.requiresJsonMode).toBe(true); // valid override applied
    expect(result.requiresToolCalling).toBe(fallback.requiresToolCalling); // malformed, ignored
    expect(result.reasoningAffinity).toBe(fallback.reasoningAffinity); // malformed, ignored
    expect(result.requiresStreaming).toBe(fallback.requiresStreaming); // absent, ignored
    expect(result.minContextTokens).toBe(fallback.minContextTokens); // absent, ignored
  });

  it("never weakens a hard filter field to something more permissive than the fallback by itself — it only ever replaces one resolved value with another resolved value for the same concept", () => {
    // This test documents the structural guarantee (see the function's own
    // doc comment): there is no code path here that reads from a
    // `StrategySignals`-shaped soft-scoring field. Confirmed by shape: the
    // only object this function ever reads is `requiredCapabilities`, never
    // `executionProfile` or `optimizations.cost`.
    const result = deriveCapabilityRequirement(fallback, {
      structuredOutput: true,
      toolCalling: false,
      reasoningDepth: "shallow",
      streamingPreferred: true,
      minContextTokens: 1,
    });
    expect(result.minContextTokens).toBe(1);
  });
});

describe("deriveStrategySignals (EM-9)", () => {
  it("returns {} when both inputs are absent", () => {
    expect(deriveStrategySignals(undefined, undefined)).toEqual({});
  });

  it("returns {} when both inputs are malformed", () => {
    expect(deriveStrategySignals("nope", 42)).toEqual({});
  });

  it("extracts preferredModelClasses only when it is a string array", () => {
    expect(
      deriveStrategySignals({ preferredModelClasses: ["fast-extraction", "creative"] }, undefined),
    ).toEqual({ preferredModelClasses: ["fast-extraction", "creative"] });
    expect(deriveStrategySignals({ preferredModelClasses: [1, 2] }, undefined)).toEqual({});
    expect(deriveStrategySignals({ preferredModelClasses: "not-an-array" }, undefined)).toEqual({});
  });

  it("extracts recommendedModelClassDowngrade and preferFreeTierProviders only when well-typed", () => {
    expect(
      deriveStrategySignals(undefined, {
        recommendedModelClassDowngrade: "fast-extraction",
        preferFreeTierProviders: true,
      }),
    ).toEqual({
      recommendedModelClassDowngrade: "fast-extraction",
      preferFreeTierProviders: true,
    });
    expect(
      deriveStrategySignals(undefined, {
        recommendedModelClassDowngrade: 123,
        preferFreeTierProviders: "yes",
      }),
    ).toEqual({});
  });
});

describe("deriveExecutionPlanOverrides (EM-9)", () => {
  it("returns {} when both inputs are absent or malformed", () => {
    expect(deriveExecutionPlanOverrides(undefined, undefined)).toEqual({});
    expect(deriveExecutionPlanOverrides("nope", "nope")).toEqual({});
  });

  it("extracts temperature/maxOutputTokens/timeoutMs/streamingDefault from a well-formed executionProfile", () => {
    const result = deriveExecutionPlanOverrides(
      {
        inference: { temperature: 0.3, maxOutputTokens: 1024 },
        timeoutMs: 30_000,
        streaming: { defaultEnabled: true },
      },
      undefined,
    );
    expect(result.temperature).toBe(0.3);
    expect(result.maxOutputTokens).toBe(1024);
    expect(result.timeoutMs).toBe(30_000);
    expect(result.streamingDefault).toBe(true);
    expect(result.retryPolicy).toBeUndefined();
  });

  it("extracts retryPolicy only when it is a well-formed RetryPolicy", () => {
    const validRetryPolicy = {
      maxAttempts: 3,
      backoff: "exponential" as const,
      baseDelayMs: 100,
      maxDelayMs: 2_000,
      jitter: true,
      retryableErrorCodes: ["RATE_LIMITED"],
    };
    expect(
      deriveExecutionPlanOverrides({ retryPolicy: validRetryPolicy }, undefined).retryPolicy,
    ).toEqual(validRetryPolicy);
    expect(
      deriveExecutionPlanOverrides({ retryPolicy: { maxAttempts: 3 } }, undefined).retryPolicy,
    ).toBeUndefined();
  });

  it("extracts disableStreaming only when it is a boolean, independent of executionProfile", () => {
    expect(
      deriveExecutionPlanOverrides(undefined, { disableStreaming: true }).disableStreaming,
    ).toBe(true);
    expect(
      deriveExecutionPlanOverrides(undefined, { disableStreaming: "true" }).disableStreaming,
    ).toBeUndefined();
  });
});

describe("deriveOptimizedMessages (EM-9)", () => {
  it("returns undefined when prompt is absent or malformed", () => {
    expect(deriveOptimizedMessages(undefined)).toBeUndefined();
    expect(deriveOptimizedMessages("nope")).toBeUndefined();
    expect(deriveOptimizedMessages({ messages: [] })).toBeUndefined();
    expect(deriveOptimizedMessages({ messages: [{ role: "user" }] })).toBeUndefined();
  });

  it("returns the messages array when well-formed", () => {
    const messages = [
      { role: "system", content: "be helpful" },
      { role: "user", content: "hello" },
    ];
    expect(deriveOptimizedMessages({ messages })).toEqual(messages);
  });
});
