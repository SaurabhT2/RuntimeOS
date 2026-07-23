# ADR-0019: Architecture §38.2's "Milestone 8" and the Engineering Blueprint's "EM-8" name incompatible scopes

**Status:** Proposed (ADR candidate — raised by the EM-8 Independent Architecture & Engineering Review, Finding 3; not yet decided by the Architecture Review Board)
**Date:** 2026-07-14
**Format:** Context / Decision / Consequences / Alternatives

> **Note on this draft:** Not a defect in any single package, and not a
> defect in this milestone's actual implementation — every package
> delivered under "EM-8" correctly implements the Engineering Blueprint's
> own EM-8 entry (Section 7), and the Blueprint itself explicitly frames
> its EM-numbering as an engineering execution sequence distinct from the
> Architecture Specification's roadmap ("in what order, by whom, and with
> what safeguards should a team actually build it," engineering-blueprint.md
> line 5). This ADR exists because the two documents' milestone numbers
> collide on "8" while naming substantially different scopes, and per this
> project's "document, don't silently resolve" rule for cross-document
> architectural findings, that collision is recorded here rather than
> quietly assumed away. This document only describes the conflict and
> lists options; it does not rewrite architecture-spec.md or
> engineering-blueprint.md.

## Context

The Architecture Specification's Roadmap Addendum (§38.2) defines four
distinct, narrowly-scoped milestones:

| Architecture milestone                                          | Scope                                                                                                                                                                                                                                     |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Milestone 8** — Execution Profiles & Strategy Layer Skeleton  | Stand up `strategy-layer` with a **pass-through implementation only** ("resolves a profile but changes nothing yet"); deliverables limited to `ExecutionProfileRegistry` and `StrategyDecision` flowing into the Policy Engine unchanged. |
| **Milestone 9** — Capability Registry & Model Lifecycle         | Decouple task→model mapping via the Capability Registry; add `ModelDescriptor.lifecycle`.                                                                                                                                                 |
| **Milestone 10** — Cost & Prompt Optimization                   | Implement **real (non-pass-through)** `CostOptimizer`/`PromptOptimizer` logic.                                                                                                                                                            |
| **Milestone 11** — Runtime Profiles & Learning Extension Points | Ship `runtime-profiles` and its four read-site integrations; ship `LearningSignalCollector`/`AdaptiveRankingStrategy` (no-op defaults).                                                                                                   |

The Engineering Blueprint's own milestone list (Section 7) groups the same
underlying work completely differently:

| Blueprint milestone                   | Scope                                                                                                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **EM-6**                              | Build (not wire) `capability-registry`, `execution-profile-registry`, `runtime-profiles` — i.e., architecture's Milestone 9 and Milestone 11 content, built early and left unwired.         |
| **EM-7**                              | Build (not wire) `cost-optimizer`, `prompt-optimizer`, `learning`, `plugin-system` — i.e., architecture's Milestone 10 and part of Milestone 11 content, also built early and left unwired. |
| **EM-8** — Strategy Layer Integration | Wire **all** of EM-6/EM-7's packages into `orchestrator` at once — architecture's Milestones 8, 9, 10, and 11 content, combined into a single engineering milestone.                        |

These are not the same sequence wearing different labels: Architecture's
Milestone 8 is explicitly pass-through-only and explicitly excludes the
Capability Registry, real cost/prompt optimization, and Runtime
Profiles/Learning (each deferred to Architecture's own Milestones 9–11).
The Engineering Blueprint's EM-8 — the milestone actually implemented in
this repository, per `docs/architecture/em-8-runtime-flow.md`'s six-stage
pipeline (Capability → Execution Profile → Runtime Profile → Prompt
Optimization → Cost Optimization → Learning Hooks) — integrates all four
of those architecture milestones' content in one pass. (The pass-through
_behavior_ the Blueprint's EM-8 does preserve — identical routing outcomes
whether the Strategy Layer is enabled or not — comes from a different
source: ADR-0018's decision that `policy-engine` does not yet read
`ctx.strategyDecision`, not from the optimization logic itself being
stubbed. `cost-optimizer`/`prompt-optimizer` ship real, tested logic as of
Blueprint EM-7; the Blueprint's own EM-9 entry — "Turn on real
(non-pass-through) cost/prompt optimization ... in production" — describes
a production feature-flag flip, not a code change to those packages.)

