# ADR-0026: EM-10 Rework — `BudgetLedger.recordSpend` wiring scoped to `execute()`, not `executeStream()`

**Status:** Accepted (EM-10 Independent Architecture & Engineering Review, Finding 1 — Engineering Rework Order)
**Date:** 2026-07-18
**Format:** Context / Decision / Consequences / Alternatives

> **Note on this ADR:** Unlike ADR-0025 (an open question left for the
> Architecture Review Board), this ADR documents a scope boundary the
> rework _did_ decide, per the Rework Order's own instruction to prefer
> "document it through an ADR rather than redesigning RuntimeOS" over
> silently expanding scope. It is filed for transparency and to give the
> Board an explicit, reviewable seam for a future milestone, not because
> the rework itself is blocked on it.

## Context

The EM-10 Independent Architecture & Engineering Review's Finding 1
established that `BudgetLedger.recordSpend` — architecture §43.2's
mechanism for making Budget Governance's tracking "authoritative and
cumulative" (§43.1) — was never invoked by any production code path. The
Rework Order requires this be fixed "after a successful execution has
completed," while preserving Strategy Layer, Policy Engine, and Execution
Orchestrator ownership, and without redesigning RuntimeOS or expanding
EM-10's scope.

`ExecutionOrchestrator` exposes two entry points that reach a Provider
Adapter and incur real cost: `execute()` (used by every non-streaming
caller, and the _only_ entry point `pipeline-orchestrator` ever calls —
architecture §41.1) and `executeStream()` (used by `/v1/execute/stream`,
architecture §17). "Successful completion" is unambiguous for `execute()`:
it either returns an `ExecuteResponse` or rejects with a `GatewayError`.
For `executeStream()` it is not: architecture §17's cancellation semantics
mean a stream can be client-aborted after emitting some chunks (and
therefore after a provider has already incurred some real, non-zero cost)
without ever reaching a `done: true` frame — there is no single "the
response, now record its cost" moment analogous to `execute()`'s `return
response`, and no existing architecture section defines one.

## Decision

This rework wires `onExecutionCompleted` (and therefore
`BudgetLedger.recordSpend`) into `execute()` only. `executeStream()` is
explicitly left unwired, and untouched, by this rework.

This fully satisfies the Rework Order's own explicit requirement —
"ensure pipeline execution follows the same accounting rules" —
because `pipeline-orchestrator` exclusively calls `execute()`; a pipeline
step gets identical, real cumulative accounting to a single request with
zero additional wiring, by construction (they share the same
`orchestrator` instance and the same hook).

Streaming spend-recording is left as a named, disclosed gap rather than:

- **silently left unfixed and undisclosed**, which is the exact failure
  mode Finding 1 itself identified and this ADR exists to avoid repeating; or
- **implemented anyway, using a guessed definition of "successful
  completion" for a partially-streamed, possibly-cancelled response**,
  which would be exactly the kind of unilateral architectural
  interpretation the Rework Order's "do not implement speculative
  improvements" / "if architectural ambiguity exists, document it through
  an ADR rather than redesigning RuntimeOS" instructions ask this rework
  not to do.

## Consequences

- A tenant whose traffic is exclusively (or predominantly) `/v1/execute/stream`
  will not have that traffic's real cost recorded into `BudgetLedger`,
  and Budget Governance's pre-flight `plannedCostUsd` check (§43.3, driven
  by the Cost Optimizer's estimate, not actual spend) remains the only
  budget signal such a tenant experiences. This is an accurate description
  of this rework's coverage, not a claim that streaming spend tracking is
  unimportant — it is scoped out, not dismissed.
- `/v1/execute` and every pipeline step (the entry points this milestone's
  Blueprint scope and the Review's Finding 1 are actually about) are fully
  covered.
- No frozen interface changed to accommodate this: `ExecutionOrchestrator`
  (`execute`/`executeStream`/`cancel`) is unchanged; only
  `ExecutionOrchestratorOptions` (already precedent for optional,
  orthogonal fields — EM-8's `strategyLayer`) gained one new optional field.

## Alternatives considered

1. **Wire `executeStream()` too, recording spend on `done: true`.** Rejected
   for this rework: doesn't address a genuinely cancelled/partial stream's
   cost (which is real, provider-incurred cost the ledger would still
   miss), so it would fix the common case while leaving the same class of
   gap Finding 1 raised, undisclosed, in the harder case. A future
   milestone with an actual architecture-level definition of "how much of
   a cancelled stream's cost counts" is better positioned to do this
   correctly than this rework guessing one.
2. **Record spend speculatively per-chunk, before the stream is known to
   have completed.** Rejected: would record cost for a stream that may
   still fail entirely, contradicting the Rework Order's "do NOT record
   spend for failed executions" requirement, and has no analogue in how
   `execute()`'s single-shot success/failure model works.
3. **Block this entire rework on resolving streaming's semantics first.**
   Rejected: the Review's Finding 1, the Blueprint's EM-10 scope, and
   `pipeline-orchestrator`'s exclusive use of `execute()` are all
   satisfied without it; gating a real, verified fix on an unrelated,
   harder problem would leave the confirmed gap open longer for no
   architectural benefit.
