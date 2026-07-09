import type { ModelDescriptor } from "./model-descriptor.js";

/**
 * architecture §14.3's illustrative seed table, expressed as full
 * `ModelDescriptor` records. architecture §14.3 is explicit that "exact
 * model identifiers are deliberately left as configuration, not hardcoded
 * in this spec" — the original placeholder `modelId` values
 * (`"groq-fast-extraction-v1"` etc.) reflected that intent but were never
 * resolvable against a real provider, which is why the first production
 * boot 404'd against Groq.
 *
 * The three `providerId: "groq"` entries below have been refreshed to
 * real, currently-supported Groq production model IDs (see
 * https://console.groq.com/docs/models), confirmed reachable with a live
 * Groq API key. `nvidia-nim` entries are unchanged — this refresh is
 * scoped to the Groq 404 only. `modelClass` and capability flags are
 * preserved unchanged so routing semantics don't shift; `contextWindow`
 * and `performance.tokensPerSecond` have been updated to each model's
 * real, documented values (neither feeds `policy-engine`'s scoring).
 * `performance.p50LatencyMs`/`p99LatencyMs`, `cost`, and
 * `availability.rateLimits` are deliberately left at their original
 * illustrative figures rather than Groq's real numbers:
 * `packages/policy-engine`'s model scorer keys directly off
 * `p50LatencyMs`, `cost.outputPer1kTokensUsd`, and
 * `rateLimits.requestsPerMinute`, and several of its existing tests
 * assert specific routing outcomes (which provider wins under a cost
 * preference, which wins a close soft-preference tiebreak) that depend
 * on today's exact values for those fields. Swapping in real figures
 * shifted those outcomes, which would be a routing-semantics change this
 * fix is explicitly scoped to avoid — real production latency/cost/
 * rate-limit figures are a follow-up operator/config concern, not part
 * of this defect fix.
 */
export const SEED_MODELS: ModelDescriptor[] = [
  {
    providerId: "groq",
    modelId: "llama-3.1-8b-instant",
    modelClass: "fast-extraction",
    capabilities: {
      contextWindow: 131_072,
      structuredOutput: true,
      streaming: true,
      toolCalling: false,
      reasoningDepth: "shallow",
      creativityScore: 0.2,
    },
    performance: { p50LatencyMs: 180, p99LatencyMs: 420, tokensPerSecond: 560 },
    cost: { inputPer1kTokensUsd: 0, outputPer1kTokensUsd: 0, tier: "free" },
    availability: { enabled: true, rateLimits: { requestsPerMinute: 30, tokensPerMinute: 6000 } },
  },
  {
    providerId: "groq",
    modelId: "llama-3.3-70b-versatile",
    modelClass: "complex-reasoning",
    capabilities: {
      contextWindow: 131_072,
      structuredOutput: true,
      streaming: true,
      toolCalling: true,
      reasoningDepth: "deep",
      creativityScore: 0.4,
    },
    performance: { p50LatencyMs: 650, p99LatencyMs: 1800, tokensPerSecond: 280 },
    cost: { inputPer1kTokensUsd: 0, outputPer1kTokensUsd: 0, tier: "free" },
    availability: { enabled: true, rateLimits: { requestsPerMinute: 30, tokensPerMinute: 6000 } },
  },
  {
    providerId: "groq",
    modelId: "openai/gpt-oss-20b",
    modelClass: "creative",
    capabilities: {
      contextWindow: 131_072,
      structuredOutput: false,
      streaming: true,
      toolCalling: false,
      reasoningDepth: "moderate",
      creativityScore: 0.9,
    },
    performance: { p50LatencyMs: 300, p99LatencyMs: 700, tokensPerSecond: 1000 },
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
