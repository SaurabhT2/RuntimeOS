import type { ModelDescriptor } from "@ai-gateway/model-registry";
import type { ProviderHealthSnapshot } from "@ai-gateway/reliability";
import type {
  CapabilityRequirement,
  ScoredCandidate,
  ScoringWeights,
  StrategySignals,
} from "./types.js";

const REASONING_DEPTH_SCORE: Record<ModelDescriptor["capabilities"]["reasoningDepth"], number> = {
  shallow: 0.3,
  moderate: 0.6,
  deep: 0.9,
};

/**
 * EM-9: architecture §31.2's `preferredModelClasses`, "ordered preference,
 * consumed by Policy Engine scoring" — a candidate matching an earlier
 * (more-preferred) entry scores a bigger bonus; no match scores 0.
 * Capped well below `structuredBonus`'s ceiling contribution so this can
 * never, by itself, overcome a genuinely poor `reasoningTerm`/`creativityTerm`
 * blend — it is a tiebreaker/nudge among already-plausible candidates, not
 * a replacement for the quality blend itself.
 */
function preferredModelClassBonus(modelClass: string, preferredModelClasses?: string[]): number {
  if (!preferredModelClasses || preferredModelClasses.length === 0) {
    return 0;
  }
  const index = preferredModelClasses.indexOf(modelClass);
  if (index === -1) {
    return 0;
  }
  // First preference: 0.15. Each subsequent preference: half the previous
  // bonus, floored at 0.02 so a long list's tail entries still register.
  return Math.max(0.02, 0.15 / 2 ** index);
}

/**
 * architecture §13.3's illustrative `qualityScoreForTask` term. No such
 * function exists on `ModelDescriptor` itself (§14.1's schema has no
 * pre-baked per-task quality field), so this is a deterministic heuristic
 * blending `reasoningDepth` and `creativityScore` by how much the
 * classified task rewards each (Blueprint §7 EM-3 scope: "no cost/
 * capability sophistication yet — static weights"). A curated,
 * benchmark-driven quality signal is v1.1 Strategy Layer territory
 * (architecture §30), not this milestone's.
 */
export function qualityScoreForTask(
  model: ModelDescriptor,
  requirement: CapabilityRequirement,
  strategySignals?: StrategySignals,
): number {
  const reasoningTerm =
    REASONING_DEPTH_SCORE[model.capabilities.reasoningDepth] * requirement.reasoningAffinity;
  const creativityTerm = model.capabilities.creativityScore * requirement.creativityAffinity;
  const affinityTotal = requirement.reasoningAffinity + requirement.creativityAffinity;

  // Weighted average of the two affinity-scaled terms; falls back to a
  // neutral 0.5 in the (practically unreachable, since task-classifier
  // always returns positive affinities) case both affinities are zero.
  const blended = affinityTotal > 0 ? (reasoningTerm + creativityTerm) / affinityTotal : 0.5;

  // Small, additive bonus for structured-output support when the request
  // requires it — rewards a better-fit candidate without needing its own
  // top-level weight (architecture §13.3 lists exactly four weighted
  // terms; this stays inside the `quality` term rather than becoming a
  // fifth).
  const structuredBonus =
    requirement.requiresJsonMode && model.capabilities.structuredOutput ? 0.1 : 0;

  // EM-9: same "stays inside the quality term" discipline as `structuredBonus`.
  const preferenceBonus = preferredModelClassBonus(
    model.modelClass,
    strategySignals?.preferredModelClasses,
  );

  return Math.min(1, blended + structuredBonus + preferenceBonus);
}

/** Min-max normalizes `value` into `[0, 1]` against `min`/`max` observed across the candidate set. A degenerate (single-candidate or all-equal) set normalizes to `1` for every candidate — there is nothing to differentiate. */
export function normalize(value: number, min: number, max: number): number {
  if (max <= min) {
    return 1;
  }
  return (value - min) / (max - min);
}

/**
 * architecture §13.3's `healthMonitor.getHealth(model.providerId).score`.
 * No literal `.score` field exists on `ProviderHealthSnapshot`
 * (`reliability`'s type, architecture §11) — this function derives one
 * deterministically: a perfectly healthy provider scores `1`; each
 * consecutive failure recorded against it (even while still `healthy`,
 * i.e. below `reliability`'s own unhealthy-after-N-failures threshold)
 * degrades the score, and an unhealthy provider is floored at `0.05`
 * (never exactly `0`, so a fully-unhealthy field of candidates can still
 * be ranked relative to each other rather than tying at zero).
 */
export function healthScore(snapshot: ProviderHealthSnapshot): number {
  if (!snapshot.healthy) {
    return 0.05;
  }
  return Math.max(0.1, 1 - snapshot.consecutiveFailures * 0.2);
}

