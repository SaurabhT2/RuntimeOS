import { GatewayError, type GatewayErrorCode } from "@ai-gateway/core-contracts";
import type { ProviderAdapter } from "./provider-adapter.js";
import type { ProviderCapabilities } from "./capabilities.js";
import type { NormalizedInvocation, NormalizedResult, NormalizedChunk } from "./invocation.js";
import type { ScopedCredential } from "./credential.js";
import type { ProviderHealthSnapshot } from "./health.js";
import type { CostEstimate } from "./cost.js";
import { createGatewayError, withTimeout, delay } from "./internal/errors.js";

/**
 * What {@link MockAdapter} should do on its next `invoke`/`invokeStream`/
 * `healthCheck` call (Blueprint §8.4: "configurable to simulate success,
 * specific error codes, timeouts, and malformed streaming").
 */
export type MockAdapterMode = "success" | "error" | "timeout" | "malformed-stream";

export interface MockAdapterBehavior {
  mode: MockAdapterMode;
  /** Required when `mode: "error"`. Ignored otherwise. */
  errorCode?: GatewayErrorCode;
  errorMessage?: string;
  /** Simulated processing latency in ms before the (successful) result/chunks are produced. */
  latencyMs?: number;
  /** Overrides for the canned successful `NormalizedResult`. */
  result?: Partial<NormalizedResult>;
  /** Number of non-final chunks `invokeStream` yields before its terminal chunk, in `"success"` mode. Default 3. */
  chunkCount?: number;
}

const DEFAULT_BEHAVIOR: MockAdapterBehavior = { mode: "success" };

const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  supportsStreaming: true,
  supportsJsonMode: true,
  supportsToolCalling: true,
  supportsSystemMessages: true,
  maxContextTokens: 128_000,
  rateLimits: { requestsPerMinute: 6000, tokensPerMinute: 600_000 },
};

function assertCredential(cred: ScopedCredential): void {
  if (!cred.key) {
    throw createGatewayError(
      "CREDENTIAL_INVALID",
      "Mock adapter received an empty credential key.",
    );
  }
}

function cannedResult(
  req: NormalizedInvocation,
  overrides?: Partial<NormalizedResult>,
): NormalizedResult {
  return {
    text: `mock response for model ${req.modelId}`,
    usage: {
      inputTokens: estimateTokens(req),
      outputTokens: req.maxOutputTokens > 0 ? Math.min(req.maxOutputTokens, 32) : 32,
    },
    finishReason: "stop",
    ...overrides,
  };
}

/** A deliberately simple token estimate — not billing-accurate, only realistic enough for conformance/demo use. */
function estimateTokens(req: NormalizedInvocation): number {
  const chars = req.messages.reduce((sum, m) => sum + m.content.length, 0);
  return Math.max(1, Math.round(chars / 4));
}

/**
 * A fully in-memory {@link ProviderAdapter} implementation with no network
 * calls (Blueprint §8.4). Used by:
 *
 * - {@link runConformanceSuite} itself, to validate the harness against a
 *   known-good adapter before any real adapter exists.
 * - Every real adapter's own test suite, as the harness's baseline.
 * - The EM-1 vertical-slice demo (`test/integration/debug-endpoint.test.ts`),
 *   standing in for a real provider end-to-end over HTTP.
 *
 * Behavior is configured via {@link MockAdapter.setBehavior} and applies to
 * the *next* call (not just once) until changed again or {@link MockAdapter.reset}
 * is called — this makes it trivial to configure once per test case.
 */
export class MockAdapter implements ProviderAdapter {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;

  private behavior: MockAdapterBehavior;

  constructor(options: { id?: string; capabilities?: Partial<ProviderCapabilities> } = {}) {
    this.id = options.id ?? "mock";
    this.capabilities = { ...DEFAULT_CAPABILITIES, ...options.capabilities };
    this.behavior = DEFAULT_BEHAVIOR;
  }

  /** Configures the behavior applied to subsequent calls. */
  setBehavior(behavior: MockAdapterBehavior): void {
    this.behavior = behavior;
  }

  /** Restores the default (`"success"`) behavior. */
  reset(): void {
    this.behavior = DEFAULT_BEHAVIOR;
  }

  async invoke(req: NormalizedInvocation, cred: ScopedCredential): Promise<NormalizedResult> {
    assertCredential(cred);
    return withTimeout(this.produceInvokeResult(req), req.timeoutMs);
  }

