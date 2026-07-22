import type { ExecuteRequest } from "@ai-gateway/core-contracts";
import {
  DefaultHealthMonitor,
  DefaultRetryEngine,
  InMemoryCircuitBreaker,
} from "@ai-gateway/reliability";
import type { AIStrategyLayer, StrategyDecision, TenantContext } from "@ai-gateway/strategy-layer";
import { DefaultStreamManager } from "@ai-gateway/streaming";
import { describe, expect, it, vi } from "vitest";
import {
  DefaultExecutionOrchestrator,
  type ExecutionOrchestratorOptions,
} from "../src/orchestrator.js";
import { InMemoryProviderAdapterRegistry } from "../src/types.js";
import {
  baseRequest,
  fakeAdapter,
  fakeCredentialResolver,
  fakePolicyEngine,
  fakeTelemetry,
  plan,
} from "./fixtures.js";

function retryEngine(): DefaultRetryEngine {
  return new DefaultRetryEngine({ sleep: async () => {} });
}

function buildOrchestrator(
  overrides: Partial<ExecutionOrchestratorOptions> = {},
): DefaultExecutionOrchestrator {
  return new DefaultExecutionOrchestrator({
    policyEngine: fakePolicyEngine(plan()),
    credentialResolver: fakeCredentialResolver({ groq: "gk", "nvidia-nim": "nk" }),
    retryEngine: retryEngine(),
    circuitBreaker: new InMemoryCircuitBreaker(),
    healthMonitor: new DefaultHealthMonitor(),
    streamManager: new DefaultStreamManager(),
    adapterRegistry: new InMemoryProviderAdapterRegistry([fakeAdapter("groq")]),
    telemetry: fakeTelemetry(),
    now: () => 0,
    generateRequestId: () => "gen-id",
    ...overrides,
  });
}

function fakeDecision(overrides: Partial<StrategyDecision> = {}): StrategyDecision {
  return {
    requiredCapabilities: {
      structuredOutput: false,
      toolCalling: false,
      reasoningDepth: "shallow",
      streamingPreferred: false,
      minContextTokens: 4_000,
    },
    executionProfile: {
      id: "summarization",
      preferredModelClasses: ["fast-extraction"],
      inference: { temperature: 0.3, maxOutputTokens: 512 },
      timeoutMs: 20_000,
      retryPolicy: {
        maxAttempts: 3,
        backoff: "exponential",
        baseDelayMs: 200,
        maxDelayMs: 4_000,
        jitter: true,
        retryableErrorCodes: [],
      },
      streaming: { defaultEnabled: false },
      structuredOutput: { defaultEnabled: false },
      caching: { defaultEnabled: false, keyStrategy: "exact" },
    },
    optimizations: {
      cost: {
        reasoningRequired: false,
        preferFreeTierProviders: false,
        estimatedCostUsd: 0.01,
        estimatedSavingsUsd: 0,
      },
      prompt: { messages: [], estimatedTokens: 10, transformationsApplied: [] },
    },
    ...overrides,
  };
}

/** A scripted `AIStrategyLayer` test double — never calls a real registry/optimizer. */
function fakeStrategyLayer(
  decision: StrategyDecision,
): AIStrategyLayer & { calls: ExecuteRequest[] } {
  const calls: ExecuteRequest[] = [];
  return {
    calls,
    buildStrategy: vi.fn(async (req: ExecuteRequest, _ctx: TenantContext) => {
      calls.push(req);
      return decision;
    }),
  };
}

describe("Feature flag: strategyLayer absent (default) — EM-7 behavior, unchanged", () => {
  it("never threads a strategyDecision into PolicyContext when no strategyLayer is injected", async () => {
    const policyEngine = fakePolicyEngine(plan());
    const orchestrator = buildOrchestrator({ policyEngine });
    await orchestrator.execute(baseRequest());
    const [, ctx] = vi.mocked(policyEngine.selectExecutionPlan).mock.calls[0]!;
    expect(ctx.strategyDecision).toBeUndefined();
  });
});

