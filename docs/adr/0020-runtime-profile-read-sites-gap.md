# ADR-0020: Architecture §37.4's Runtime Profile read sites 3 and 4, and its `streaming`/`timeoutMs` claim, remain unimplemented

**Status:** Proposed (ADR candidate — raised by the EM-9 Independent Architecture & Engineering Review; not yet decided by the Architecture Review Board)
**Date:** 2026-07-15
**Format:** Context / Decision / Consequences / Alternatives

> **Note on this draft:** Not a defect in EM-9's own deliverable. Every
> field this ADR discusses was already unreadable by its intended
> consumer *before* EM-9 (nothing regressed) — EM-9 activated the two of
> architecture §37.4's four Runtime Profile read sites that are actually
> reachable without violating this milestone's "do not modify a frozen
> interface, do not add a new package" constraints, and this ADR records,
> rather than silently drops, the two (plus one narrower schema
> ambiguity) that are not.

## Context

Architecture §37.4 ("Where Runtime Profiles Apply") names four read sites
for the active `RuntimeProfile`:

1. The Execution Profile Registry, to adjust `streaming`, `caching`, and
   `timeoutMs` defaults.
2. The Cost Optimizer, to set `preferFreeTierProviders` and cost ceilings.
3. The Policy Engine's Candidate Query, to filter by `allowedLifecycleStates`.
4. The Retry Engine / Circuit Breaker, to adjust `RetryPolicy.maxAttempts`/backoff
   and breaker thresholds per `reliability.retryAggressiveness`/`failoverAggressiveness`.

EM-9 activates site 2 (already wired at EM-8 — `DefaultCostOptimizer.optimize`
reads `ctx.runtimeProfile.provider.preferFreeTier` directly) and the
`retryPolicy`/`caching` half of sites 1 and 4 (this milestone's
`ExecutionProfileResolutionStage` reorder + merge, `strategy-layer`).
Three narrower gaps remain, none of them new:

**(a) `RuntimeProfile` (§37.2's schema) has no field literally named
`streaming` or `timeoutMs`.** Only `caching.aggressiveness` and
`reliability.retryAggressiveness` map onto a concrete
`ResolvedExecutionProfile` field without inventing an unstated mapping.
§37.4's own prose asserts Runtime Profiles adjust "`streaming` ... and
`timeoutMs` defaults" — a real, verified gap between what §37.4 claims and
what §37.2's schema actually provides a field for. A plausible mapping
exists (e.g. `reliability.failoverAggressiveness` → a shorter/longer
per-attempt `timeoutMs`, favoring fail-fast-and-move-on for `"aggressive"`)
but is not the *only* plausible one, and choosing one silently would be
exactly the kind of invented architecture this review's instructions
forbid.

**(b) Read site 3 (Candidate Query filtering by `allowedLifecycleStates`)
cannot be implemented without adding a `lifecycle` field to `ModelDescriptor`**
(architecture §14.1, frozen) — `runtime-profiles`' own source
(`runtime-profile.ts`) already documents this precisely: "`allowedLifecycleStates`
is still part of `RuntimeProfile`'s schema today, exactly as §37.2
specifies — it simply has no consumer until the Policy Engine's Candidate
Query ... is updated to filter by it" and "`model-registry`'s
`ModelDescriptor` does not have a `lifecycle` field yet — architecture §35
is the specification for it, but adding it is scoped to a different
milestone than this one." EM-9's own instructions ("do not modify any
frozen interface") forbid adding that field this milestone; this gap
predates EM-9 and is unchanged by it.

**(c) Read site 4's Circuit Breaker half (breaker thresholds adjusted by
`failoverAggressiveness`) and read site 3's sibling, `provider.maxProvidersInFailoverChain`
adjusting `DefaultPolicyEngineOptions.maxFallbacks`, have no data path at
all.** `RuntimeProfile` itself is never exposed on `StrategyDecision`
(architecture §30.3, frozen) — only `executionProfile.adjustedBy.runtimeProfileId`,
a bare string identifier, crosses that boundary. `policy-engine` (which
owns `maxFallbacks`) and `reliability`'s `InMemoryCircuitBreaker`
(constructed once, not per-request) have no dependency on `runtime-profiles`
and no field on any type they already receive that carries these two
values forward. Wiring either would need either a new `StrategyDecision`/
`PolicyContext` field (a frozen-interface change) or a materially larger
change than "configuration and feature-flag rollout" (Blueprint §7's own
EM-9 scope) — either way, a decision for the Architecture Board, not an
engineering default to invent here.

## Decision

Record all three as open, Board-level questions rather than resolving any
of them silently. For EM-9 specifically: implement only the two
unambiguous `RuntimeProfile` → `ResolvedExecutionProfile` mappings
(`caching.aggressiveness`, `reliability.retryAggressiveness`), and leave
(a), (b), and (c) exactly as undone as they already were, each documented
at its most relevant source (`ExecutionProfileResolutionStage`'s doc
comment for (a); `runtime-profiles/src/runtime-profile.ts`, pre-existing,
for (b); this ADR for (c), which had no prior documented home).

## Consequences

- Architecture §37.4 should not be read as "fully implemented" on the
  strength of EM-9 alone — two-and-a-fraction of its four read sites are
  live; the rest await either a schema clarification (a) or a Board
  decision on how to thread more Runtime Profile data across a frozen
  interface boundary (b, c).
- A future milestone that does take on (b) or (c) will need, at minimum,
  either an approved `ModelDescriptor.lifecycle` addition (b; likely
  alongside whatever milestone finally executes Architecture's own
  Milestone 9 per ADR-0019's roadmap-numbering finding) or an approved new
  field somewhere between `runtime-profiles` and `policy-engine`/`reliability`
  (c) — this ADR is where that future milestone should start reading, not
  `strategy-layer`'s pipeline stages themselves.
- (a) is the cheapest to close and does not require any new dependency
  edge or frozen-interface change — only an Architecture Board ruling on
  what `streaming`/`timeoutMs` should actually mean per `RuntimeProfile`
  field (most likely candidate: `reliability.failoverAggressiveness`),
  after which implementing it is a same-shape addition to
  `ExecutionProfileResolutionStage`'s existing `adjustRetryPolicy`/`adjustCaching`
  pair.

## Alternatives considered

- **Invent a `streaming`/`timeoutMs` mapping from the closest-sounding
  existing `RuntimeProfile` field and ship it anyway.** Rejected: this
  review's own instructions forbid silently resolving an architecture
  ambiguity, and a wrong guess here is worse than a documented gap — it
  would look implemented while actually encoding an unapproved,
  unreviewed policy choice.
- **Add `ModelDescriptor.lifecycle` now, since it's a small, additive
  field.** Rejected: `runtime-profiles`' own source already scoped this to
  "a different milestone than this one," EM-9's instructions forbid
  modifying frozen interfaces, and per ADR-0019's finding, this field
  likely belongs with whichever future milestone actually executes
  Architecture's own Milestone 9 ("Capability Registry & Model
  Lifecycle") — bundling it into EM-9 would repeat the exact
  milestone-scope conflation ADR-0019 flagged, not avoid it.
- **Add a `runtimeProfile` field directly to `StrategyDecision` to unblock
  (c).** Rejected: `StrategyDecision` is architecture §30.3, frozen;
  EM-9's instructions explicitly forbid this, and it is exactly the kind
  of interface change this ADR defers to the Architecture Board rather
  than makes unilaterally.
