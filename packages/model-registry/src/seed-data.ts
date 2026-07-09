import type { ModelDescriptor } from "./model-descriptor.js";

/**
 * architecture §14.3's illustrative seed table, expressed as full
 * `ModelDescriptor` records. architecture §14.3 is explicit that "exact
 * model identifiers are deliberately left as configuration, not hardcoded
 * in this spec" — so the `modelId` values below are placeholders
 * (`"groq-fast-extraction-v1"` etc.), not real provider-hosted model
 * identifiers, exactly as EM-1's `MockAdapter` uses placeholder responses
 * rather than real provider output. Real model identifiers are an
 * operator-configured value, not a `model-registry` code change
 * (architecture §14.2), and are expected to be supplied for real when
 * `providers/groq`/`providers/nvidia-nim` land in EM-3.
 */
export const SEED_MODELS: ModelDescriptor[] = [
  {
    providerId: "groq",
    modelId: "groq-fast-extraction-v1",
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
    providerId: "groq",
    modelId: "groq-complex-reasoning-v1",
    modelClass: "complex-reasoning",
    capabilities: {
      contextWindow: 128_000,
      structuredOutput: true,
      streaming: true,
      toolCalling: true,
      reasoningDepth: "deep",
      creativityScore: 0.4,
    },
    performance: { p50LatencyMs: 650, p99LatencyMs: 1800, tokensPerSecond: 90 },
    cost: { inputPer1kTokensUsd: 0, outputPer1kTokensUsd: 0, tier: "free" },
    availability: { enabled: true, rateLimits: { requestsPerMinute: 30, tokensPerMinute: 6000 } },
  },
  {
    providerId: "groq",
    modelId: "groq-creative-v1",
    modelClass: "creative",
    capabilities: {
      contextWindow: 32_000,
      structuredOutput: false,
      streaming: true,
      toolCalling: false,
      reasoningDepth: "moderate",
      creativityScore: 0.9,
    },
    performance: { p50LatencyMs: 300, p99LatencyMs: 700, tokensPerSecond: 200 },
    cost: { inputPer1kTokensUsd: 0, outputPer1kTokensUsd: 0, tier: "free" },
    availability: { enabled: true, rateLimits: { requestsPerMinute: 30, tokensPerMinute: 6000 } },
  },
  {
    providerId: "nvidia-nim",
    modelId: "nim-fast-extraction-v1",
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
  {
    providerId: "nvidia-nim",
    modelId: "nim-complex-reasoning-v1",
    modelClass: "complex-reasoning",
    capabilities: {
      contextWindow: 128_000,
      structuredOutput: true,
      streaming: true,
      toolCalling: true,
      reasoningDepth: "deep",
      creativityScore: 0.5,
    },
    performance: { p50LatencyMs: 700, p99LatencyMs: 1600, tokensPerSecond: 110 },
    cost: { inputPer1kTokensUsd: 0.15, outputPer1kTokensUsd: 0.3, tier: "paid" },
    availability: { enabled: true, rateLimits: { requestsPerMinute: 60, tokensPerMinute: 60_000 } },
  },
];
