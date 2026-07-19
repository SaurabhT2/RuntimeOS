import { computeModelClassDowngrade, computeReasoningRequired } from "./downgrade.js";
import { estimateCostUsd } from "./pricing.js";
import { computeDisableStreaming } from "./streaming.js";
import type { CostOptimizationResult, OptimizationContext } from "./types.js";

/** architecture §33.2, verbatim. */
export interface CostOptimizer {
  optimize(ctx: OptimizationContext): Promise<CostOptimizationResult>;
}

/**
 * architecture §33.2's cache-key derivation isn't specified — `OptimizationContext`
 * (frozen verbatim per this milestone's Blueprint §4.1/§8.17 scope) carries
 * only a `promptTokenEstimate`, not the raw prompt content a real
 * content-hash cache key would need. That's a deliberate pipeline-ordering
 * property, not an oversight: architecture §33.3's diagram places the cache
 * lookup *before* prompt content is available to this stage in the
 * illustrative flow, while §33.2's frozen interface attaches the lookup to
 * this package's own output. Reconciling those two views with an actual
 * content-hash key is `strategy-layer`'s job once real prompt content is
 * threaded through end-to-end (EM-8) — this package derives a documented,
 * best-effort proxy key from the fields it actually has: task + resolved
 * profile id + token estimate, which is exact-match-correct for identical
 * requests and is upgraded to a true content hash by whichever future
 * caller has the raw messages available.
 *
 * ⚠️ **Independent Engineering Review of EM-7, Issue #10:** this key is
 * collision-prone by construction — two structurally different prompts
 * that happen to share the same task, resolved profile, and token-estimate
 * bucket will collide and receive each other's cached response. That is
 * fine for this milestone (nothing calls `optimize()` in a live request
 * path yet, so no incorrect response is ever actually served), but it is
 * **not safe to wire into EM-8's `strategy-layer` unmodified**. Whoever
 * builds that integration must replace this with a real content hash (or
 * pass one in) before `cacheHit` results are ever returned to a caller.
 */
export function deriveCacheKey(ctx: OptimizationContext): string {
  return `${ctx.task}:${ctx.profile.id}:${ctx.promptTokenEstimate}`;
}

/**
 * architecture §33's Cost Optimizer (§33.1: "a stage of the Strategy
 * Layer's Optimization Pipeline... It never talks to a provider directly —
 * it only adjusts the `StrategyDecision`"). This implementation produces
 * optimization *decisions* only, exactly as this milestone's scope requires
 * — it never executes routing, never calls `policy-engine`, and is not
 * wired into `orchestrator` (that integration is EM-8's job, Blueprint §7).
 */
export class DefaultCostOptimizer implements CostOptimizer {
  async optimize(ctx: OptimizationContext): Promise<CostOptimizationResult> {
    const cacheHit = await ctx.cache.lookup(deriveCacheKey(ctx), ctx.profile.caching.keyStrategy);

    const reasoningRequired = computeReasoningRequired(ctx.capabilities, ctx.promptTokenEstimate);
    const recommendedModelClassDowngrade = computeModelClassDowngrade(
      ctx.profile,
      ctx.capabilities,
      reasoningRequired,
    );
    const disableStreaming = computeDisableStreaming(ctx.profile, ctx.capabilities);
    const preferFreeTierProviders = ctx.runtimeProfile.provider.preferFreeTier;

    const baselineModelClass = ctx.profile.preferredModelClasses[0] ?? "fast-extraction";
    const chosenModelClass = recommendedModelClassDowngrade ?? baselineModelClass;
    const estimatedCostUsd = estimateCostUsd(chosenModelClass, ctx.promptTokenEstimate);
    const naiveCostUsd = estimateCostUsd(baselineModelClass, ctx.promptTokenEstimate);
    const estimatedSavingsUsd = Math.max(0, naiveCostUsd - estimatedCostUsd);

    return {
      recommendedModelClassDowngrade,
      reasoningRequired,
      disableStreaming,
      cacheHit,
      preferFreeTierProviders,
      estimatedCostUsd,
      estimatedSavingsUsd,
    };
  }
}