describe("Feature flag: strategyLayer present — Strategy Layer participates in every request", () => {
  it("calls strategyLayer.buildStrategy for every execute() call", async () => {
    const strategyLayer = fakeStrategyLayer(fakeDecision());
    const orchestrator = buildOrchestrator({ strategyLayer });
    await orchestrator.execute(baseRequest());
    expect(strategyLayer.calls).toHaveLength(1);
  });

  it("threads the resulting StrategyDecision into PolicyContext.strategyDecision", async () => {
    const decision = fakeDecision();
    const strategyLayer = fakeStrategyLayer(decision);
    const policyEngine = fakePolicyEngine(plan());
    const orchestrator = buildOrchestrator({ strategyLayer, policyEngine });
    await orchestrator.execute(baseRequest());
    const [, ctx] = vi.mocked(policyEngine.selectExecutionPlan).mock.calls[0]!;
    expect(ctx.strategyDecision).toEqual(decision);
  });
});

describe("Pass-through Regression (EM-8's most important test): Strategy OFF vs ON produce an identical ExecutionPlan/response", () => {
  it("produces a byte-for-byte identical ExecuteResponse whether the Strategy Layer ran or not, for the same underlying plan", async () => {
    const req = baseRequest();

    const offOrchestrator = buildOrchestrator();
    const resultOff = await offOrchestrator.execute(req);

    const strategyLayer = fakeStrategyLayer(fakeDecision());
    const onOrchestrator = buildOrchestrator({ strategyLayer });
    const resultOn = await onOrchestrator.execute(req);

    expect(resultOn).toEqual(resultOff);
  });

  it("calls policyEngine.selectExecutionPlan with the identical, unmodified ExecuteRequest in both configurations", async () => {
    const req = baseRequest();

    const offPolicyEngine = fakePolicyEngine(plan());
    await buildOrchestrator({ policyEngine: offPolicyEngine }).execute(req);
    const [offReq] = vi.mocked(offPolicyEngine.selectExecutionPlan).mock.calls[0]!;

    const onPolicyEngine = fakePolicyEngine(plan());
    const strategyLayer = fakeStrategyLayer(fakeDecision());
    await buildOrchestrator({ policyEngine: onPolicyEngine, strategyLayer }).execute(req);
    const [onReq] = vi.mocked(onPolicyEngine.selectExecutionPlan).mock.calls[0]!;

    expect(onReq).toEqual(offReq);
  });
});