/**
 * architecture §13.3's `penalty_rateLimitPressure(providerId)`. No live
 * request-rate/token-rate usage tracking exists in any EM-3 dependency
 * (that lives in `reliability`'s Circuit Breaker's rolling window, keyed
 * by `(providerId, modelClass)`, not by live RPM/TPM consumption) — so
 * this penalty uses the one piece of *static* rate-limit data already on
 * `ModelDescriptor.availability.rateLimits` (§14.1) as a proxy: a model
 * with a lower configured `requestsPerMinute` ceiling is penalized more,
 * since it has structurally less headroom to absorb traffic regardless of
 * current load. Live headroom tracking is a documented, not-yet-built
 * enhancement (see this package's README, Deferred Work) — appropriate
 * for whichever future milestone wires live provider usage metrics into
 * the Policy Engine.
 */
export function rateLimitPenalty(model: ModelDescriptor): number {
  const rpm = model.availability.rateLimits.requestsPerMinute;
  if (rpm === undefined || rpm <= 0) {
    return 0;
  }
  // Asymptotically approaches 0 as rpm grows; a 30 RPM model (this repo's
  // free-tier seed data) incurs a small but non-zero penalty, a
  // 6000+ RPM model incurs essentially none.
  return Math.min(0.2, 6 / rpm);
}

export interface ScoreCandidateInput {
  model: ModelDescriptor;
  requirement: CapabilityRequirement;
  health: ProviderHealthSnapshot;
  weights: ScoringWeights;
  /** The full candidate set's latency/cost range, for normalization. */
  latencyRange: { min: number; max: number };
  costRange: { min: number; max: number };
  /** EM-9: optional soft nudges derived from a `StrategyDecision`. Omitted entirely (or every field absent) reproduces EM-3/EM-8 scoring exactly. */
  strategySignals?: StrategySignals;
}

/**
 * EM-9: architecture §33.2's table, verbatim: "Can we downgrade providers?
 * ... both consumed as *soft* signals by Policy Engine scoring (Section
 * 13.3's `w_cost` term) — never a hard override." Capped well below 1 so
 * this can never, by itself, make an expensive/paid candidate outscore a
 * genuinely cheaper one on the `cost` term alone — it only breaks ties
 * and nudges among already-close candidates.
 */
function costSignalBonus(model: ModelDescriptor, strategySignals?: StrategySignals): number {
  let bonus = 0;
  if (strategySignals?.recommendedModelClassDowngrade === model.modelClass) {
    bonus += 0.15;
  }
  if (strategySignals?.preferFreeTierProviders && model.cost.tier === "free") {
    bonus += 0.15;
  }
  return bonus;
}

/** Computes one candidate's weighted score (architecture §13.3), with its breakdown retained for testability. */
export function scoreCandidate(input: ScoreCandidateInput): ScoredCandidate {
  const { model, requirement, health, weights, latencyRange, costRange, strategySignals } = input;

  const quality = qualityScoreForTask(model, requirement, strategySignals);
  // "normalize(1 / p50LatencyMs)" — lower latency is better, so the
  // normalization is computed over the *inverted* values, matching
  // architecture §13.3's literal expression.
  const latency = normalize(
    1 / model.performance.p50LatencyMs,
    1 / latencyRange.max,
    1 / latencyRange.min,
  );
  const costBase = normalize(
    1 / Math.max(model.cost.outputPer1kTokensUsd, 1e-9),
    1 / Math.max(costRange.max, 1e-9),
    1 / Math.max(costRange.min, 1e-9),
  );
  const cost = Math.min(1, costBase + costSignalBonus(model, strategySignals));
  const health_ = healthScore(health);
  const penalty = rateLimitPenalty(model);

  const score =
    weights.quality * quality +
    weights.latency * latency +
    weights.cost * cost +
    weights.health * health_ -
    penalty;

  return {
    providerId: model.providerId,
    modelId: model.modelId,
    modelClass: model.modelClass,
    score,
    breakdown: { quality, latency, cost, health: health_, rateLimitPenalty: penalty },
    contextWindow: model.capabilities.contextWindow,
    structuredOutput: model.capabilities.structuredOutput,
    toolCalling: model.capabilities.toolCalling,
    streaming: model.capabilities.streaming,
  };
}

/** Scores every candidate in `models`, computing the latency/cost normalization ranges once across the whole set. */
export function scoreCandidates(
  models: ModelDescriptor[],
  requirement: CapabilityRequirement,
  getHealth: (providerId: string) => ProviderHealthSnapshot,
  weights: ScoringWeights,
  strategySignals?: StrategySignals,
): ScoredCandidate[] {
  if (models.length === 0) {
    return [];
  }

  const latencies = models.map((m) => m.performance.p50LatencyMs);
  const costs = models.map((m) => m.cost.outputPer1kTokensUsd);
  const latencyRange = { min: Math.min(...latencies), max: Math.max(...latencies) };
  const costRange = { min: Math.min(...costs), max: Math.max(...costs) };

  return models.map((model) =>
    scoreCandidate({
      model,
      requirement,
      health: getHealth(model.providerId),
      weights,
      latencyRange,
      costRange,
      strategySignals,
    }),
  );
}
