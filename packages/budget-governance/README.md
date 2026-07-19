# @ai-gateway/budget-governance

**Status:** implemented (Engineering Milestone EM-10). Enterprise Budget &
Cost Governance (architecture §43): authoritative, cumulative spend
enforcement — distinct from `cost-optimizer`'s (architecture §33) advisory,
single-request savings recommendations. Ships in **shadow mode** by
default (Blueprint §7 EM-10's explicit risk mitigation).

## Public API

- `BudgetPolicy` / `BudgetThresholdAction` — a tenant's spend limits and
  the ordered (low-to-high) actions to take as spend approaches them
  (architecture §43.2, verbatim).
- `BudgetLedger` — tracks spend over time; `InMemoryBudgetLedger` is the
  reference implementation (see "Known gap," below, for why it isn't a
  production-durable one).
- `BudgetPolicyProvider` — where a `BudgetPolicy` comes from;
  `ConfigBackedBudgetPolicyProvider` (backed by `@ai-gateway/config`'s
  `ConfigSource`) and `StaticBudgetPolicyProvider` (a plain in-memory map,
  for tests/small deployments) are both provided.
- `BudgetEnforcer` / `BudgetDecision` — `DefaultBudgetEnforcer.evaluate(tenant,
  plannedCostUsd, providerId)` is the one method this package's every other
  piece exists to support.
- `budgetProviderExclusionRule` — a real, tested `policy-engine` `RoutingRule`
  that is currently unregistered by necessity, not oversight (see "Known
  gap," below).

## Design notes / Engineering Decisions

1. **Shadow mode is the default, not an afterthought.** Blueprint §7
   EM-10's own stated risk: "Budget Enforcer false-positive blocks —
   mitigated by shipping with a 'shadow mode' (log what would have been
   blocked, block nothing) for the first release, promoted to enforcing
   mode only after a burn-in period." `DefaultBudgetEnforcer` always
   *computes* the real decision (so shadow-mode telemetry reflects the
   true would-be outcome), but in `"shadow"` mode (the constructor
   default) the *returned* decision always has `allowed: true` and no
   forced constraints — a fresh deployment enforces nothing until a
   human explicitly passes `mode: "enforcing"`.
2. **A tenant with no configured `BudgetPolicy` experiences nothing.**
   `getPolicy` returning `undefined` short-circuits `evaluate` to
   `{ allowed: true, alertsTriggered: [] }` immediately — no synthesized
   default budget, no accidental enforcement for a tenant nobody
   configured (architecture §45.5's "every addition is optional and
   orthogonal to the simple path," applied here as it was to every prior
   v1.1/v1.2 addition).
3. **The daily/monthly windows are evaluated independently, and the more
   constraining one wins.** A tenant comfortably inside their monthly
   budget but about to blow their daily one still sees the daily
   threshold's action — `Math.max` of the two computed percentages, not
   an average or a monthly-only check.
4. **`downgrade_model`'s target class is a fixed, documented default
   (`"fast-extraction"`), not derived from the triggered threshold.**
   Architecture §43.2's `BudgetThresholdAction` carries no target-class
   field — there is no "downgrade to X" information in the policy itself,
   only the action name. Always downgrading to the platform's cheapest
   defined class is the conservative, always-safe interpretation; a
   per-policy configurable target class is a reasonable future extension,
   not invented here without an explicit field to hang it on.
5. **`forcedModelClassDowngrade` reuses `CostOptimizationResult.recommendedModelClassDowngrade`'s
   exact shape and travel path — no new carrier needed.** `strategy-layer`'s
   `BudgetEnforcementStage` (not this package) applies this by overriding
   the *already-existing* field `cost-optimizer` populated earlier in the
   same pipeline run, exactly the same "a later stage can override an
   earlier one's field, `StrategyDecision`'s own shape is unchanged"
   mechanism EM-9 used for Runtime Profile adjustments. See that stage's
   own doc comment.
6. **The `providerId` parameter, before a provider is chosen.**
   Architecture §43.2's `evaluate(tenant, plannedCostUsd, providerId)`
   assumes a specific provider is already known, but §43.3 places Budget
   Enforcement *before* Policy Engine has selected any candidate — there
   is no "the provider" yet at that point in the pipeline.
   `strategy-layer`'s `BudgetEnforcementStage` passes
   `NO_PROVIDER_SELECTED_YET` (`"*"`) in that position; this package's
   `evaluate` treats that sentinel as "skip the `perProviderSpendCapUsd`
   check, still run the tenant-wide daily/monthly checks in full." Flagged
   as a Draft ADR candidate for the Architecture Board rather than
   silently assumed to be the one correct reading of §43.2's signature.

## Fixed (EM-10 Engineering Rework): `BudgetLedger.recordSpend` production wiring

The EM-10 Independent Architecture & Engineering Review's Finding 1
identified that `recordSpend` was implemented and unit-tested in isolation
but never invoked by any production code path — `dailySpend`/`monthlySpend`
never reflected real traffic, undermining §43.1's "cumulative" tracking
claim for every real deployment. This is now fixed, entirely outside this
package: `@ai-gateway/orchestrator`'s `ExecutionOrchestratorOptions` gained
a generic, optional `onExecutionCompleted` hook (fired once per
successful, non-cache-hit `execute()` call, with the real post-execution
`providerId`/`estimatedCostUsd`), and `gateway-runtime`'s composition root
wires that hook to this package's own `BudgetLedger.recordSpend`. This
package's public interface (`BudgetLedger`, `BudgetEnforcer`,
`BudgetDecision`) did not change at all — the fix lives entirely in how
the rest of the platform calls what was already here. See
`@ai-gateway/orchestrator`'s `onExecutionCompleted` doc comment and
`docs/adr/0026-budget-spend-recording-scope.md` for the full mechanism and
its deliberate (`execute()`-only, not `executeStream()`) scope.
`gateway-runtime`'s `bootstrap.test.ts` now includes end-to-end tests
proving cross-request cumulative accrual through the real execution flow,
in both enforcing and shadow mode, and a pipeline-specific variant — not
just this package's own pre-existing, ledger-mocked unit tests.

## Fixed (EM-10 Engineering Rework): `gateway_budget_alert_total`'s `window` label

The same Review's Finding 2 identified that `emitAlertMetric` always
tagged `window: "day"`, even when a *monthly* threshold — not the daily
one — actually drove the alert. `DefaultBudgetEnforcer.computeRealDecision`
now determines and returns which window drove `percentReached`, and
`evaluate` tags every alert with that real value. No public shape changed:
`BudgetDecision` gained no new field: `window` was already always a
private, internal concern of how this class emits its own telemetry.

## Known gap: `forcedProviderExclusion` is computed but not enforced

`BudgetDecision.forcedProviderExclusion` is computed correctly by
`DefaultBudgetEnforcer` (visible in the returned decision, in shadow-mode
telemetry, and in this package's own tests) but **cannot be applied to a
live request as of EM-10.** Architecture §30.3's `StrategyDecision` — the
only value `strategy-layer` (where Budget Enforcement runs) returns to
`orchestrator` — is frozen and has no field this data can travel through.
`forcedModelClassDowngrade` doesn't have this problem (see design note 5,
above); `forcedProviderExclusion` has no analogous existing field to fold
into. `budgetProviderExclusionRule` (a real, correctly-typed,
independently-tested `policy-engine` `RoutingRule`) exists specifically so
that closing this gap, once the Architecture Board approves a carrier, is
"register this rule and populate one field" rather than new design work —
see `docs/adr/0025-budget-enforcer-provider-id-and-exclusion-gap.md` for
the options left open. (Left as-is by the EM-10 Engineering Rework — the
Rework Order scoped this milestone to Findings 1–3 only, and this gap was
already correctly disclosed rather than newly discovered.)

## Known gap: no durable `BudgetLedger` implementation

`InMemoryBudgetLedger` is process-local and non-durable — a process
restart loses all recorded spend. Architecture's own guidance (§45.2, ADR
013 at architecture §46) is explicit that `BudgetLedger` writes are
"financially-adjacent and durability-sensitive" and recommends a durable
store (Postgres in the reference deployment) with Redis only as a
read-through cache. This repository has no database available to it (the
same constraint `credential-resolver`'s `InMemoryCredentialStore` and
`DbScopeResolver`/`DbSecretSource` document for exactly the same reason) —
a production deployment must supply its own durable `BudgetLedger`
implementation of this package's plain interface.

