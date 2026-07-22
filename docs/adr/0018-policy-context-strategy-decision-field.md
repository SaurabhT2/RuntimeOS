# ADR-0018: `PolicyContext` gains an optional `strategyDecision` field, via a local duplicate type

**Status:** Accepted (implemented as of EM-8)
**Date:** 2026-07-13
**Format:** Context / Decision / Consequences / Alternatives

## Context

Architecture §13.5 states that, as of the AI Strategy Layer landing, _"the Policy Engine
no longer receives a raw `ExecuteRequest` directly... it simply operates on the richer,
pre-resolved `StrategyDecision` instead of the raw request... nothing has changed except
where its input comes from."_ EM-8's own Exit Criteria list, separately, states plainly:
_"Policy Engine consumes `StrategyDecision`."_

Taken completely literally, this would mean changing `PolicyEngine.selectExecutionPlan`'s
frozen signature (architecture §11/§13, Blueprint §6.1's interface-freeze table) from
`(req: ExecuteRequest, ctx: PolicyContext)` to something taking a `StrategyDecision`
instead of (or in addition to) `req`. Two problems make that the wrong resolution for
this milestone specifically:

1. **It would require `policy-engine` to depend on `strategy-layer`** (for the
   `StrategyDecision` type) — but ADR-0016 establishes that `strategy-layer` already
   depends on `policy-engine`... no, ADR-0016 in fact _removes_ that edge (see ADR-0016,
   "Alternatives considered") specifically to avoid this exact problem: had
   `strategy-layer → policy-engine` been kept, adding `policy-engine → strategy-layer`
   here would create a second cycle.
2. **It would violate EM-8's own explicit constraints**: "Zero Breaking Changes," "Do not
   modify existing interfaces unless explicitly required," and, most concretely, the
   milestone's own most-emphasized regression test — "Pass-through Regression: run an
   identical request with Strategy OFF vs. ON; the `ExecutionPlan` must be identical."
   Changing what `selectExecutionPlan` scores against risks exactly the kind of
   observable routing change that test exists to catch, for a milestone whose Out-of-Scope
   list explicitly excludes "Learning Intelligence" and "Adaptive Ranking" — i.e., the
   milestone that would legitimately need Policy Engine's scoring to actually _use_ a
   `StrategyDecision`'s contents is a later one, not this one.

## Decision

`PolicyEngine.selectExecutionPlan`'s signature is unchanged. `PolicyContext`
(architecture §11) gains one new optional field, `strategyDecision?: StrategyDecisionLike`,
where `StrategyDecisionLike` is a small, locally-defined type inside `policy-engine`
structurally mirroring `strategy-layer`'s real, frozen `StrategyDecision` (architecture
§30.3) — the exact same "an allowed dependency edge doesn't exist for importing the
original type, so an equivalent local shape is defined instead" technique this file
already uses one field above, for `RoutingOverrideLike` (mirroring `config`'s
`RoutingOverride`).

`orchestrator` constructs the real `StrategyDecision` (via `strategy-layer`, when the
feature flag is on) and passes it as `ctx.strategyDecision` into the _same_,
unchanged `policyEngine.selectExecutionPlan(req, ctx)` call it always made. This makes
"Policy Engine consumes `StrategyDecision`" literally true — the value is present,
structurally typed, and readable inside `DefaultPolicyEngine`'s own code — without
changing what that code actually _does_ with it. `DefaultPolicyEngine`'s scoring/candidate-
query/routing-rules logic (architecture §13.1–§13.4) does not read `ctx.strategyDecision`
this milestone; it is accepted and ignored, guaranteeing the Pass-through Regression
test's required byte-for-byte identical `ExecutionPlan` output regardless of whether the
Strategy Layer ran.

## Consequences

- Zero risk to `policy-engine`'s existing test suite or scoring behavior — confirmed by a
  new test asserting `selectExecutionPlan`'s output is identical whether
  `ctx.strategyDecision` is present or absent, for the same underlying request.
- A future milestone that actually wants Policy Engine's scoring to be influenced by the
  resolved `StrategyDecision` (e.g., using `requiredCapabilities`/`optimizations.cost`'s
  recommendations as scoring inputs) has a field to read already in place — that would be
  a `policy-engine`-internal logic change requiring its own ADR under the same "changing
  a frozen interface's _behavior_" discipline, not a repeat of this ADR's dependency-shape
  question.
- `StrategyDecisionLike`'s fields are typed loosely enough (see the type itself) to avoid
  needing to import `CapabilitySet`/`ResolvedExecutionProfile`/`CostOptimizationResult`/
  `OptimizedPrompt` from their own packages, none of which `policy-engine` has an edge to
  either — consistent with the same dependency-minimizing stance the rest of this field's
  design already takes.

## Review Finding 4 (EM-8 Independent Architecture & Engineering Review) — status confirmed as Accepted

The Review asked whether this ADR's status should remain **Accepted** or be changed to
**Proposed**, pending Architecture Board confirmation, given this ADR's Context section
quotes architecture §13.5 language ("operates on ... `StrategyDecision` instead of the
raw request") that, read in isolation, is more sweeping than what this ADR actually
implements (an unread, structurally-typed, optional field). Per `docs/adr/README.md`'s own
taxonomy, **Proposed/Draft** is reserved for "a real, verified inconsistency between the
frozen Architecture Specification and the implementation ... None of the open items has
been decided by the Architecture Review Board yet." That is not this ADR: the Engineering
Blueprint (§8.8, `policy-engine`'s Public APIs row) — itself authoritative, not this ADR's
own reasoning — already resolves the apparent tension directly: "as of EM-8, this consumes
a `StrategyDecision` rather than a raw request (architecture §13.5) — a change to the
_caller_, not to this package's own logic." Blueprint §8.8's Future Evolution row goes
further, stating `policy-engine`'s public behavior is "explicitly designed (ADR-008,
architecture §39) to never need to change" as the Strategy Layer evolves above it. This
ADR's decision — signature unchanged, `policy-engine`'s own logic untouched, the value
merely threaded through as data — is a direct implementation of that explicit, permanent
Blueprint-level design principle, not a stopgap awaiting Board reconciliation of a genuine
spec conflict. **Status remains Accepted; no change made.**

## Alternatives considered

**Changing `PolicyContext.routingOverride`'s existing precedent to also carry the
`StrategyDecision`** (reusing that field rather than adding a new one) was rejected:
`routingOverride` is a `config`-sourced, deployment-level override with its own
independent lifecycle; conflating it with a per-request, Strategy-Layer-computed value
would make both harder to reason about and would be a larger, riskier change to an
existing field's meaning than adding one new optional field.

**Leaving `PolicyContext` untouched and instead having `orchestrator` attach the
`StrategyDecision` only to telemetry/logging, not to the Policy Engine call itself** was
considered. It would satisfy "Strategy Layer participates in every request" but not the
separate, explicitly-named Exit Criterion "Policy Engine consumes `StrategyDecision`" —
telemetry is not the Policy Engine. Rejected for that reason.
