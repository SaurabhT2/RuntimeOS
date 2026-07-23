# ADR-0021: Architecture §46's ADR-013/014/015 ratified into this repository's ADR numbering

**Status:** Accepted (ratifies already-approved architecture text; implemented as of EM-10)
**Date:** 2026-07-17
**Format:** Context / Decision / Consequences / Alternatives

## Context

Architecture Specification §46 ("Architecture Decision Records — v1.2
Additions") contains three fully-written ADRs — numbered **ADR-013**,
**ADR-014**, **ADR-015** — embedded directly in the architecture document
itself, covering Budget Ledger durability/precedence, the pipeline
`maxSteps` cap, and budget-metric telemetry separation respectively. These
numbers collide with this repository's _own_, independently-numbered
`docs/adr/NNNN-*.md` files: `docs/adr/0013-gatewayconfig-runtime-profile-id-field.md`
and `docs/adr/0014-prompt-optimizer-execution-profile-registry-dependency-gap.md`
already exist, filed at EM-6/EM-7, on entirely unrelated topics. `0015` is
not yet used in `docs/adr/`, but would be next in this repository's own
sequence regardless.

This is the same category of finding as ADR-0019 (Architecture §38.2's
"Milestone 8" vs the Engineering Blueprint's "EM-8") and ADR-0020's own
observation about numbering drift between documents that evolve on
different schedules — here, between the architecture spec's own embedded
ADR numbering (reset/continued independently within §46) and this
repository's `docs/adr/` sequence (continuous since ADR-0001). Unlike
those two, this is not a scope or design disagreement — architecture
§46's three ADRs are already-decided, already-approved content; the only
open question is how to make them visible and referenceable inside this
repository's own governance system without a number collision.

## Decision

Ratify architecture §46's three embedded ADRs into `docs/adr/` under this
repository's own next available numbers — **0021** (this document, which
also records the ratification and the collision, rather than a silent
renumbering), and two sibling documents:

- `docs/adr/0022-budget-ledger-durability-and-precedence.md` — ratifies
  architecture §46's ADR-013 verbatim (Budget Ledger durability; Budget
  Enforcer `block` short-circuits before Routing Rules; forced
  downgrades/exclusions from Budget Governance and Routing Rules are
  unioned, never silently overridden).
- `docs/adr/0023-pipeline-max-steps-cap.md` — ratifies architecture §46's
  ADR-014 verbatim (`maxSteps` mandatory platform cap, enforced before any
  step executes).
- `docs/adr/0024-budget-telemetry-namespace-separation.md` — ratifies
  architecture §46's ADR-015 verbatim (budget metrics in a distinct
  namespace from provider-health/failover metrics).

Each ratifying document is deliberately short: Context/Decision/
Consequences/Alternatives copied faithfully from architecture §46,
plus one line cross-referencing this ADR and citing exactly where in this
milestone's implementation each decision is honored (see each document).
None of the three re-opens or re-litigates its architecture-specified
content — this repository is not the place that content was decided, only
the place it also needs to be discoverable via `docs/adr/README.md`'s
index, alongside every other ADR a future engineer might search for by
number or by topic.

Going forward, a future architecture-embedded ADR (§46 or any successor
section) should be ratified into `docs/adr/` the same way, at the next
available repository number, with an explicit cross-reference back to its
architecture-spec origin — exactly as this document does — rather than
assumed to already be discoverable by its architecture-spec-local number
alone.

## Consequences

- `docs/adr/README.md`'s index now has four new entries (0021-0024),
  bringing the total to 24, all cross-referenced to this ADR and to
  architecture §46.
- Anyone searching `docs/adr/` by number for "ADR-013" (this repository's
  own, EM-6-era `0013-gatewayconfig-runtime-profile-id-field.md`) is not
  misdirected to architecture §46's differently-numbered-but-same-name
  content — the ratifying documents use this repository's own next
  numbers (0022-0024), not `0013`/`0014`/`0015`, specifically to avoid
  recreating the exact collision this ADR exists to resolve.
- No code changes result from this ADR — it is a documentation/governance
  action confirming that EM-10's implementation already honors all three
  ratified decisions (see each ratifying document's own "Honored by"
  note).

## Alternatives considered

- **Leave architecture §46's ADR-013/014/015 as the only record of these
  decisions, un-ratified into `docs/adr/`.** Rejected: `docs/adr/README.md`
  is this repository's own stated index of "every ADR a future engineer
  might need to find," and a decision only discoverable by reading the
  full architecture specification top-to-bottom is not actually
  discoverable in practice the same way a numbered `docs/adr/` file is.
- **Renumber architecture §46's ADRs to avoid the collision, in the
  architecture specification itself.** Rejected per this repository's own
  established governance: the Architecture Specification is treated as
  frozen and corrected only via ADR, never a direct rewrite of its prose —
  the same rule ADR-0019 already applied to a different section.
- **Silently treat "ADR-013" as unambiguous from context (architecture
  section vs. repository file) and skip ratification.** Rejected: this is
  exactly the "two things share a name, assume readers will disambiguate
  from context" pattern ADR-0019 already flagged as a real, recurring
  source of confusion in this repository's history — not a hypothetical
  risk this time, but the same failure mode recurring a second time.
