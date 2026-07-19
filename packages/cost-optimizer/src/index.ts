/**
 * @ai-gateway/cost-optimizer
 *
 * A stage of the AI Strategy Layer's Optimization Pipeline (architecture
 * §33): produces model-downgrade, streaming, cache, and free-tier-preference
 * optimization *decisions*. Never talks to a provider directly and never
 * executes routing — it only adjusts the decision a future Policy Engine
 * call will consume.
 *
 * STATUS: implemented (Engineering Milestone EM-7, Blueprint §7, §8.17).
 * Not yet wired into `orchestrator`/`policy-engine` — that wiring is
 * `strategy-layer`'s job (Wave 8, EM-8).
 *
 * Architecture reference: §33
 */

export {
  type CachedResult,
  type CacheKeyStrategy,
  type CacheClient,
  type OptimizationContext,
  type CostOptimizationResult,
} from "./types.js";

export {
  ILLUSTRATIVE_COST_PER_1K_TOKENS_USD,
  costPer1kTokensUsd,
  estimateCostUsd,
} from "./pricing.js";

export { computeReasoningRequired, computeModelClassDowngrade } from "./downgrade.js";

export { computeDisableStreaming } from "./streaming.js";

export { type CostOptimizer, DefaultCostOptimizer, deriveCacheKey } from "./cost-optimizer.js";

export { InMemoryCacheClient } from "./in-memory-cache-client.js";
