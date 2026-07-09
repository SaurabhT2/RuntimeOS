import { beforeEach, describe, expect, it } from "vitest";
import { isGatewayError, type ExecuteRequest } from "@ai-gateway/core-contracts";
import { DefaultModelRegistry, SEED_MODELS } from "@ai-gateway/model-registry";
import { DefaultHealthMonitor } from "@ai-gateway/reliability";
import { DefaultPolicyEngine } from "../src/policy-engine.js";

function baseRequest(overrides: Partial<ExecuteRequest> = {}): ExecuteRequest {
  return {
    task: "summarization",
    input: { text: "hello world" },
    tenant: { organizationId: "org-1" },
    ...overrides,
  };
}

describe("DefaultPolicyEngine", () => {
  let registry: DefaultModelRegistry;
  let healthMonitor: DefaultHealthMonitor;
  let engine: DefaultPolicyEngine;

  beforeEach(() => {
    registry = new DefaultModelRegistry({ seed: SEED_MODELS });
    healthMonitor = new DefaultHealthMonitor();
    engine = new DefaultPolicyEngine({ modelRegistry: registry, healthMonitor });
  });

  it("selects a primary plan and a non-empty, bounded fallback chain from seed data", async () => {
    const plan = await engine.selectExecutionPlan(baseRequest(), {});
    expect(plan.providerId).toBeTruthy();
    expect(plan.modelId).toBeTruthy();
    expect(plan.fallbackPlans.length).toBeGreaterThan(0);
    expect(plan.fallbackPlans.length).toBeLessThanOrEqual(2);
  });

  it("every fallback plan is itself a leaf (no nested fallbacks)", async () => {
    const plan = await engine.selectExecutionPlan(baseRequest(), {});
    for (const fallback of plan.fallbackPlans) {
      expect(fallback.fallbackPlans).toEqual([]);
    }
  });

  it("carries the request's retry policy default and streaming flag through to the plan", async () => {
    const plan = await engine.selectExecutionPlan(
      baseRequest({ constraints: { streaming: true } }),
      {},
    );
    expect(plan.streaming).toBe(true);
    expect(plan.retryPolicy.maxAttempts).toBe(2);
  });

  it("maps preferences.creativity to temperature", async () => {
    const low = await engine.selectExecutionPlan(
      baseRequest({ preferences: { creativity: "low" } }),
      {},
    );
    const high = await engine.selectExecutionPlan(
      baseRequest({ preferences: { creativity: "high" } }),
      {},
    );
    expect(low.temperature).toBeLessThan(high.temperature);
  });

  it("routes a json_generation task only to structured-output-capable models", async () => {
    const plan = await engine.selectExecutionPlan(baseRequest({ task: "json_generation" }), {});
    const model = await registry.getModel(plan.providerId, plan.modelId);
    expect(model?.capabilities.structuredOutput).toBe(true);
  });

  it("throws a non-retryable ALL_PROVIDERS_UNAVAILABLE GatewayError when no candidate satisfies the request", async () => {
    const req = baseRequest({ constraints: { minContextTokens: 10_000_000 } });
    await expect(engine.selectExecutionPlan(req, {})).rejects.toSatisfy(
      (error: unknown) =>
        isGatewayError(error) && error.code === "ALL_PROVIDERS_UNAVAILABLE" && !error.retryable,
    );
  });

  it("prefers a healthy provider's models over an unhealthy provider's, all else equal", async () => {
    healthMonitor.reportFailure("groq", { code: "TIMEOUT" });
    healthMonitor.reportFailure("groq", { code: "TIMEOUT" });
    healthMonitor.reportFailure("groq", { code: "TIMEOUT" });
    healthMonitor.reportFailure("groq", { code: "TIMEOUT" });
    healthMonitor.reportSuccess("nvidia-nim", { latencyMs: 200 });

    const engineWithHealthWeight = new DefaultPolicyEngine({
      modelRegistry: registry,
      healthMonitor,
      config: { weights: { quality: 0, latency: 0, cost: 0, health: 1 } },
    });

    const plan = await engineWithHealthWeight.selectExecutionPlan(baseRequest(), {});
    expect(plan.providerId).toBe("nvidia-nim");
  });

  it("respects a PolicyContext routingOverride.preferredProviders soft preference", async () => {
    const plan = await engine.selectExecutionPlan(baseRequest(), {
      routingOverride: { preferredProviders: ["nvidia-nim"] },
    });
    expect(plan.providerId).toBe("nvidia-nim");
  });

  it("applies preferences.prioritize=cost by routing toward the cheaper (free-tier) provider", async () => {
    const plan = await engine.selectExecutionPlan(
      baseRequest({ preferences: { prioritize: "cost" } }),
      {},
    );
    const model = await registry.getModel(plan.providerId, plan.modelId);
    expect(model?.cost.tier).toBe("free");
  });

  it("honors constraints.maxLatencyMs as the plan's timeoutMs", async () => {
    const plan = await engine.selectExecutionPlan(
      baseRequest({ constraints: { maxLatencyMs: 3000 } }),
      {},
    );
    expect(plan.timeoutMs).toBe(3000);
  });

  it("is deterministic: the same request against the same registry state produces the same plan", async () => {
    const req = baseRequest();
    const first = await engine.selectExecutionPlan(req, {});
    const second = await engine.selectExecutionPlan(req, {});
    expect(first).toEqual(second);
  });

  it("respects custom weights passed at construction", async () => {
    const qualityFirst = new DefaultPolicyEngine({
      modelRegistry: registry,
      healthMonitor,
      config: { weights: { quality: 1, latency: 0, cost: 0, health: 0 } },
    });
    const plan = await qualityFirst.selectExecutionPlan(
      baseRequest({ task: "complex_reasoning" }),
      {},
    );
    const model = await registry.getModel(plan.providerId, plan.modelId);
    expect(model?.capabilities.reasoningDepth).toBe("deep");
  });
});
