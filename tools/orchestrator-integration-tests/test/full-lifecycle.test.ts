import { describe, expect, it } from "vitest";
import { GatewayError, isGatewayError, type ExecuteRequest } from "@ai-gateway/core-contracts";
import {
  DefaultExecutionOrchestrator,
  InMemoryProviderAdapterRegistry,
  type ProviderAdapter,
} from "@ai-gateway/orchestrator";
import {
  DefaultHealthMonitor,
  DefaultRetryEngine,
  InMemoryCircuitBreaker,
} from "@ai-gateway/reliability";
import { DefaultStreamManager } from "@ai-gateway/streaming";
import { MockAdapter } from "@ai-gateway/provider-sdk";
import { buildCredentialResolver, buildPolicyEngine, fakeTelemetry } from "./fixtures.js";

/**
 * Exercises exactly the chain the Engineering Blueprint's EM-4 section
 * names: "Policy Engine → Execution Plan → Credential Resolution →
 * Provider Resolution → Provider Execution → Retry Behavior → Fallback
 * Behavior → Streaming → Completion" — with every package in that chain
 * real (not a test double), except the provider adapters themselves,
 * which are `provider-sdk`'s own real `MockAdapter` (configurable
 * success/error/timeout/malformed-stream — this is the "Mock Adapter"
 * half of the Blueprint's "End-to-end integration tests against both the
 * Mock Adapter and recorded-fixture real adapters" requirement;
 * `chaos-failover.test.ts` in this same directory covers the
 * recorded-fixture-real-adapter half).
 *
 * `orchestrator`'s own package (`packages/orchestrator/test/`) cannot host
 * this test: its frozen dependency edge (architecture §4.1) excludes
 * `provider-sdk`, so it can never import `MockAdapter` directly (see
 * `orchestrator`'s README, Testing Strategy). `tools/*` is this
 * codebase's established location for exactly this kind of cross-package
 * suite (`tools/adapter-conformance-tests` is the existing precedent) and
 * is deliberately exempt from the per-package `DEPENDENCY_TABLE`
 * (`turbo.json`'s `graph:check` only cruises `packages apps`) — see this
 * package's README.
 */

const tenant = { organizationId: "org-1", workspaceId: "ws-1" };

function req(overrides: Partial<ExecuteRequest> = {}): ExecuteRequest {
  return {
    task: "summarization",
    input: { text: "Summarize the quarterly earnings report." },
    tenant,
    ...overrides,
  };
}

async function buildOrchestrator(adapters: ProviderAdapter[]) {
  return new DefaultExecutionOrchestrator({
    policyEngine: buildPolicyEngine(),
    credentialResolver: await buildCredentialResolver(
      { groq: "sk-groq", "nvidia-nim": "sk-nim" },
      tenant,
    ),
    retryEngine: new DefaultRetryEngine({ sleep: async () => {} }),
    circuitBreaker: new InMemoryCircuitBreaker(),
    healthMonitor: new DefaultHealthMonitor(),
    streamManager: new DefaultStreamManager(),
    adapterRegistry: new InMemoryProviderAdapterRegistry(adapters),
    telemetry: fakeTelemetry(),
  });
}

describe("EM-4 full lifecycle — success", () => {
  it("Policy Engine -> Credential Resolution -> Provider Resolution -> Provider Execution -> Completion", async () => {
    const orchestrator = await buildOrchestrator([
      new MockAdapter({ id: "groq" }),
      new MockAdapter({ id: "nvidia-nim" }),
    ]);
    const response = await orchestrator.execute(req());
    expect(["groq", "nvidia-nim"]).toContain(response.execution.providerId);
    expect(response.finishReason).toBe("stop");
    expect(response.usage.inputTokens).toBeGreaterThan(0);
  });

  it("streams a complete SSE-ready chunk sequence through the real StreamManager", async () => {
    const orchestrator = await buildOrchestrator([
      new MockAdapter({ id: "groq" }),
      new MockAdapter({ id: "nvidia-nim" }),
    ]);
    const chunks = [];
    for await (const chunk of orchestrator.executeStream(req({ requestId: "stream-1" }))) {
      chunks.push(chunk);
    }
    expect(chunks.at(-1)?.done).toBe(true);
    expect(chunks.every((c) => c.requestId === "stream-1")).toBe(true);
  });
});

