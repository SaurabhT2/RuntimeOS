import { vi } from "vitest";
import type { ModelDescriptor } from "@ai-gateway/model-registry";
import type { Telemetry } from "@ai-gateway/telemetry";
import type {
  CostEstimate,
  NormalizedChunk,
  NormalizedInvocation,
  NormalizedResult,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderHealthSnapshot,
} from "@ai-gateway/orchestrator";
import type { ScopedCredential } from "@ai-gateway/credential-resolver";
import type { GatewayServerConfig } from "../src/server-config.js";

export function fakeTelemetry(): Telemetry {
  return {
    startSpan: vi.fn(() => ({ setStatus: vi.fn(), end: vi.fn() }) as never),
    recordMetric: vi.fn(),
    log: vi.fn(),
  };
}

const CAPABILITIES: ProviderCapabilities = {
  supportsStreaming: true,
  supportsJsonMode: true,
  supportsToolCalling: true,
  supportsSystemMessages: true,
  maxContextTokens: 32_000,
  rateLimits: { requestsPerMinute: 60, tokensPerMinute: 60_000 },
};

/**
 * Deterministic two-provider seed (`groq` + `nvidia-nim`, same `modelClass`),
 * matching the pattern `tools/orchestrator-integration-tests/test/fixtures.ts`
 * already established (`SEED_MODELS`'s cost gap otherwise makes `groq` win
 * every scoring pass, which would make failover-path tests flaky/order-
 * dependent rather than deterministic).
 */
export const TEST_MODEL_SEED: ModelDescriptor[] = [
  {
    providerId: "groq",
    modelId: "test-groq-model",
    modelClass: "fast-extraction",
    capabilities: {
      contextWindow: 32_000,
      structuredOutput: true,
      streaming: true,
      toolCalling: false,
      reasoningDepth: "shallow",
      creativityScore: 0.2,
    },
    performance: { p50LatencyMs: 180, p99LatencyMs: 420, tokensPerSecond: 280 },
    cost: { inputPer1kTokensUsd: 0, outputPer1kTokensUsd: 0, tier: "free" },
    availability: { enabled: true, rateLimits: { requestsPerMinute: 30, tokensPerMinute: 6000 } },
  },
  {
    providerId: "nvidia-nim",
    modelId: "test-nim-model",
    modelClass: "fast-extraction",
    capabilities: {
      contextWindow: 32_000,
      structuredOutput: true,
      streaming: true,
      toolCalling: true,
      reasoningDepth: "shallow",
      creativityScore: 0.2,
    },
    performance: { p50LatencyMs: 220, p99LatencyMs: 500, tokensPerSecond: 240 },
    cost: { inputPer1kTokensUsd: 0.05, outputPer1kTokensUsd: 0.08, tier: "paid" },
    availability: { enabled: true, rateLimits: { requestsPerMinute: 60, tokensPerMinute: 60_000 } },
  },
];

interface FakeAdapterOptions {
  id: string;
  behavior?: "succeed" | "fail" | "unhealthy";
  text?: string;
}

/** A minimal, fully scripted `ProviderAdapter` — no network, no timers, deterministic output. */
export function fakeAdapter(options: FakeAdapterOptions): ProviderAdapter {
  const { id, behavior = "succeed", text = `response from ${id}` } = options;
  return {
    id,
    capabilities: CAPABILITIES,
    async invoke(_req: NormalizedInvocation, _cred: ScopedCredential): Promise<NormalizedResult> {
      if (behavior === "fail") {
        const { GatewayError } = await import("@ai-gateway/core-contracts");
        throw new GatewayError("INTERNAL_ERROR", `${id} simulated failure`, true);
      }
      return {
        text,
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: "stop",
      };
    },
    async *invokeStream(
      _req: NormalizedInvocation,
      _cred: ScopedCredential,
    ): AsyncIterable<NormalizedChunk> {
      if (behavior === "fail") {
        const { GatewayError } = await import("@ai-gateway/core-contracts");
        throw new GatewayError("INTERNAL_ERROR", `${id} simulated stream failure`, true);
      }
      yield { delta: { text }, done: false };
      yield {
        delta: {},
        done: true,
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    },
    async healthCheck(_cred: ScopedCredential): Promise<ProviderHealthSnapshot> {
      return {
        providerId: id,
        healthy: behavior !== "unhealthy",
        lastCheckedAt: new Date().toISOString(),
        consecutiveFailures: behavior === "unhealthy" ? 3 : 0,
        message: behavior === "unhealthy" ? "simulated unhealthy" : undefined,
      };
    },
    estimateCost(_req: NormalizedInvocation): CostEstimate {
      return { estimatedInputTokens: 10, estimatedOutputTokens: 5, estimatedCostUsd: 0 };
    },
  };
}

/** A `ProviderAdapter` whose stream yields one chunk, waits, then yields a second — long enough for a test to reliably abort mid-stream and observe the resulting `cancel()` call. */
export function fakeSlowStreamAdapter(id: string, delayMs = 200): ProviderAdapter {
  const base = fakeAdapter({ id });
  return {
    ...base,
    async *invokeStream(
      _req: NormalizedInvocation,
      _cred: ScopedCredential,
    ): AsyncIterable<NormalizedChunk> {
      yield { delta: { text: "partial" }, done: false };
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      yield {
        delta: {},
        done: true,
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    },
  };
}
export function testServerConfig(
  overrides: Partial<GatewayServerConfig> = {},
): GatewayServerConfig {
  return {
    http: { host: "127.0.0.1", port: 0 },
    providerPlatformKeyEnvVars: {
      groq: "TEST_GROQ_PLATFORM_API_KEY",
      "nvidia-nim": "TEST_NIM_PLATFORM_API_KEY",
    },
    credentialPriority: ["platform"],
    apiKeys: [
      {
        apiKey: "test-key-org-1",
        tenant: { organizationId: "org-1" },
        role: "member",
      },
    ],
    rateLimit: {},
    cache: {},
    ...overrides,
  };
}
