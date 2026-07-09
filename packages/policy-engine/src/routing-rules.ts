import type { PolicyContext, RoutingRule, ScoredCandidate, ScoringWeights } from "./types.js";

/**
 * architecture §13.4: "preferences.prioritize (cost/latency/quality) ...
 * as weight adjustments on top of the raw score." Applied by re-scoring
 * with an adjusted weight vector rather than mutating already-computed
 * scores directly, so the adjustment stays inside the same weighted-sum
 * formula the base score used (architecture §13.3) instead of becoming a
 * separate, undocumented bonus term.
 */
export function applyPrioritization(
  weights: ScoringWeights,
  prioritize: "cost" | "latency" | "quality" | undefined,
): ScoringWeights {
  if (!prioritize) {
    return weights;
  }
  const boost = 1.5;
  return { ...weights, [prioritize]: weights[prioritize] * boost };
}

/**
 * Built-in `RoutingRule` (architecture §13.4's illustrative "this org
 * always prefers Groq for cost reasons"): boosts candidates whose
 * `providerId` appears in `PolicyContext.routingOverride.preferredProviders`,
 * without vetoing the rest — a *soft* preference, matching
 * `RoutingOverride`'s own doc comment describing `preferredProviders` as a
 * hint (`config`'s `RoutingOverride`, mirrored locally per this package's
 * `RoutingOverrideLike`). A hard veto (only ever route to the preferred
 * list) is deliberately not implemented as the default — that stronger
 * behavior belongs to a specific, explicitly-opted-into rule a future
 * milestone's Policy Rules Engine (architecture §13.4) could add, not a
 * silent default every deployment inherits.
 */
export const preferredProvidersRule: RoutingRule = {
  name: "preferred-providers",
  applies(ctx: PolicyContext): boolean {
    return Boolean(ctx.routingOverride?.preferredProviders?.length);
  },
  apply(candidates: ScoredCandidate[], ctx: PolicyContext): ScoredCandidate[] {
    const preferred = new Set(ctx.routingOverride?.preferredProviders ?? []);
    if (preferred.size === 0) {
      return candidates;
    }
    const boost = 0.2;
    return candidates.map((candidate) =>
      preferred.has(candidate.providerId)
        ? { ...candidate, score: candidate.score + boost }
        : candidate,
    );
  },
};

/** architecture §13.2 step 4: prioritization weight adjustment, then any registered `RoutingRule`s, then a stable sort by final score, descending. */
export function rankCandidates(
  candidates: ScoredCandidate[],
  ctx: PolicyContext,
  rules: RoutingRule[],
): ScoredCandidate[] {
  let ranked = candidates;
  for (const rule of rules) {
    if (rule.applies(ctx)) {
      ranked = rule.apply(ranked, ctx);
    }
  }
  return [...ranked].sort((a, b) => b.score - a.score);
}