This is not an isolated, first-time collision. The same two documents'
milestone/EM numbers already diverge for Milestones/EM 0–7 (e.g.,
Architecture's Milestone 2, "Model Registry & Policy Engine," spans
Blueprint's EM-2 "Reliability, Model Registry, Credential Resolver" and
EM-3 "Policy Engine, Real Provider Adapters, Streaming") — but that
divergence was never surfaced as an ADR because no exit-criteria dispute
turned on it. This one nearly did: ADR-0018's own Context section cites an
"EM-8 Exit Criteria" phrase ("Policy Engine consumes `StrategyDecision`")
that, on inspection, is sourced from neither architecture-spec.md nor
engineering-blueprint.md directly, but from a third, non-authoritative
document (the EM-8 work order) — see this repository's governance rule
that only the Architecture Specification, Engineering Blueprint, and
approved ADRs are authoritative. A reader trying to verify that phrase
against "Milestone 8" in the Architecture Specification would not find it
there (Milestone 8's own stated acceptance criterion is only "A/B test
shows identical routing outcomes pre/post-integration") — they would have
to already know to look in the Blueprint's differently-numbered EM-8 entry,
or in the work order, instead.

## Decision

Record this as an open architecture-governance finding rather than
resolving it silently. For the purposes of this milestone's Review
Closure specifically: the implementation correctly followed the
**Engineering Blueprint's** EM-8 definition (full Wave 6–7 integration),
not the Architecture Specification's narrower Milestone-8 skeleton,
because:

1. The Engineering Blueprint is the document whose stated purpose is
   sequencing engineering work ("in what order, by whom, and with what
   safeguards should a team actually build it") — the actual question this
   milestone's implementers needed answered.
2. Every prior ADR touching this integration (ADR-0016, ADR-0017,
   ADR-0018) and this milestone's own diagram addendum
   (`docs/architecture/em-8-runtime-flow.md`) already use "EM-8" in the
   Blueprint's sense, consistently, throughout the codebase — treating
   Architecture's Milestone 8 as the operative definition instead would
   retroactively contradict work the Architecture Board has not
   objected to at any of the three prior ADRs' filings.
3. Nothing actually shipped in this milestone contradicts Architecture
   §38.2's Milestone 8, 9, 10, or 11's own acceptance criteria — it
   simply delivers all four in one engineering pass rather than four,
   which is a sequencing difference, not a behavioral or interface
   violation of any single one of them.

## Consequences

- This ADR does not by itself resolve the naming collision — that
  requires the Architecture Board to decide, as this repository's
  governance rule for "Proposed/Draft" ADRs requires, one of the options
  below (or another it prefers). Until then, any future reference to
  "Milestone 8" or "EM-8" anywhere in this repository's documentation,
  ADRs, or code comments should specify **which document's numbering** it
  means, rather than relying on the bare number.
- ADR-0018's own Context section (which quotes an "EM-8 Exit Criteria"
  phrase sourced from the non-authoritative work order, not either
  authoritative document) should be read with this ADR's finding in mind:
  that phrase does not appear in Architecture §38.2's Milestone 8
  acceptance criteria. This does not change ADR-0018's own status (see
  ADR-0018's Review Finding 4 note, added the same review pass as this
  ADR) — the Blueprint's own §8.8 independently supports ADR-0018's
  decision — but it is the concrete example of why this numbering
  collision is a real, not merely theoretical, source of confusion.
- Future milestones (Architecture's Milestone 9, 10, 11 content, already
  substantially delivered under the Blueprint's EM-6/EM-7/EM-8) should not
  be re-described as "not yet done" on the strength of Architecture
  §38.2's own milestone numbering — that numbering describes a roadmap
  ordering the Blueprint deliberately did not follow, for good, documented
  reasons (Section 5's wave-based parallelization), not a checklist of
  work still outstanding.

## Alternatives considered

- **Treat "Milestone 8" and "EM-8" as synonyms because they share a
  number.** Rejected: factually wrong, per the scope comparison above —
  Architecture's Milestone 8 explicitly excludes the Capability Registry,
  real cost/prompt optimization, and Runtime Profiles/Learning, all of
  which the actually-shipped `strategy-layer` package includes.
- **Rewrite Architecture §38.2 directly to match the Blueprint's
  grouping.** Rejected per this project's established governance: the
  Architecture Specification is treated as frozen and corrected only via
  ADR, never a direct rewrite of its prose (`em-8-runtime-flow.md`'s own
  stated practice, itself following this same rule).
- **Renumber the Engineering Blueprint's milestones to avoid colliding
  with the Architecture Specification's.** Not this ADR's call to make —
  the Blueprint is equally authoritative and equally frozen; either
  renumbering scheme is a Board-level documentation decision, not an
  engineering one, which is exactly why this is filed as Proposed rather
  than resolved here.
- **Leave the collision undocumented, since the actual shipped code is
  unambiguous even if the numbering is not.** Rejected: ADR-0018's Context
  section already shows this ambiguity leaking into a real ADR's
  reasoning once; leaving it unrecorded risks the same confusion recurring
  in a future milestone's exit-criteria dispute, which is exactly the
  category of finding this repository's ADR process exists to surface
  rather than silently absorb.
