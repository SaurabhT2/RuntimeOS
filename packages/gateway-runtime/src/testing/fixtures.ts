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
import type { GatewayRuntimeConfig } from "../bootstrap.js";

/**
 * Test doubles shared by this package's own test suite and by both
 * hosting layers' test suites (`apps/gateway-server/test/`,
 * `apps/vercel-adapter/test/`) — the same rationale as sharing the
 * production code itself: a fake `ProviderAdapter` isn't hosting-specific,
 * so there is no reason for two apps to each maintain their own copy.
 *
 * `vitest` is a `devDependency` of this package (not a runtime
 * dependency) purely for `vi.fn()`; this module is only ever imported
 * from `test/` directories.
 */
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

/** A minimal, valid `GatewayRuntimeConfig` for tests. Each app's own test suite may spread additional, hosting-specific fields (e.g. `apps/gateway-server`'s `http: { host, port }`) on top of this. */
export function testRuntimeConfig(
  overrides: Partial<GatewayRuntimeConfig> = {},
): GatewayRuntimeConfig {
  return {
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