  private async produceInvokeResult(req: NormalizedInvocation): Promise<NormalizedResult> {
    await delay(this.behavior.latencyMs ?? 0);

    switch (this.behavior.mode) {
      case "timeout":
        throw createGatewayError("TIMEOUT", "Mock adapter configured to simulate a timeout.");
      case "error":
        throw createGatewayError(
          this.behavior.errorCode ?? "INTERNAL_ERROR",
          this.behavior.errorMessage ?? "Mock adapter configured to simulate an error.",
        );
      case "malformed-stream":
        // Not a streaming call; treat as an internal translation failure,
        // matching how a real adapter would surface an unexpected/malformed
        // non-streaming response body it cannot parse.
        throw createGatewayError(
          "INTERNAL_ERROR",
          "Mock adapter configured to simulate a malformed response body.",
        );
      case "success":
      default:
        return cannedResult(req, this.behavior.result);
    }
  }

  async *invokeStream(
    req: NormalizedInvocation,
    cred: ScopedCredential,
  ): AsyncIterable<NormalizedChunk> {
    assertCredential(cred);

    if (this.behavior.mode === "timeout") {
      await delay(Math.min(this.behavior.latencyMs ?? 0, req.timeoutMs));
      throw createGatewayError("TIMEOUT", "Mock adapter configured to simulate a timeout.");
    }

    if (this.behavior.mode === "error") {
      await delay(this.behavior.latencyMs ?? 0);
      throw createGatewayError(
        this.behavior.errorCode ?? "INTERNAL_ERROR",
        this.behavior.errorMessage ?? "Mock adapter configured to simulate an error.",
      );
    }

    const chunkCount = this.behavior.chunkCount ?? 3;
    for (let i = 0; i < chunkCount; i++) {
      await delay(this.behavior.latencyMs ?? 0);

      if (this.behavior.mode === "malformed-stream" && i === Math.floor(chunkCount / 2)) {
        // Simulates a provider stream that breaks mid-flight (e.g. a
        // connection drop or an unparsable SSE frame) — the adapter must
        // translate this into a GatewayError rather than yielding garbage
        // or letting a raw exception escape (architecture §19.2).
        throw createGatewayError(
          "INTERNAL_ERROR",
          "Mock adapter configured to simulate a malformed/interrupted stream.",
        );
      }

      yield { delta: { text: `chunk-${i}` }, done: false };
    }

    const overrides = this.behavior.result;
    yield {
      delta: {},
      done: true,
      finishReason: overrides?.finishReason ?? "stop",
      usage: overrides?.usage ?? { inputTokens: estimateTokens(req), outputTokens: chunkCount },
    };
  }

  async healthCheck(cred: ScopedCredential): Promise<ProviderHealthSnapshot> {
    const startedAt = Date.now();
    try {
      assertCredential(cred);
      if (this.behavior.mode === "timeout" || this.behavior.mode === "error") {
        return {
          providerId: this.id,
          healthy: false,
          lastCheckedAt: new Date().toISOString(),
          consecutiveFailures: 1,
          message:
            this.behavior.mode === "timeout"
              ? "Mock adapter configured to simulate a timeout."
              : (this.behavior.errorMessage ?? "Mock adapter configured to simulate an error."),
        };
      }
      await delay(this.behavior.latencyMs ?? 0);
      return {
        providerId: this.id,
        healthy: true,
        latencyMs: Date.now() - startedAt,
        lastCheckedAt: new Date().toISOString(),
        consecutiveFailures: 0,
      };
    } catch (error) {
      return {
        providerId: this.id,
        healthy: false,
        lastCheckedAt: new Date().toISOString(),
        consecutiveFailures: 1,
        message: error instanceof GatewayError ? error.message : "Unknown health check failure.",
      };
    }
  }

  estimateCost(req: NormalizedInvocation): CostEstimate {
    const estimatedInputTokens = estimateTokens(req);
    const estimatedOutputTokens = req.maxOutputTokens > 0 ? req.maxOutputTokens : 256;
    // Flat, made-up mock rate — realistic enough to exercise callers'
    // handling of a positive `estimatedCostUsd`, never intended to model
    // any real provider's pricing.
    const estimatedCostUsd = (estimatedInputTokens + estimatedOutputTokens) * 0.0000005;
    return { estimatedInputTokens, estimatedOutputTokens, estimatedCostUsd };
  }
}
