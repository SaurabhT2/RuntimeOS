# ADR-0025: `BudgetEnforcer.evaluate`'s `providerId` parameter, and `forcedProviderExclusion`'s missing carrier to Policy Engine

**Status:** Proposed (ADR candidate — raised during EM-10's implementation; not yet decided by the Architecture Review Board)
**Date:** 2026-07-17
**Format:** Context / Decision / Consequences / Alternatives

> **Note on this draft:** Neither issue below is a defect in EM-10's own
> deliverable — both are genuine, verified gaps between what architecture
> §43.2's interface signature and §43.3's pipeline placement literally
> require and what a frozen interface (`StrategyDecision`, §30.3) can
> actually carry at that point in the pipeline. Filed per this milestone's
> "document any discrepancy, do not silently resolve conflicts" instruction
> — the same discipline ADR-0019/0020 already established for equivalent
> EM-8/EM-9 findings.

## Context

**(a) `BudgetEnforcer.evaluate(tenant, plannedCostUsd, providerId)`'s
`providerId` parameter assumes a specific provider is already known.**
Architecture §43.3 places Budget Enforcement "as the last step of the
Optimization Pipeline ... immediately before the `StrategyDecision` is
handed to the Policy Engine" — i.e., *before* Policy Engine's Candidate
Query/Scoring/Ranking (§13.2) has selected, or even enumerated, any
candidate. At that point in the pipeline, there is no "the provider" for
`perProviderSpendCapUsd` to check against. `@ai-gateway/budget-governance`'s
`NO_PROVIDER_SELECTED_YET` sentinel (`"*"`) is this milestone's resolution:
`BudgetEnforcementStage` passes it, and `DefaultBudgetEnforcer.evaluate`
treats it as "skip the per-provider cap check, still run the tenant-wide
daily/monthly checks in full." This is a reasonable, documented, tested
reading of the interface — but it is a reading, not the only one §43.2's
signature admits, and this milestone is not positioned to declare it the
one correct interpretation unilaterally.

**(b) `BudgetDecision.forcedProviderExclusion` has no carrier from
`strategy-layer` (where it's computed) to `policy-engine` (where it would
need to be applied).** `forcedModelClassDowngrade` doesn't have this
problem: it's folded into the *already-existing*
`optimizations.cost.recommendedModelClassDowngrade` field
(`BudgetEnforcementStage`), which was already part of `StrategyDecision`
(§30.3) and already flows to `policy-engine` (EM-9's activation).
`forcedProviderExclusion` has no analogous existing field — `StrategyDecision`
is frozen, and `AIStrategyLayer.buildStrategy`'s return type (the *only*
channel from `strategy-layer` to `orchestrator`) cannot be widened without
violating that freeze. `@ai-gateway/budget-governance`'s
`budgetProviderExclusionRule` is a real, independently-tested
`policy-engine` `RoutingRule` that reads a `ctx.budgetDecision` field
nothing currently populates — correct and ready, not yet reachable.

Both gaps are downstream of the same root cause: architecture §43's design
was specified assuming data can move freely between the Optimization
Pipeline and the Policy Engine, but §30.3's frozen `StrategyDecision` is
the only channel between them, and it wasn't designed with Budget
Governance's specific needs in mind (unsurprising — §30.3 predates §43 by
several milestones).

## Decision

Record both as open, Board-level questions rather than resolving either
unilaterally. For EM-10 specifically:

- (a) is implemented via `NO_PROVIDER_SELECTED_YET`, documented at its
  definition (`budget-governance`'s `budget-enforcer.ts`) and in that
  package's README, "The `providerId` parameter, before a provider is
  chosen." Not changed further pending Board input.
- (b) is *not* implemented — `forcedProviderExclusion` is computed
  correctly (visible in `BudgetDecision`, in shadow-mode telemetry, and in
  `budget-governance`'s own tests) but has no effect on a live request.
  `budgetProviderExclusionRule` exists, tested, unregistered — ready for
  whichever resolution the Board picks below.

Options for a future milestone, once the Architecture Board rules:

1. **Add an optional field to `StrategyDecision` carrying forced
   provider-exclusion data** (e.g. `budgetDecision?: { forcedProviderExclusion?: string[] }`,
   or fold it directly as a new optional top-level field). Requires an
   architecture-level decision to amend §30.3 — the frozen interface this
   milestone's instructions forbid touching unilaterally.
2. **Add a `providerId`-scoped variant of `evaluate` that Policy Engine
   itself calls per-candidate**, moving Budget Enforcement from "one
   pre-check before Policy Engine" to "a per-candidate filter inside
   Candidate Query" — closer to how capability filtering already works,
   but a more invasive change to §43.3's specified pipeline placement, and
   would need `policy-engine` to gain a direct dependency on
   `budget-governance` (currently the reverse), a package-boundary change
   this milestone's instructions also forbid unilaterally.
3. **Accept `forcedModelClassDowngrade`-only enforcement as sufficient**
   for the v1.2 timeframe, treating `forcedProviderExclusion` as a
   documented, deliberate limitation rather than a gap to close soon —
   the "authoritative" language in §43.1 is satisfied by the block path
   (which needs no new carrier) and the downgrade path (which reuses an
   existing one); only the "force a provider switch while still allowing
   the request to proceed" case is affected.

This ADR does not pick one of the three — that is the Architecture
Board's call, informed by how often a real deployment's `BudgetPolicy`
actually configures `switch_provider` thresholds relative to `block`/`downgrade_model`
ones (a question this milestone has no production data to answer).

## Consequences

- A `BudgetPolicy` configuring a `switch_provider` threshold action today
  gets a `BudgetDecision.forcedProviderExclusion` value that is correctly
  computed but has no observable effect on routing — `DefaultBudgetEnforcer`'s
  own tests demonstrate the *decision* is right; nothing in this milestone
  claims the *enforcement* of that specific action is complete. Documented
  in `budget-governance`'s README so this isn't discovered by surprise in
  production.
- Whichever option the Board picks, `budgetProviderExclusionRule` is
  already the correct, tested implementation of the "apply the exclusion"
  half — closing this gap is "pick a carrier and wire it," not new design
  work on the routing side.

## Alternatives considered

- **Invent a carrier now (e.g., a module-level side channel between
  `strategy-layer` and `orchestrator`) rather than wait for a Board
  decision.** Rejected: this would be exactly the kind of architecture
  workaround this project's governance exists to prevent — a side channel
  bypassing the documented `AIStrategyLayer.buildStrategy` →
  `StrategyDecision` → `orchestrator` data flow is a bigger, less visible
  deviation than the documented gap it would "fix."
- **Treat `NO_PROVIDER_SELECTED_YET` as definitely wrong and block on a
  Board ruling before shipping any Budget Governance at all.** Rejected:
  Blueprint §7 EM-10's own shadow-mode-first rollout plan is specifically
  designed to let real behavior (including this interpretation) be
  observed and corrected before enforcement is ever turned on — shipping
  a documented, reasonable interpretation in shadow mode is lower-risk
  than blocking the whole milestone on a Board session.
