# ADR-0024: Budget-Related Failures Are Telemetrically Distinct From Provider-Health Failures

**Status:** Accepted (ratifies architecture §46's ADR-015 verbatim; see ADR-0021 for why this repository number, not "0015")
**Date:** 2026-07-17
**Format:** Context / Decision / Consequences / Alternatives

> Ratified from architecture §46's ADR-015 without modification — see
> ADR-0021 for the numbering rationale (0015 is not yet used in
> `docs/adr/`, but is assigned here to keep all three ratifications in one
> contiguous, easy-to-find block, 0022-0024).

## Context

Section 45.4 identified that `BUDGET_EXCEEDED` (a business-policy
outcome, architecture §43.5) and `ALL_PROVIDERS_UNAVAILABLE` (a technical
failure, architecture §19.1) could be conflated in dashboards/alerts if
both simply increment generic error counters, wasting on-call time
distinguishing "we chose to stop spending" from "the providers are
actually down."

## Decision

Budget-related events (`gateway_budget_alert_total`, `BUDGET_EXCEEDED`
occurrences) are emitted to a distinct metric namespace from
provider-health/failover metrics (architecture §21.2), never co-mingled
with `gateway_failovers_total` or circuit-breaker state gauges.

## Consequences

A small addition to the metrics catalogue (§21.2, additive); dashboards
and alert rules must be authored to treat the two namespaces separately,
which is a one-time documentation/runbook cost, not a code complexity
cost.

**Honored by EM-10's implementation:**

- `@ai-gateway/budget-governance`'s `DefaultBudgetEnforcer` emits
  `gateway_budget_alert_total` (for `alert`-type threshold actions) and
  `gateway_budget_block_total` (for a block) — two new, distinctly-named
  metrics, never `gateway_failovers_total` or any circuit-breaker gauge.
  Verified by a dedicated test asserting the actual metric names recorded
  during a block never include `gateway_failovers_total` and that every
  metric this package emits is prefixed `gateway_budget_` — not merely
  claimed in documentation.
- The HTTP-layer distinction is reinforced independently: `BUDGET_EXCEEDED`
  maps to `402 Payment Required`, deliberately different from
  `ALL_PROVIDERS_UNAVAILABLE`'s `503 Service Unavailable` — so the two
  are distinguishable at the metrics layer _and_ the HTTP-status layer,
  not just one or the other.
- `DefaultBudgetEnforcer`'s shadow-mode logging (`budget_governance.shadow_mode_decision`)
  is also its own, distinctly-named log event — not merged into any
  existing provider-health/failover log line.

## Alternatives considered

Reusing existing error-rate metrics and relying on the `reason` field for
post-hoc filtering — rejected because it pushes the distinction into
every consumer's query logic instead of into the emission point once,
which is more error-prone at 2 AM during an actual incident.
