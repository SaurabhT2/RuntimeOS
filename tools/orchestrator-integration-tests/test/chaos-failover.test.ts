import { describe, expect, it } from "vitest";
import type { ExecuteRequest } from "@ai-gateway/core-contracts";
import {
  DefaultExecutionOrchestrator,
  InMemoryProviderAdapterRegistry,
} from "@ai-gateway/orchestrator";
import {
  DefaultHealthMonitor,
  DefaultRetryEngine,
  InMemoryCircuitBreaker,
} from "@ai-gateway/reliability";
import { DefaultStreamManager } from "@ai-gateway/streaming";
import { GroqAdapter, TokenBucketRateLimiter } from "@ai-gateway/groq";
import { NimAdapter } from "@ai-gateway/nvidia-nim";
import {
  buildCredentialResolver,
  buildPolicyEngine,
  fakeTelemetry,
  jsonFetch,
  successBody,
  throwingFetch,
} from "./fixtures.js";

/**
 * The Engineering Blueprint's EM-4 section names this specific scenario as
 * a required test: "a chaos test injecting Groq failures to verify
 * automatic failover" — and separately requires "end-to-end integration
 * tests against... recorded-fixture real adapters". This file is both:
 * the two `ProviderAdapter`s wired into the real `ExecutionOrchestrator`
 * below are the real `GroqAdapter` and `NimAdapter` (Engineering
 * Milestone EM-3), each driven only by a scripted `fetchImpl` — no live
 * network call is made (matching `groq`'s and `nvidia-nim`'s own
 * documented testing strategy of recorded fixtures, never live calls, in
 * CI).
 *
 * See `full-lifecycle.test.ts` in this same directory for why this test
 * lives in `tools/` rather than `packages/orchestrator/test/`.
 */

const tenant = { organizationId: "org-chaos", workspaceId: "ws-chaos" };

function req(overrides: Partial<ExecuteRequest> = {}): ExecuteRequest {
  return {
    task: "summarization",
    input: { text: "Summarize the incident report." },
    tenant,
    ...overrides,
  };
}

async function buildOrchestrator(groq: GroqAdapter, nim: NimAdapter) {
  return new DefaultExecutionOrchestrator({
    policyEngine: buildPolicyEngine(),
    credentialResolver: await buildCredentialResolver(
      { groq: "sk-groq-real", "nvidia-nim": "sk-nim-real" },
      tenant,
    ),
    retryEngine: new DefaultRetryEngine({ sleep: async () => {} }),
    circuitBreaker: new InMemoryCircuitBreaker(),
    healthMonitor: new DefaultHealthMonitor(),
    streamManager: new DefaultStreamManager(),
    adapterRegistry: new InMemoryProviderAdapterRegistry([groq, nim]),
    telemetry: fakeTelemetry(),
  });
}

describe("EM-4 chaos test — real GroqAdapter + real NimAdapter", () => {
  it("baseline: a healthy Groq serves the request directly, with zero failover", async () => {
    const groq = new GroqAdapter({
      fetchImpl: jsonFetch(successBody("Groq answer")),
      rateLimiter: new TokenBucketRateLimiter({}),
    });
    const nim = new NimAdapter({ fetchImpl: jsonFetch(successBody("NIM answer")) });
    const orchestrator = await buildOrchestrator(groq, nim);

    const response = await orchestrator.execute(req());

    expect(response.execution.providerId).toBe("groq");
    expect(response.execution.failedOver).toBe(false);
    expect(response.output.text).toBe("Groq answer");
  });

  it("chaos: Groq's network is down (fetch throws) — automatic failover to NVIDIA NIM, zero client-visible errors", async () => {
    const groq = new GroqAdapter({
      fetchImpl: throwingFetch("ECONNREFUSED: groq is down"),
      rateLimiter: new TokenBucketRateLimiter({}),
    });
    const nim = new NimAdapter({ fetchImpl: jsonFetch(successBody("NIM answer")) });
    const orchestrator = await buildOrchestrator(groq, nim);

    const response = await orchestrator.execute(req());

    expect(response.execution.providerId).toBe("nvidia-nim");
    expect(response.execution.failedOver).toBe(true);
    expect(response.output.text).toBe("NIM answer");
  });

  it("chaos: Groq returns HTTP 429 on every attempt — retries exhaust, then fails over to NVIDIA NIM", async () => {
    const groq = new GroqAdapter({
      fetchImpl: jsonFetch({ error: { message: "rate limited" } }, 429),
      rateLimiter: new TokenBucketRateLimiter({}),
    });
    const nim = new NimAdapter({ fetchImpl: jsonFetch(successBody("NIM answer")) });
    const orchestrator = await buildOrchestrator(groq, nim);

    const response = await orchestrator.execute(req());

    expect(response.execution.providerId).toBe("nvidia-nim");
    expect(response.execution.failedOver).toBe(true);
  });

  it("chaos: both providers are down — the caller receives a typed ALL_PROVIDERS_UNAVAILABLE, never a raw crash", async () => {
    const groq = new GroqAdapter({
      fetchImpl: throwingFetch("groq down"),
      rateLimiter: new TokenBucketRateLimiter({}),
    });
    const nim = new NimAdapter({ fetchImpl: throwingFetch("nim down") });
    const orchestrator = await buildOrchestrator(groq, nim);

    await expect(orchestrator.execute(req())).rejects.toMatchObject({
      code: "ALL_PROVIDERS_UNAVAILABLE",
    });
  });

  it("chaos: both providers are down for a streaming request — the caller receives a typed GatewayError, never a raw crash", async () => {
    const groq = new GroqAdapter({
      fetchImpl: throwingFetch("groq down"),
      rateLimiter: new TokenBucketRateLimiter({}),
    });
    const nim = new NimAdapter({ fetchImpl: throwingFetch("nim down") });
    const orchestrator = await buildOrchestrator(groq, nim);

    await expect(async () => {
      for await (const _chunk of orchestrator.executeStream(req())) {
        // Draining is enough — the assertion is on what the iterator
        // eventually rejects with, not on any chunk content.
      }
    }).rejects.toSatisfy((error: unknown) => error instanceof Error && "code" in error);
  });
});
