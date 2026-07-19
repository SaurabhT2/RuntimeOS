import type { PolicyContext, RoutingRule, ScoredCandidate } from "@ai-gateway/policy-engine";
import type { BudgetDecision } from "./types.js";

/**
 * `PolicyContext` (architecture: "designed, not specified" — see
 * `policy-engine`'s own doc comment on that type) has no `budgetDecision`
 * field today. This is a structural-intersection type, not an edit to
 * `policy-engine`'s actual declaration — the same technique this file's
 * doc comment below explains is the whole point of shipping it this way.
 */
export type PolicyContextWithBudgetDecision = PolicyContext & { budgetDecision?: BudgetDecision };

/**
 * architecture Blueprint §4.1: `budget-governance` depends on `policy-engine`
 * "(Routing Rules interface)" — this is that dependency's entire
 * justification: a real, correctly-typed, unit-tested `RoutingRule`
 * implementing architecture §43.1's "force a provider switch" via the
 * exact mechanism (§13.4's Routing Rules) Budget Governance is specified
 * to reuse rather than inventing a second one.
 *
 * **Currently unregistered, by necessity, not by oversight.** No code path
 * in this repository populates `ctx.budgetDecision` on a live
 * `PolicyContext` — `orchestrator` builds `PolicyContext` from the
 * `StrategyDecision` `strategy-layer` returns (architecture §30.3, frozen),
 * and that frozen shape has no field a `BudgetDecision` computed *inside*
 * `strategy-layer`'s own pipeline (`BudgetEnforcementStage`) can travel
 * through to reach `orchestrator`, let alone this rule. `forcedModelClassDowngrade`
 * doesn't have this problem — it's folded into the *already-existing*
 * `optimizations.cost.recommendedModelClassDowngrade` field
 * (`BudgetEnforcementStage`, `strategy-layer`) instead of needing a new
 * carrier. `forcedProviderExclusion` has no analogous existing field to
 * fold into. See this milestone's Draft ADR and this package's README,
 * "Known gap: forcedProviderExclusion is computed but not enforced," for
 * the full reasoning and the options left for the Architecture Board.
 *
 * This rule is real and independently tested (`test/budget-routing-rule.test.ts`)
 * against a hand-built `ctx.budgetDecision` — proving the *mechanism*
 * works — precisely so that the day the Architecture Board approves a
 * carrier for this data, wiring it in is "register this already-correct
 * rule and populate one field," not new design work.
 */
export const budgetProviderExclusionRule: RoutingRule = {
  name: "budget-provider-exclusion",
  applies(ctx: PolicyContext): boolean {
    const withBudget = ctx as PolicyContextWithBudgetDecision;
    return Boolean(withBudget.budgetDecision?.forcedProviderExclusion?.length);
  },
  apply(candidates: ScoredCandidate[], ctx: PolicyContext): ScoredCandidate[] {
    const withBudget = ctx as PolicyContextWithBudgetDecision;
    const excluded = new Set(withBudget.budgetDecision?.forcedProviderExclusion ?? []);
    if (excluded.size === 0) {
      return candidates;
    }
    const filtered = candidates.filter((c) => !excluded.has(c.providerId));
    // Never produce an empty candidate set from an exclusion alone — a
    // budget-driven provider exclusion narrowing routing to zero options
    // should surface as an explicit, later `ALL_PROVIDERS_UNAVAILABLE`-style
    // decision made deliberately elsewhere, not as this rule silently
    // emptying the list Ranking (architecture §13.2 step 4) then has
    // nothing to rank.
    return filtered.length > 0 ? filtered : candidates;
  },
};
