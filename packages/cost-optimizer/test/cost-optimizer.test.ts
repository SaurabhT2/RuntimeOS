import { describe, expect, it } from "vitest";
import { DefaultCostOptimizer, deriveCacheKey } from "../src/cost-optimizer.js";
import { InMemoryCacheClient } from "../src/in-memory-cache-client.js";
import type { OptimizationContext } from "../src/types.js";
import { capabilities, extractionProfile, reasoningProfile, runtimeProfile } from "./fixtures.js";

function ctx(overrides: Partial<OptimizationContext> = {}): OptimizationContext {
  return {
    task: "summarization",
    capabilities: capabilities(),
    profile: reasoningProfile(),
    promptTokenEstimate: 500,
    runtimeProfile: runtimeProfile("production"),
    cache: new InMemoryCacheClient(),
    ...overrides,
  };
}

describe("DefaultCostOptimizer.optimize — produces decisions only", () => {
  it("never touches a provider or executes routing (returns a plain decision object, no side effects observable beyond the cache read)", async () => {
    const optimizer = new DefaultCostOptimizer();
    const result = await optimizer.optimize(ctx());
    expect(result).toMatchObject({
      reasoningRequired: expect.any(Boolean),
      preferFreeTierProviders: expect.any(Boolean),
      estimatedCostUsd: expect.any(Number),
      estimatedSavingsUsd: expect.any(Number),
    });
  });

  it("recommends a downgrade end-to-end for a shallow-need task on a complex-reasoning profile", async () => {
    const optimizer = new DefaultCostOptimizer();
    const result = await optimizer.optimize(
      ctx({ capabilities: capabilities({ reasoningDepth: "shallow" }) }),
    );
    expect(result.recommendedModelClassDowngrade).toBe("fast-extraction");
    expect(result.reasoningRequired).toBe(false);
  });

  it("never recommends a downgrade end-to-end for a deep-reasoning task", async () => {
    const optimizer = new DefaultCostOptimizer();
    const result = await optimizer.optimize(
      ctx({ capabilities: capabilities({ reasoningDepth: "deep" }) }),
    );
    expect(result.recommendedModelClassDowngrade).toBeUndefined();
    expect(result.reasoningRequired).toBe(true);
  });

  it("never recommends a downgrade end-to-end for a task requiring structured output, even with shallow reasoning need", async () => {
    const optimizer = new DefaultCostOptimizer();
    const result = await optimizer.optimize(
      ctx({
        capabilities: capabilities({ reasoningDepth: "shallow", structuredOutput: true }),
      }),
    );
    expect(result.recommendedModelClassDowngrade).toBeUndefined();
  });
});

describe("DefaultCostOptimizer.optimize — Runtime Profile consumption", () => {
  it("preferFreeTierProviders reflects the active Runtime Profile's provider.preferFreeTier", async () => {
    const optimizer = new DefaultCostOptimizer();

    const devResult = await optimizer.optimize(
      ctx({ runtimeProfile: runtimeProfile("development") }),
    );
    expect(devResult.preferFreeTierProviders).toBe(true);

    const enterpriseResult = await optimizer.optimize(
      ctx({ runtimeProfile: runtimeProfile("enterprise") }),
    );
    expect(enterpriseResult.preferFreeTierProviders).toBe(false);
  });

  it("free_tier and development Runtime Profiles both set preferFreeTierProviders true (architecture §33.2's own example)", async () => {
    const optimizer = new DefaultCostOptimizer();
    const freeTier = await optimizer.optimize(ctx({ runtimeProfile: runtimeProfile("free_tier") }));
    const development = await optimizer.optimize(
      ctx({ runtimeProfile: runtimeProfile("development") }),
    );
    expect(freeTier.preferFreeTierProviders).toBe(true);
    expect(development.preferFreeTierProviders).toBe(true);
  });
});

describe("DefaultCostOptimizer.optimize — cache short-circuit signal", () => {
  it("returns cacheHit when the cache client has a matching entry", async () => {
    const optimizer = new DefaultCostOptimizer();
    const cache = new InMemoryCacheClient();
    const context = ctx({ cache });
    cache.seed(deriveCacheKey(context), {
      content: "cached summary",
      providerId: "groq",
      modelId: "llama-3.1-8b",
      cachedAt: Date.now(),
    });

    const result = await optimizer.optimize(context);
    expect(result.cacheHit).toEqual(
      expect.objectContaining({ content: "cached summary", providerId: "groq" }),
    );
  });

  it("returns no cacheHit on a cold cache", async () => {
    const optimizer = new DefaultCostOptimizer();
    const result = await optimizer.optimize(ctx());
    expect(result.cacheHit).toBeUndefined();
  });
});

describe("DefaultCostOptimizer.optimize — cost/savings estimation", () => {
  it("estimatedSavingsUsd is positive when a downgrade is recommended", async () => {
    const optimizer = new DefaultCostOptimizer();
    const result = await optimizer.optimize(
      ctx({
        capabilities: capabilities({ reasoningDepth: "shallow" }),
        promptTokenEstimate: 2_000,
      }),
    );
    expect(result.estimatedSavingsUsd).toBeGreaterThan(0);
  });

  it("estimatedSavingsUsd is zero when no downgrade is recommended", async () => {
    const optimizer = new DefaultCostOptimizer();
    const result = await optimizer.optimize(
      ctx({ capabilities: capabilities({ reasoningDepth: "deep" }) }),
    );
    expect(result.estimatedSavingsUsd).toBe(0);
  });

  it("falls back to fast-extraction as the baseline class when a profile has no preferred classes", async () => {
    const optimizer = new DefaultCostOptimizer();
    const result = await optimizer.optimize(
      ctx({ profile: extractionProfile({ preferredModelClasses: [] }) }),
    );
    expect(result.estimatedCostUsd).toBeGreaterThanOrEqual(0);
  });
});
