# ADR-0022: Budget Ledger Is Durably Stored, Separate From Ephemeral Rate-Limit/Health State; Budget Enforcement Precedence Is Explicit

**Status:** Accepted (ratifies architecture §46's ADR-013 verbatim; see ADR-0021 for why this repository number, not "0013")
**Date:** 2026-07-17
**Format:** Context / Decision / Consequences / Alternatives

> Ratified from architecture §46's ADR-013 without modification — see
> ADR-0021 for why this is filed under this repository's own next number
> rather than "0013" (already used, on an unrelated topic, since EM-6).

## Context

Section 45.1/45.2's self-review identified two related risks: (a) Budget
Governance and Routing Rules can both attempt to constrain the same
Policy Engine candidate set with no defined precedence, and (b) the
Budget Ledger was implicitly going to share Redis with genuinely
ephemeral state (rate limits, health), which tolerates loss in a way
financial-adjacent budget data should not.

## Decision

`BudgetLedger` (architecture §43.2) is backed by the durable
Config/Credential DB (§23.1's Postgres), with Redis used only as a
read-through cache — never the source of truth. Precedence is fixed: a
Budget Enforcer `block` decision short-circuits before Routing Rules are
evaluated; forced downgrades/exclusions from Budget Governance and
Routing Rules are unioned (both applied), never one silently overriding
the other.

## Consequences

One additional durability guarantee to operate (DB writes on the
budget-check path, not just Redis reads); fully deterministic, documented
behavior when multiple constraint sources fire on one request.

**Honored by EM-10's implementation:**

- **Durability:** `@ai-gateway/budget-governance`'s `InMemoryBudgetLedger`
  is explicitly documented (that package's own README, "Known gap: no
  durable `BudgetLedger` implementation") as a reference/test
  implementation, not the durable one this ADR requires — the same,
  already-established pattern as `credential-resolver`'s
  `InMemoryCredentialStore` for the same "no database available in this
  repository" reason. A production deployment must supply its own durable
  `BudgetLedger` implementing this package's plain interface.
- **Block short-circuits before Routing Rules:** `BudgetEnforcementStage`
  runs entirely inside `strategy-layer`'s pipeline, before
  `orchestrator` ever calls `policy-engine`'s `selectExecutionPlan` (where
  Routing Rules, §13.4, are evaluated) — a `{allowed: false}`
  `BudgetDecision` throws a `GatewayError("BUDGET_EXCEEDED", ...)`
  structurally before Policy Engine, and therefore before Routing Rules,
  ever run for that request. Not merely a documented convention — the
  call graph makes any other order impossible.
- **Unioned, not overridden, forced downgrades/exclusions:** `budgetProviderExclusionRule`
  (`@ai-gateway/budget-governance`) is designed to run alongside
  `preferredProvidersRule` in `policy-engine`'s own `rankCandidates`,
  which applies every registered rule, not "the first one that matches" —
  the union this ADR requires is how `rankCandidates` already treats
  multiple rules, by construction. (`budgetProviderExclusionRule` is not
  yet registered by any composition root as of EM-10 — see ADR-0025 for
  why and what's still needed — but the union behavior this ADR requires
  is a property of the mechanism it would be registered into, not
  something EM-10 needs to add separately.)

## Alternatives considered

Leaving the Budget Ledger in Redis alongside rate limits — rejected once
the durability mismatch was made explicit in review; leaving precedence
undefined and "whichever runs last wins" — rejected as non-deterministic
and untestable.
