import { DEFAULT_SCORING_WEIGHTS } from "@ai-gateway/policy-engine";
import type { CapabilityRequirement, scoreCandidates } from "@ai-gateway/policy-engine";

/**
 * This package's Blueprint §4.1 dependency edges are `telemetry`,
 * `policy-engine` only — no `model-registry`/`reliability` edge is
 * declared, so this file cannot `import type { ModelDescriptor }` or
 * `import type { ProviderHealthSnapshot }` from those packages directly
 * (pnpm's strict, non-hoisted `node_modules` would refuse to resolve it,
 * and `.dependency-cruiser.cjs` would flag it even if it somehow did).
 * Deriving the shapes structurally from `policy-engine`'s own already-declared
 * `scoreCandidates` export keeps every fixture type-checked against the
 * real shape without adding an edge this package doesn't have.
 */
type ModelDescriptorLike = Parameters<typeof scoreCandidates>[0][number];
type GetHealthLike = Parameters<typeof scoreCandidates>[2];
type ProviderHealthSnapshotLike = ReturnType<GetHealthLike>;

export function model(overrides: Partial<ModelDescriptorLike> = {}): ModelDescriptorLike {
  return {
    providerId: "groq",
    modelId: "llama-3.1-8b-instant",
    modelClass: "fast-extraction",
    capabilities: {
      contextWindow: 128_000,
      structuredOutput: true,
      streaming: true,
      toolCalling: false,
      reasoningDepth: "moderate",
      creativityScore: 0.4,
    },
    performance: { p50LatencyMs: 250, p99LatencyMs: 900, tokensPerSecond: 400 },
    cost: { inputPer1kTokensUsd: 0.05, outputPer1kTokensUsd: 0.08, tier: "paid" },
    availability: { enabled: true, rateLimits: { requestsPerMinute: 30 } },
    ...overrides,
  };
}

export function requirement(overrides: Partial<CapabilityRequirement> = {}): CapabilityRequirement {
  return {
    requiresJsonMode: false,
    requiresToolCalling: false,
    requiresStreaming: false,
    creativityAffinity: 0.3,
    reasoningAffinity: 0.3,
    ...overrides,
  };
}

export function health(
  overrides: Partial<ProviderHealthSnapshotLike> = {},
): ProviderHealthSnapshotLike {
  return {
    providerId: "groq",
    healthy: true,
    lastCheckedAt: new Date(0).toISOString(),
    consecutiveFailures: 0,
    ...overrides,
  };
}

export const baseWeights = DEFAULT_SCORING_WEIGHTS;

export function candidateSet(): ModelDescriptorLike[] {
  return [
    model({ providerId: "groq", modelId: "fast-model", modelClass: "fast-extraction" }),
    model({
      providerId: "nvidia-nim",
      modelId: "reasoning-model",
      modelClass: "complex-reasoning",
      capabilities: {
        contextWindow: 200_000,
        structuredOutput: true,
        streaming: true,
        toolCalling: true,
        reasoningDepth: "deep",
        creativityScore: 0.6,
      },
      performance: { p50LatencyMs: 900, p99LatencyMs: 2_500, tokensPerSecond: 120 },
      cost: { inputPer1kTokensUsd: 0.4, outputPer1kTokensUsd: 0.6, tier: "paid" },
    }),
  ];
}
