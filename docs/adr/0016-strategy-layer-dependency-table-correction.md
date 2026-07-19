# ADR-0016: Corrected `strategy-layer` dependency table (Blueprint §4.1's row is defective)

**Status:** Accepted (implemented as of EM-8)
**Date:** 2026-07-13
**Format:** Context / Decision / Consequences / Alternatives

## Context

Engineering Blueprint §4.1's dependency table lists `strategy-layer`'s direct dependencies as:

```
strategy-layer (integration) | cost-optimizer, prompt-optimizer, learning, policy-engine, orchestrator | §30
```

Direct inspection against what this package actually needs to implement architecture §30
finds this row wrong in two distinct ways:

1. **It is missing four necessary edges.** The Strategy Pipeline (architecture §30.2's
   diagram: `CAP --> PROF --> OPT --> DECISION`) must call the Capability Registry
   (§32), the Execution Profile Registry (§31), and the Runtime Profile Registry (§37)
   directly — `cost-optimizer` alone does not perform this resolution; it only
   _consumes_ an already-resolved `CapabilitySet`/`ResolvedExecutionProfile`/
   `RuntimeProfile` via its frozen `OptimizationContext` (§33.2). `capability-registry`,
   `execution-profile-registry`, and `runtime-profiles` are absent from the table row
   despite being load-bearing. `core-contracts` is also absent, despite
   `AIStrategyLayer.buildStrategy(req: ExecuteRequest, ctx: TenantContext)` (§30.3)
   needing `ExecuteRequest` directly.
2. **It lists `orchestrator` as a dependency of `strategy-layer` — backwards, and a
   cycle.** EM-8's own integration requirement is for the Orchestrator to call the
   Strategy Layer (`Request → Strategy Layer → Policy Engine`, the EM-8 work order's own
   diagram; architecture §30.2's diagram places `AIStrategyLayer` in front of, not
   behind, the Policy Engine that `orchestrator` already calls). Blueprint §6.1's own
   interface-freeze table confirms the intended direction unambiguously: _"`AIStrategyLayer`
   | §30.3 | Consumed by: `orchestrator` | Implemented by: `strategy-layer` integration"_ —
   `orchestrator` is the **consumer**, `strategy-layer` is the **implementation**, which
   means the dependency edge runs `orchestrator → strategy-layer`, not the reverse. If
   `strategy-layer` also depended on `orchestrator` (as §4.1's row literally states),
   the graph would contain a cycle: `orchestrator → strategy-layer → orchestrator`.
   This directly contradicts Blueprint §4.1's own stated invariant — _"No cycles exist in
   this graph by construction... a `dependency-cruiser`/Turborepo graph check that fails
   CI if one is ever introduced"_ — and EM-8's own Architecture Review Board acceptance
   criterion: _"Package dependency rules remain acyclic and compliant."_

Additionally, this ADR found no actual code in this package that needs anything from
`policy-engine` directly: `strategy-layer` produces a `StrategyDecision`; handing it to
the Policy Engine is `orchestrator`'s job (architecture §13.5), not a call `strategy-layer`
itself makes. Keeping an edge with zero real consumers, when four _necessary_ edges are
simultaneously missing from the same row, would compound rather than fix the table's
unreliability.

## Decision

`strategy-layer`'s actual, implemented dependency list is:

```
strategy-layer | core-contracts, capability-registry, execution-profile-registry, runtime-profiles, cost-optimizer, prompt-optimizer, learning | §30
```

`orchestrator` is removed (the cycle). `policy-engine` is removed (no real consumer in
this package's implementation — see Context). `core-contracts`, `capability-registry`,
`execution-profile-registry`, `runtime-profiles` are added (all four load-bearing and
necessary). `.dependency-cruiser.cjs`'s `DEPENDENCY_TABLE` implements this corrected list;
`orchestrator`'s own entry is separately updated to add `strategy-layer` as its new
dependency (the correct direction), per architecture §13.5/§30's design and Blueprint
§6.1's interface-freeze table.

This is filed as Accepted, not Proposed: unlike ADR-0014 (a genuine, judgment-call
tension between two authoritative documents with more than one reasonable resolution),
a literal dependency cycle is not something with two defensible readings — Blueprint
§4.1's own text says cycles must not exist, and the interface-freeze table two sections
later already states the correct direction unambiguously. There is only one
non-contradictory resolution.

## Consequences

- `pnpm graph:check` enforces the corrected graph going forward; a future accidental
  reintroduction of `strategy-layer → orchestrator` (or any other cycle) fails CI.
- Blueprint §4.1's table itself should be corrected to match at the next opportunity —
  this ADR is the record of what changed and why, not a substitute for that edit.
- `strategy-layer` has no edge onto any provider-specific package
  (`providers/groq`, `providers/nvidia-nim`, `provider-sdk`) and no edge onto any
  business-domain package — consistent with EM-8's "No Provider Awareness"/"No Business
  Logic" constraints; this ADR's corrected dependency list does not introduce either.
- Policy Engine's own consumption of the resulting `StrategyDecision` (architecture
  §13.5, Exit Criterion "Policy Engine consumes StrategyDecision") is threaded through
  `PolicyContext` — an already-existing, additive-friendly parameter `orchestrator`
  already passes to `PolicyEngine.selectExecutionPlan` — rather than through a
  `strategy-layer → policy-engine` dependency edge. See this package's README and
  `policy-engine/src/types.ts`'s `StrategyDecisionLike` doc comment for the full
  mechanism, which avoids a _second_ would-be cycle (`policy-engine → strategy-layer`,
  since `strategy-layer` would otherwise depend on `policy-engine` and `policy-engine`
  would need to depend back on `strategy-layer` for the `StrategyDecision` type).

## Alternatives considered

**Keeping `policy-engine` as a `strategy-layer` dependency, for a future direct call**
was considered and rejected: EM-8's own Out-of-Scope list excludes "Learning
Intelligence"/"Adaptive Ranking," and nothing in this milestone's actual required pipeline
(Capability → Execution Profile → Runtime Profile → Prompt Optimization → Cost
Optimization → Learning Hooks → `StrategyDecision`) calls into `policy-engine` — the
Policy Engine is invoked separately, by `orchestrator`, after receiving the
`StrategyDecision`. Adding a currently-unused edge "for later" would repeat the exact
kind of speculative-but-unjustified dependency this codebase's own review discipline
(see the Independent Engineering Review of EM-7, Issue #6) has already flagged once this
milestone's predecessor.

**Resolving the cycle by having `orchestrator` NOT depend on `strategy-layer`, and
instead having `apps/gateway-server`'s composition root call both directly in sequence**
was considered and rejected: this would violate EM-8's own "Thin Orchestrator... Strategy
owns strategy... Orchestrator owns sequencing" constraint by moving sequencing logic (call
Strategy Layer, then Policy Engine) out of the one package (`orchestrator`) whose stated
job is exactly that sequencing, and would make every future hosting target (`apps/vercel-adapter`,
and any future one) responsible for re-implementing the same sequencing rather than
inheriting it for free by depending on `orchestrator`.