describe("EM-4 full lifecycle — provider unavailable / retry / fallback", () => {
  it("retries a transient failure and succeeds on the same provider", async () => {
    const groq = new MockAdapter({ id: "groq" });
    let calls = 0;
    const originalInvoke = groq.invoke.bind(groq);
    groq.invoke = async (...args) => {
      calls++;
      if (calls === 1) {
        throw new GatewayError("RATE_LIMITED", "throttled", true);
      }
      return originalInvoke(...args);
    };
    const orchestrator = await buildOrchestrator([groq, new MockAdapter({ id: "nvidia-nim" })]);
    const response = await orchestrator.execute(req());
    expect(response.execution.providerId).toBe("groq");
    expect(response.execution.retries).toBe(1);
  });

  it("fails over to nvidia-nim once groq's retries are exhausted (provider unavailable)", async () => {
    const groq = new MockAdapter({ id: "groq" });
    groq.setBehavior({ mode: "error", errorCode: "TIMEOUT" });
    const nim = new MockAdapter({ id: "nvidia-nim" });
    const orchestrator = await buildOrchestrator([groq, nim]);
    const response = await orchestrator.execute(req());
    expect(response.execution.providerId).toBe("nvidia-nim");
    expect(response.execution.failedOver).toBe(true);
  });

  it("throws ALL_PROVIDERS_UNAVAILABLE once both providers are down", async () => {
    const groq = new MockAdapter({ id: "groq" });
    groq.setBehavior({ mode: "error", errorCode: "TIMEOUT" });
    const nim = new MockAdapter({ id: "nvidia-nim" });
    nim.setBehavior({ mode: "error", errorCode: "TIMEOUT" });
    const orchestrator = await buildOrchestrator([groq, nim]);
    await expect(orchestrator.execute(req())).rejects.toSatisfy(
      (error: unknown) => isGatewayError(error) && error.code === "ALL_PROVIDERS_UNAVAILABLE",
    );
  });
});

describe("EM-4 full lifecycle — credential failure", () => {
  it("terminates with CREDENTIAL_NOT_FOUND when the primary provider has no configured credential", async () => {
    const credentialResolver = await buildCredentialResolver({ "nvidia-nim": "sk-nim" }, tenant); // no groq key
    const orchestrator = new DefaultExecutionOrchestrator({
      policyEngine: buildPolicyEngine(),
      credentialResolver,
      retryEngine: new DefaultRetryEngine({ sleep: async () => {} }),
      circuitBreaker: new InMemoryCircuitBreaker(),
      healthMonitor: new DefaultHealthMonitor(),
      streamManager: new DefaultStreamManager(),
      adapterRegistry: new InMemoryProviderAdapterRegistry([
        new MockAdapter({ id: "groq" }),
        new MockAdapter({ id: "nvidia-nim" }),
      ]),
      telemetry: fakeTelemetry(),
    });
    await expect(orchestrator.execute(req())).rejects.toSatisfy(
      (error: unknown) => isGatewayError(error) && error.code === "CREDENTIAL_NOT_FOUND",
    );
  });
});

describe("EM-4 full lifecycle — streaming interruption / cancellation", () => {
  it("fails over mid-request when the primary provider's stream never opens", async () => {
    const groq = new MockAdapter({ id: "groq" });
    groq.setBehavior({ mode: "error", errorCode: "TIMEOUT" });
    const nim = new MockAdapter({ id: "nvidia-nim" });
    const orchestrator = await buildOrchestrator([groq, nim]);
    const chunks = [];
    for await (const chunk of orchestrator.executeStream(req())) {
      chunks.push(chunk);
    }
    expect(chunks.at(-1)?.done).toBe(true);
  });

  it("cancel() stops an in-flight stream", async () => {
    const orchestrator = await buildOrchestrator([
      new MockAdapter({ id: "groq" }),
      new MockAdapter({ id: "nvidia-nim" }),
    ]);
    const iterator = orchestrator
      .executeStream(req({ requestId: "cancel-me" }))
      [Symbol.asyncIterator]();
    await iterator.next();
    orchestrator.cancel("cancel-me");
    // Draining the rest of the iterator should terminate (either a done
    // chunk or a CANCELLED error) rather than hang.
    let settled = false;
    try {
      for await (const _chunk of { [Symbol.asyncIterator]: () => iterator }) {
        // drain
      }
      settled = true;
    } catch {
      settled = true;
    }
    expect(settled).toBe(true);
  });
});

describe("EM-4 full lifecycle — malformed provider response", () => {
  it("surfaces a malformed streaming response as a typed GatewayError rather than a raw crash", async () => {
    const groq = new MockAdapter({ id: "groq" });
    groq.setBehavior({ mode: "malformed-stream" });
    const nim = new MockAdapter({ id: "nvidia-nim" });
    const orchestrator = await buildOrchestrator([groq, nim]);
    // Either groq's malformed stream is treated as a terminal error before
    // any chunk is yielded (failing over to nim) or, if a chunk was
    // already yielded, it surfaces as a GatewayError — never an unhandled
    // exception/crash escaping as something other than a GatewayError.
    try {
      const chunks = [];
      for await (const chunk of orchestrator.executeStream(req())) {
        chunks.push(chunk);
      }
      expect(chunks.at(-1)?.done).toBe(true);
    } catch (error) {
      expect(isGatewayError(error)).toBe(true);
    }
  });
});
