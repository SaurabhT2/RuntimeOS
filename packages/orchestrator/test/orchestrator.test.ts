import { beforeEach, describe, expect, it, vi } from "vitest";
import { GatewayError, isGatewayError } from "@ai-gateway/core-contracts";
import {
  DefaultHealthMonitor,
  DefaultRetryEngine,
  InMemoryCircuitBreaker,
} from "@ai-gateway/reliability";
import { DefaultStreamManager } from "@ai-gateway/streaming";
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
  failingAdapter,
  plan,
} from "./fixtures.js";

/** Fast, deterministic RetryEngine — no real sleeps. */
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

describe("DefaultExecutionOrchestrator.execute — happy path", () => {
  it("returns a well-formed ExecuteResponse for a single-candidate success", async () => {
    const orchestrator = buildOrchestrator();
    const response = await orchestrator.execute(baseRequest());
    expect(response.execution.providerId).toBe("groq");
    expect(response.execution.retries).toBe(0);
    expect(response.execution.failedOver).toBe(false);
    expect(response.finishReason).toBe("stop");
  });

  it("uses the caller-supplied requestId when present", async () => {
    const orchestrator = buildOrchestrator();
    const response = await orchestrator.execute(baseRequest({ requestId: "caller-id" }));
    expect(response.requestId).toBe("caller-id");
  });

  it("generates a requestId when the caller does not supply one", async () => {
    const orchestrator = buildOrchestrator();
    const response = await orchestrator.execute(baseRequest());
    expect(response.requestId).toBe("gen-id");
  });
});

describe("DefaultExecutionOrchestrator.execute — request validation", () => {
  it("rejects with a non-retryable INVALID_SCHEMA when input has neither text nor messages", async () => {
    const orchestrator = buildOrchestrator();
    await expect(orchestrator.execute(baseRequest({ input: {} }))).rejects.toSatisfy(
      (error: unknown) =>
        isGatewayError(error) && error.code === "INVALID_SCHEMA" && !error.retryable,
    );
  });

  it("rejects with INVALID_SCHEMA for a structurally malformed request", async () => {
    const orchestrator = buildOrchestrator();
    const malformed = { ...baseRequest(), tenant: {} } as unknown as Parameters<
      typeof orchestrator.execute
    >[0];
    await expect(orchestrator.execute(malformed)).rejects.toSatisfy(
      (error: unknown) => isGatewayError(error) && error.code === "INVALID_SCHEMA",
    );
  });
});

describe("DefaultExecutionOrchestrator.execute — retry", () => {
  it("retries a RATE_LIMITED failure and succeeds within the same provider's retry budget", async () => {
    let calls = 0;
    const adapter = fakeAdapter("groq", {
      onInvoke: async () => {
        calls++;
        if (calls === 1) {
          throw new GatewayError("RATE_LIMITED", "slow down", true);
        }
        return { text: "ok", usage: { inputTokens: 1, outputTokens: 1 }, finishReason: "stop" };
      },
    });
    const orchestrator = buildOrchestrator({
      adapterRegistry: new InMemoryProviderAdapterRegistry([adapter]),
    });
    const response = await orchestrator.execute(baseRequest());
    expect(response.execution.retries).toBe(1);
    expect(response.execution.failedOver).toBe(false);
    expect(calls).toBe(2);
  });
});