describe("Strategy Layer cacheHit — short-circuits Policy Engine and the provider entirely (architecture §30.3/§33.4)", () => {
  it("never calls policyEngine.selectExecutionPlan when a cacheHit is present", async () => {
    const policyEngine = fakePolicyEngine(plan());
    const strategyLayer = fakeStrategyLayer(
      fakeDecision({ cacheHit: { content: "cached answer", cachedAt: 0 } }),
    );
    const orchestrator = buildOrchestrator({ policyEngine, strategyLayer });
    await orchestrator.execute(baseRequest());
    expect(policyEngine.selectExecutionPlan).not.toHaveBeenCalled();
  });

  it("returns the cached content as the response output", async () => {
    const strategyLayer = fakeStrategyLayer(
      fakeDecision({ cacheHit: { content: "cached answer", cachedAt: 0 } }),
    );
    const orchestrator = buildOrchestrator({ strategyLayer });
    const response = await orchestrator.execute(baseRequest());
    expect(response.output.text).toBe("cached answer");
    expect(response.execution.retries).toBe(0);
    expect(response.execution.failedOver).toBe(false);
    expect(response.usage.estimatedCostUsd).toBe(0);
  });

  it("never invokes any provider adapter on a cache hit", async () => {
    const invokeSpy = vi.fn(async () => ({
      text: "should never be called",
      usage: { inputTokens: 1, outputTokens: 1 },
      finishReason: "stop" as const,
    }));
    const adapterRegistry = new InMemoryProviderAdapterRegistry([
      fakeAdapter("groq", { onInvoke: invokeSpy }),
    ]);
    const strategyLayer = fakeStrategyLayer(
      fakeDecision({ cacheHit: { content: "cached answer", cachedAt: 0 } }),
    );
    const orchestrator = buildOrchestrator({ strategyLayer, adapterRegistry });
    await orchestrator.execute(baseRequest());
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it("executeStream yields a single, already-done chunk with the cached content on a cache hit", async () => {
    const strategyLayer = fakeStrategyLayer(
      fakeDecision({ cacheHit: { content: "cached streamed answer", cachedAt: 0 } }),
    );
    const orchestrator = buildOrchestrator({ strategyLayer });
    const chunks = [];
    for await (const chunk of orchestrator.executeStream(baseRequest())) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      delta: { text: "cached streamed answer" },
      done: true,
      finishReason: "stop",
    });
  });

  it("does not short-circuit when the StrategyDecision has no cacheHit", async () => {
    const policyEngine = fakePolicyEngine(plan());
    const strategyLayer = fakeStrategyLayer(fakeDecision()); // no cacheHit
    const orchestrator = buildOrchestrator({ policyEngine, strategyLayer });
    await orchestrator.execute(baseRequest());
    expect(policyEngine.selectExecutionPlan).toHaveBeenCalledTimes(1);
  });
});

describe("EM-9 (Independent Architecture & Engineering Review of EM-9): Active Strategy — optimized prompt reaches the provider adapter", () => {
  it("sends the StrategyDecision's optimized prompt messages to the provider adapter, not the request's original text (architecture §34.5)", async () => {
    const optimizedMessages = [
      { role: "system" as const, content: "condensed, optimized instructions" },
      { role: "user" as const, content: "condensed user turn" },
    ];
    const decision = fakeDecision({
      optimizations: {
        cost: {
          reasoningRequired: false,
          preferFreeTierProviders: false,
          estimatedCostUsd: 0.01,
          estimatedSavingsUsd: 0,
        },
        prompt: {
          messages: optimizedMessages,
          estimatedTokens: 6,
          transformationsApplied: ["condense"],
        },
      },
    });
    const strategyLayer = fakeStrategyLayer(decision);
    const invokeSpy = vi.fn(async () => ({
      text: "ok",
      usage: { inputTokens: 1, outputTokens: 1 },
      finishReason: "stop" as const,
    }));
    const adapterRegistry = new InMemoryProviderAdapterRegistry([
      fakeAdapter("groq", { onInvoke: invokeSpy }),
    ]);
    const orchestrator = buildOrchestrator({ strategyLayer, adapterRegistry });

    await orchestrator.execute(baseRequest({ input: { text: "original, unoptimized text" } }));

    expect(invokeSpy).toHaveBeenCalledTimes(1);
    const [invocation] = invokeSpy.mock.calls[0]!;
    expect(invocation.messages).toEqual(optimizedMessages);
  });

  it("falls back to the request's original text when the Strategy Layer is disabled (no strategyLayer injected)", async () => {
    const invokeSpy = vi.fn(async () => ({
      text: "ok",
      usage: { inputTokens: 1, outputTokens: 1 },
      finishReason: "stop" as const,
    }));
    const adapterRegistry = new InMemoryProviderAdapterRegistry([
      fakeAdapter("groq", { onInvoke: invokeSpy }),
    ]);
    const orchestrator = buildOrchestrator({ adapterRegistry });

    await orchestrator.execute(baseRequest({ input: { text: "original text" } }));

    const [invocation] = invokeSpy.mock.calls[0]!;
    expect(invocation.messages).toEqual([{ role: "user", content: "original text" }]);
  });
});