## Testing strategy

- `budget-enforcer.test.ts`: every `BudgetThresholdAction` (alert,
  downgrade, switch, block) in both shadow and enforcing mode; the
  daily-vs-monthly "more constraining wins" rule; the no-policy-configured
  short-circuit; the `perProviderSpendCapUsd` path with and without
  `NO_PROVIDER_SELECTED_YET`.
- `budget-ledger.test.ts`: day/month window boundaries, per-provider
  filtering, independent tenants never sharing a ledger bucket.
- `budget-policy-provider.test.ts`: `StaticBudgetPolicyProvider` and
  `ConfigBackedBudgetPolicyProvider` (including cache invalidation via
  `ConfigSource.watch`), and schema-rejection of a malformed policy list.
- `budget-routing-rule.test.ts`: `budgetProviderExclusionRule` against a
  hand-built `ctx.budgetDecision` (the mechanism proven correct in
  isolation, independent of the fact that nothing wires it up yet).
- `telemetry.test.ts` (architecture §43.6 / ADR-015): confirms
  `gateway_budget_alert_total`/`gateway_budget_block_total` are emitted
  with a distinct metric name and label set from `gateway_failovers_total`
  and any circuit-breaker/health metric name this repository defines
  elsewhere — a real assertion against the actual metric names in use,
  not merely a claim in this README.

## Dependencies

`core-contracts`, `config` (`ConfigSource`), `telemetry`, `policy-engine`
(`RoutingRule`/`ScoredCandidate`/`PolicyContext` types, for
`budgetProviderExclusionRule` — see "Known gap," above). Matches Blueprint
§4.1's table exactly.

## Architecture reference

§43 (Budget & Cost Governance); §46's ADR-013 (durable ledger
requirement), ADR-014 (referenced by `pipeline-orchestrator` for
`maxSteps`, not this package), ADR-015 (distinct metric namespace).
