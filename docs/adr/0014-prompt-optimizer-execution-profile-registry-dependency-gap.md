# ADR-0014: `prompt-optimizer` depends on `execution-profile-registry`, which Blueprint §4.1's table doesn't list

**Status:** Proposed (draft — raised during EM-7 implementation, and by the Independent Engineering Review of EM-7; not yet decided)
**Date:** 2026-07-13
**Format:** Context / Decision / Consequences / Alternatives

> **Note on this draft:** Same category of finding as ADR-0006/0009/0010
> (a package's actual, correct implementation of a frozen interface needs a
> dependency edge the summary table doesn't list) — raised here because the
> Independent Engineering Review of EM-7 found that the first draft of this
> package resolved the gap unilaterally (added the edge, explained it in a
> code comment and README) instead of filing this ADR at the same time, in
> violation of `CONTRIBUTING.md`'s explicit "The ADR process" instruction:
> _"Do not resolve an open, proposed ADR by picking one option yourself in
> an unrelated PR — flag it in review and let the Architecture Review Board
> decide."_ The code change itself is not reverted by filing this ADR (see
> Decision, below, for why) — but the governance step that should have
> accompanied it did not happen until now.

## Context

Architecture §34.2 freezes `PromptOptimizer.optimize`'s signature:

```typescript
export interface PromptOptimizer {
  optimize(
    messages: ChatMessage[],
    budget: TokenBudget,
    profile: ResolvedExecutionProfile,
  ): Promise<OptimizedPrompt>;
}
```

`ResolvedExecutionProfile` is `@ai-gateway/execution-profile-registry`'s own
exported type (confirmed by direct inspection: it exists nowhere else in
the codebase). Engineering Blueprint §4.1's dependency table, however,
lists `prompt-optimizer`'s dependencies as `capability-registry`,
`core-contracts` only — no `execution-profile-registry` edge.

These two documents disagree, and both are authoritative. Implementing
§34.2's interface exactly — which this milestone's own instructions require
("do not modify existing interfaces unless explicitly required by the
Blueprint") — is not possible without the edge Blueprint §4.1 omits.

## Decision

**Not yet decided at the Blueprint-table-maintenance level.** `prompt-optimizer`
ships in EM-7 with the `execution-profile-registry` edge added to its
`package.json` and to `.dependency-cruiser.cjs`'s `DEPENDENCY_TABLE`,
because there is no version of this package that both compiles and matches
§34.2 without it — unlike ADR-0006/0009/0010's gaps (which left the
_existing_ code buildable with constructor-supplied defaults while the gap
was decided), there is no non-breaking way to leave this one unresolved in
running code. The edge is additive only: no other package's dependency
edges, and no frozen interface, changes as a result.

What remains genuinely open for the Board:

### Option A — Amend Blueprint §4.1's table to add the edge

- Brings the table back in sync with reality; the simplest resolution.
- Sets a precedent that Blueprint §4.1 is corrected post hoc when an
  implementation surfaces a gap, rather than being treated as immutable
  once a milestone starts — worth an explicit Board position, since other
  packages' tables could have the same latent issue undiscovered.

### Option B — Treat this as a `ResolvedExecutionProfile`-specific carve-out, not a general precedent

- Same practical effect (the edge stays), but frames it narrowly: this
  specific type is unusually central to the Optimization Pipeline (every
  pipeline stage after Execution Profile resolution touches it), so an
  edge onto its owning package is closer to `core-contracts`-level
  ubiquity than an ordinary cross-package dependency.
- Avoids setting a "the table gets amended whenever convenient" precedent,
  at the cost of a slightly ad hoc rule.

## Consequences

- `.dependency-cruiser.cjs` continues to enforce the corrected (edge-added)
  graph regardless of which option the Board later formalizes — CI already
  passes against the graph as shipped.
- If the Board later decides neither option and instead wants
  `PromptOptimizer.optimize`'s signature itself reconsidered (e.g. passing
  only the specific profile fields actually needed, rather than the whole
  `ResolvedExecutionProfile`), that would be an architecture-level
  interface change requiring its own ADR under `CONTRIBUTING.md` §6.3's
  "changing a frozen interface" path — a larger change than this ADR
  proposes to make now.

## Alternatives considered

**Duplicating a local, narrowed copy of `ResolvedExecutionProfile`** (the
pattern this codebase uses for smaller shapes, e.g. `runtime-profiles`'
`TenantRef`/`RetryPolicy` copies) was rejected: `ResolvedExecutionProfile`
is a large, multi-field structural type (inference parameters, retry
policy, streaming/caching/structured-output defaults, `adjustedBy`
provenance) whose whole purpose in this call site is to be read faithfully
by downstream pipeline stages; a narrowed or re-derived copy risks silent
drift from the authoritative shape every time `execution-profile-registry`
evolves it, which the small-type-duplication precedent (e.g. `TaskType`,
which is deliberately near-string-shaped) does not risk to the same degree.