describe("DefaultExecutionOrchestrator.execute — failover", () => {
  it("advances to the next fallback plan once retries are exhausted on a retryable error", async () => {
    const groq = failingAdapter("groq", new GatewayError("TIMEOUT", "too slow", true));
    const nim = fakeAdapter("nvidia-nim");
    const orchestrator = buildOrchestrator({
      policyEngine: fakePolicyEngine(
        plan({ providerId: "groq", fallbackPlans: [plan({ providerId: "nvidia-nim" })] }),
      ),
      adapterRegistry: new InMemoryProviderAdapterRegistry([groq, nim]),
    });
    const response = await orchestrator.execute(baseRequest());
    expect(response.execution.providerId).toBe("nvidia-nim");
    expect(response.execution.failedOver).toBe(true);
  });

  it("does NOT fail over for a non-retryable error (CONTENT_FILTERED) — the diagram's Z6 terminal", async () => {
    const groq = failingAdapter("groq", new GatewayError("CONTENT_FILTERED", "blocked", false));
    const nim = fakeAdapter("nvidia-nim");
    const invokeSpy = vi.fn(nim.invoke);
    nim.invoke = invokeSpy;
    const orchestrator = buildOrchestrator({
      policyEngine: fakePolicyEngine(
        plan({ providerId: "groq", fallbackPlans: [plan({ providerId: "nvidia-nim" })] }),
      ),
      adapterRegistry: new InMemoryProviderAdapterRegistry([groq, nim]),
    });
    await expect(orchestrator.execute(baseRequest())).rejects.toSatisfy(
      (error: unknown) => isGatewayError(error) && error.code === "CONTENT_FILTERED",
    );
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it("does NOT fail over on a credential resolution failure — always terminal (architecture §17's Z4)", async () => {
    const nim = fakeAdapter("nvidia-nim");
    const orchestrator = buildOrchestrator({
      policyEngine: fakePolicyEngine(
        plan({ providerId: "groq", fallbackPlans: [plan({ providerId: "nvidia-nim" })] }),
      ),
      credentialResolver: fakeCredentialResolver({ "nvidia-nim": "nk" }), // no "groq" key
      adapterRegistry: new InMemoryProviderAdapterRegistry([nim]),
    });
    await expect(orchestrator.execute(baseRequest())).rejects.toSatisfy(
      (error: unknown) => isGatewayError(error) && error.code === "CREDENTIAL_NOT_FOUND",
    );
  });

  it("throws ALL_PROVIDERS_UNAVAILABLE once every plan in the chain is exhausted", async () => {
    const groq = failingAdapter("groq", new GatewayError("TIMEOUT", "down", true));
    const nim = failingAdapter("nvidia-nim", new GatewayError("TIMEOUT", "also down", true));
    const orchestrator = buildOrchestrator({
      policyEngine: fakePolicyEngine(
        plan({ providerId: "groq", fallbackPlans: [plan({ providerId: "nvidia-nim" })] }),
      ),
      adapterRegistry: new InMemoryProviderAdapterRegistry([groq, nim]),
    });
    await expect(orchestrator.execute(baseRequest())).rejects.toSatisfy(
      (error: unknown) =>
        isGatewayError(error) && error.code === "ALL_PROVIDERS_UNAVAILABLE" && !error.retryable,
    );
  });

  it("advances to the next plan when the registry has no adapter for the primary provider", async () => {
    const nim = fakeAdapter("nvidia-nim");
    const orchestrator = buildOrchestrator({
      policyEngine: fakePolicyEngine(
        plan({ providerId: "groq", fallbackPlans: [plan({ providerId: "nvidia-nim" })] }),
      ),
      adapterRegistry: new InMemoryProviderAdapterRegistry([nim]), // no "groq" adapter registered
    });
    const response = await orchestrator.execute(baseRequest());
    expect(response.execution.providerId).toBe("nvidia-nim");
    expect(response.execution.failedOver).toBe(true);
  });

  it("skips a candidate whose circuit breaker is open and advances to the next plan", async () => {
    const groq = fakeAdapter("groq");
    const invokeSpy = vi.fn(groq.invoke);
    groq.invoke = invokeSpy;
    const nim = fakeAdapter("nvidia-nim");
    const breaker = new InMemoryCircuitBreaker();
    vi.spyOn(breaker, "canProceed").mockImplementation((key) => key !== "groq::fast-extraction");
    const orchestrator = buildOrchestrator({
      policyEngine: fakePolicyEngine(
        plan({ providerId: "groq", fallbackPlans: [plan({ providerId: "nvidia-nim" })] }),
      ),
      circuitBreaker: breaker,
      adapterRegistry: new InMemoryProviderAdapterRegistry([groq, nim]),
    });
    const response = await orchestrator.execute(baseRequest());
    expect(response.execution.providerId).toBe("nvidia-nim");
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it("fails over on INTERNAL_ERROR (e.g. a network exception) when a fallback plan is available — the chaos-test scenario", async () => {
    const groq = failingAdapter("groq", new GatewayError("INTERNAL_ERROR", "ECONNREFUSED", false));
    const nim = fakeAdapter("nvidia-nim");
    const orchestrator = buildOrchestrator({
      policyEngine: fakePolicyEngine(
        plan({ providerId: "groq", fallbackPlans: [plan({ providerId: "nvidia-nim" })] }),
      ),
      adapterRegistry: new InMemoryProviderAdapterRegistry([groq, nim]),
    });
    const response = await orchestrator.execute(baseRequest());
    expect(response.execution.providerId).toBe("nvidia-nim");
    expect(response.execution.failedOver).toBe(true);
  });

  it("does NOT fail over on a genuinely non-eligible code (INVALID_SCHEMA) even with a fallback plan available", async () => {
    const groq = failingAdapter("groq", new GatewayError("INVALID_SCHEMA", "bad request", false));
    const nim = fakeAdapter("nvidia-nim");
    const invokeSpy = vi.fn(nim.invoke);
    nim.invoke = invokeSpy;
    const orchestrator = buildOrchestrator({
      policyEngine: fakePolicyEngine(
        plan({ providerId: "groq", fallbackPlans: [plan({ providerId: "nvidia-nim" })] }),
      ),
      adapterRegistry: new InMemoryProviderAdapterRegistry([groq, nim]),
    });
    await expect(orchestrator.execute(baseRequest())).rejects.toSatisfy(
      (error: unknown) => isGatewayError(error) && error.code === "INVALID_SCHEMA",
    );
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it("wraps a non-GatewayError thrown by an adapter as INTERNAL_ERROR, which is failover-eligible (chaos-test requirement — see errors.ts's NON_FAILOVER_CODES doc comment)", async () => {
    const groq = fakeAdapter("groq", {
      onInvoke: async () => {
        throw new SyntaxError("Unexpected token in JSON");
      },
    });
    const orchestrator = buildOrchestrator({
      adapterRegistry: new InMemoryProviderAdapterRegistry([groq]),
    });
    await expect(orchestrator.execute(baseRequest())).rejects.toSatisfy(
      (error: unknown) =>
        isGatewayError(error) &&
        error.code === "ALL_PROVIDERS_UNAVAILABLE" &&
        (error.details as { attempts: Array<{ code: string }> }).attempts[0]?.code ===
          "INTERNAL_ERROR",
    );
  });
});

describe("DefaultExecutionOrchestrator.execute — deadline propagation", () => {
  it("shrinks the invocation's timeoutMs to the remaining request budget", async () => {
    let seenTimeoutMs = -1;
    const groq = fakeAdapter("groq", {
      onInvoke: async (req) => {
        seenTimeoutMs = req.timeoutMs;
        return { text: "ok", usage: { inputTokens: 1, outputTokens: 1 }, finishReason: "stop" };
      },
    });
    // First `now()` call computes the deadline (request entry); by the time
    // the candidate is actually attempted, 100ms of (simulated) policy
    // engine / credential resolution latency has elapsed.
    const clock = [0, 100, 100, 100, 100];
    const orchestrator = buildOrchestrator({
      adapterRegistry: new InMemoryProviderAdapterRegistry([groq]),
      now: () => clock.shift() ?? 100,
    });
    await orchestrator.execute(baseRequest({ constraints: { maxLatencyMs: 500 } }));
    expect(seenTimeoutMs).toBe(400);
  });

  it("fails the candidate immediately once the deadline has already elapsed, without calling the adapter", async () => {
    const groq = fakeAdapter("groq");
    const invokeSpy = vi.fn(groq.invoke);
    groq.invoke = invokeSpy;
    // Deadline computed at t=0 with a 500ms budget (deadlineAt=500); by the
    // time `resolveCandidate` checks it, the clock has already passed 500.
    const clock = [0, 1000, 1000, 1000, 1000];
    const orchestrator = buildOrchestrator({
      adapterRegistry: new InMemoryProviderAdapterRegistry([groq]),
      now: () => clock.shift() ?? 1000,
    });
    await expect(
      orchestrator.execute(baseRequest({ constraints: { maxLatencyMs: 500 } })),
    ).rejects.toSatisfy(
      (error: unknown) => isGatewayError(error) && error.code === "ALL_PROVIDERS_UNAVAILABLE",
    );
    expect(invokeSpy).not.toHaveBeenCalled();
  });
});

describe("DefaultExecutionOrchestrator.executeStream", () => {
  it("yields chunks and terminates cleanly on success", async () => {
    const orchestrator = buildOrchestrator();
    const chunks = [];
    for await (const chunk of orchestrator.executeStream(baseRequest({ requestId: "s1" }))) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.at(-1)?.done).toBe(true);
    expect(chunks.every((c) => c.requestId === "s1")).toBe(true);
  });

  it("fails over to the next plan if the stream fails before any chunk is yielded", async () => {
    const groq = failingAdapter("groq", new GatewayError("TIMEOUT", "down", true));
    const nim = fakeAdapter("nvidia-nim");
    const orchestrator = buildOrchestrator({
      policyEngine: fakePolicyEngine(
        plan({
          providerId: "groq",
          streaming: true,
          fallbackPlans: [plan({ providerId: "nvidia-nim", streaming: true })],
        }),
      ),
      adapterRegistry: new InMemoryProviderAdapterRegistry([groq, nim]),
    });
    const chunks = [];
    for await (const chunk of orchestrator.executeStream(baseRequest())) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.at(-1)?.done).toBe(true);
  });

  it("does NOT fail over after a chunk has already been yielded (partial output already delivered)", async () => {
    const groq = fakeAdapter("groq", {
      onInvokeStream: async function* () {
        yield { delta: { text: "partial" }, done: false };
        throw new GatewayError("TIMEOUT", "connection dropped mid-stream", true);
      },
    });
    const nim = fakeAdapter("nvidia-nim");
    const invokeStreamSpy = vi.fn(nim.invokeStream);
    nim.invokeStream = invokeStreamSpy;
    const orchestrator = buildOrchestrator({
      policyEngine: fakePolicyEngine(
        plan({
          providerId: "groq",
          streaming: true,
          fallbackPlans: [plan({ providerId: "nvidia-nim", streaming: true })],
        }),
      ),
      adapterRegistry: new InMemoryProviderAdapterRegistry([groq, nim]),
    });

    const iterator = orchestrator.executeStream(baseRequest())[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.value?.delta.text).toBe("partial");
    await expect(iterator.next()).rejects.toSatisfy(
      (error: unknown) => isGatewayError(error) && error.code === "TIMEOUT",
    );
    expect(invokeStreamSpy).not.toHaveBeenCalled();
  });

  it("does not fail over for a non-retryable streaming error before any chunk is yielded", async () => {
    const groq = failingAdapter("groq", new GatewayError("CONTENT_FILTERED", "blocked", false));
    const nim = fakeAdapter("nvidia-nim");
    const invokeStreamSpy = vi.fn(nim.invokeStream);
    nim.invokeStream = invokeStreamSpy;
    const orchestrator = buildOrchestrator({
      policyEngine: fakePolicyEngine(
        plan({
          providerId: "groq",
          streaming: true,
          fallbackPlans: [plan({ providerId: "nvidia-nim", streaming: true })],
        }),
      ),
      adapterRegistry: new InMemoryProviderAdapterRegistry([groq, nim]),
    });
    const iterator = orchestrator.executeStream(baseRequest())[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toSatisfy(
      (error: unknown) => isGatewayError(error) && error.code === "CONTENT_FILTERED",
    );
    expect(invokeStreamSpy).not.toHaveBeenCalled();
  });

  it("throws ALL_PROVIDERS_UNAVAILABLE once every streaming candidate is exhausted", async () => {
    const groq = failingAdapter("groq", new GatewayError("TIMEOUT", "down", true));
    const nim = failingAdapter("nvidia-nim", new GatewayError("TIMEOUT", "also down", true));
    const orchestrator = buildOrchestrator({
      policyEngine: fakePolicyEngine(
        plan({
          providerId: "groq",
          streaming: true,
          fallbackPlans: [plan({ providerId: "nvidia-nim", streaming: true })],
        }),
      ),
      adapterRegistry: new InMemoryProviderAdapterRegistry([groq, nim]),
    });
    const iterator = orchestrator.executeStream(baseRequest())[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toSatisfy(
      (error: unknown) => isGatewayError(error) && error.code === "ALL_PROVIDERS_UNAVAILABLE",
    );
  });

  it("cancel() delegates to the StreamManager", () => {
    const streamManager = new DefaultStreamManager();
    const cancelSpy = vi.spyOn(streamManager, "cancel");
    const orchestrator = buildOrchestrator({ streamManager });
    orchestrator.cancel("req-x");
    expect(cancelSpy).toHaveBeenCalledWith("req-x");
  });
});

describe("DefaultExecutionOrchestrator — telemetry", () => {
  it("starts and ends a span, and logs completion, on a successful execute()", async () => {
    const span = { setStatus: vi.fn(), end: vi.fn() };
    const telemetry = {
      startSpan: vi.fn(() => span as never),
      recordMetric: vi.fn(),
      log: vi.fn(),
    };
    const orchestrator = buildOrchestrator({ telemetry });
    await orchestrator.execute(baseRequest());
    expect(telemetry.startSpan).toHaveBeenCalledWith(
      "orchestrator.execute",
      expect.objectContaining({ task: "summarization" }),
    );
    expect(span.end).toHaveBeenCalledTimes(1);
    expect(telemetry.log).toHaveBeenCalledWith("info", "execute completed", expect.anything());
  });

  it("logs a failure and sets an error span status when every candidate fails", async () => {
    const span = { setStatus: vi.fn(), end: vi.fn() };
    const telemetry = {
      startSpan: vi.fn(() => span as never),
      recordMetric: vi.fn(),
      log: vi.fn(),
    };
    const orchestrator = buildOrchestrator({
      telemetry,
      adapterRegistry: new InMemoryProviderAdapterRegistry([
        failingAdapter("groq", new GatewayError("TIMEOUT", "down", true)),
      ]),
    });
    await expect(orchestrator.execute(baseRequest())).rejects.toBeInstanceOf(GatewayError);
    expect(span.end).toHaveBeenCalledTimes(1);
    expect(telemetry.log).toHaveBeenCalledWith("error", "execute failed", expect.anything());
  });
});

describe("DefaultExecutionOrchestrator — health monitor / circuit breaker bookkeeping", () => {
  let healthMonitor: DefaultHealthMonitor;
  let circuitBreaker: InMemoryCircuitBreaker;

  beforeEach(() => {
    healthMonitor = new DefaultHealthMonitor();
    circuitBreaker = new InMemoryCircuitBreaker();
  });

  it("reports success to both the health monitor and circuit breaker on a successful attempt", async () => {
    const reportSuccessSpy = vi.spyOn(healthMonitor, "reportSuccess");
    const recordSuccessSpy = vi.spyOn(circuitBreaker, "recordSuccess");
    const orchestrator = buildOrchestrator({ healthMonitor, circuitBreaker });
    await orchestrator.execute(baseRequest());
    expect(reportSuccessSpy).toHaveBeenCalledWith(
      "groq",
      expect.objectContaining({ latencyMs: expect.any(Number) }),
    );
    expect(recordSuccessSpy).toHaveBeenCalledWith("groq::fast-extraction");
  });

  it("reports failure to both on a failed attempt", async () => {
    const reportFailureSpy = vi.spyOn(healthMonitor, "reportFailure");
    const recordFailureSpy = vi.spyOn(circuitBreaker, "recordFailure");
    const orchestrator = buildOrchestrator({
      healthMonitor,
      circuitBreaker,
      adapterRegistry: new InMemoryProviderAdapterRegistry([
        failingAdapter("groq", new GatewayError("CONTENT_FILTERED", "blocked", false)),
      ]),
    });
    await expect(orchestrator.execute(baseRequest())).rejects.toBeInstanceOf(GatewayError);
    expect(reportFailureSpy).toHaveBeenCalledWith("groq", {
      code: "CONTENT_FILTERED",
      message: "blocked",
    });
    expect(recordFailureSpy).toHaveBeenCalledWith("groq::fast-extraction");
  });
});
