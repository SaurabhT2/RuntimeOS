import { describe, expect, it } from "vitest";
import { PromptOptimizationStage } from "../../src/stages/prompt-optimization-stage.js";
import { baseRequest, seededOptions, tenant } from "../fixtures.js";

const RESOLVED_PROFILE = {
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
};

describe("PromptOptimizationStage", () => {
  it("throws if executionProfile has not been resolved yet", async () => {
    const options = seededOptions();
    const stage = new PromptOptimizationStage(options.promptOptimizer);
    await expect(
      stage.run({ request: baseRequest(), tenant: tenant(), requiredCapabilities: undefined }),
    ).rejects.toThrow(/executionProfile/);
  });

  it("throws if requiredCapabilities has not been resolved yet", async () => {
    const options = seededOptions();
    const stage = new PromptOptimizationStage(options.promptOptimizer);
    await expect(
      stage.run({ request: baseRequest(), tenant: tenant(), executionProfile: RESOLVED_PROFILE }),
    ).rejects.toThrow(/requiredCapabilities/);
  });

  it("resolves optimizedPrompt from the request's text input", async () => {
    const options = seededOptions();
    const stage = new PromptOptimizationStage(options.promptOptimizer);
    const result = await stage.run({
      request: baseRequest(),
      tenant: tenant(),
      executionProfile: RESOLVED_PROFILE,
      requiredCapabilities: {
        structuredOutput: false,
        toolCalling: false,
        reasoningDepth: "shallow",
        streamingPreferred: false,
        minContextTokens: 4_000,
      },
    });
    expect(result.optimizedPrompt).toBeDefined();
    expect(result.optimizedPrompt?.messages.length).toBeGreaterThan(0);
  });

  it("bypasses compression for the coding profile", async () => {
    const options = seededOptions();
    const stage = new PromptOptimizationStage(options.promptOptimizer);
    const result = await stage.run({
      request: baseRequest({ input: { text: "please just kindly refactor this" } }),
      tenant: tenant(),
      executionProfile: { ...RESOLVED_PROFILE, id: "coding" },
      requiredCapabilities: {
        structuredOutput: false,
        toolCalling: false,
        reasoningDepth: "shallow",
        streamingPreferred: false,
        minContextTokens: 4_000,
      },
    });
    expect(result.optimizedPrompt?.transformationsApplied).not.toContain("compressed");
  });
});
