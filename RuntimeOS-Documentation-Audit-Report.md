# RuntimeOS Documentation Excellence Program (DM-1) — Audit Report

**Role:** Lead Technical Writer / Documentation Architect / Release Documentation Owner
**Scope:** Entire RuntimeOS monorepo documentation — root README, architecture spec,
engineering blueprint, all 26 ADRs, all 22 package READMEs, examples, and every
release-governance document.
**Method:** Every claim below was checked against the implementation directly
(source files, `package.json` dependencies, actual env-var loaders, actual
route wiring) before being reported — documentation was never trusted at
face value, per this program's own philosophy.

This report covers what was found. The companion
[Documentation Improvement Plan](RuntimeOS-Documentation-Improvement-Plan.md)
categorizes the fix for each finding by priority; most Critical and several
High items have already been implemented in place (see that document's
"Completed this pass" column).

---

## Strengths

- **The engineering culture that produces this documentation is unusually
  honest.** `KNOWN_LIMITATIONS.md` discloses its own most damaging gap
  (Budget Governance's `switch_provider` non-functionality) in more detail
  than most teams would volunteer, and cites its sources precisely enough
  that this Board could verify every claim against source code directly.
- **The frozen-document discipline works.** The Architecture Specification
  and Engineering Blueprint are genuinely treated as frozen — corrections
  happen via ADR, not silent rewrites — and this pattern was independently
  confirmed rather than merely repeated from other documents.
- **Package READMEs are near-universal and mostly rich.** All 22 packages
  (`providers/` is correctly excluded as a category directory, not a
  package) have a README; most follow a consistent, useful template
  (Public API, Design notes, Usage example, Dependencies, Architecture
  reference, Testing strategy).
- **`docs/adr/README.md` was accurate and current** even before this pass —
  26 ADRs correctly indexed and classified.
- **Cross-referencing discipline is strong where it exists** — package
  READMEs cite specific architecture section numbers and specific ADRs
  rather than vague pointers, which is what made independent verification
  of this report's findings possible in the first place.

## Weaknesses / Documentation Debt Found

Findings are grouped by what this audit calls the two failure modes seen in
this repository: **staleness** (a document was accurate when written and
was never revisited as the platform grew) and **overstatement** (a document
describes more capability or more risk than the code actually delivers —
the less common but more dangerous direction of drift).

### Staleness

1. **Root `README.md` described a pre-v1.2 platform.** Status line stopped
   at EM-8; milestone table stopped at EM-8; package inventory omitted
   `budget-governance` and `pipeline-orchestrator` entirely; ADR count
   stated as "thirteen" against an actual 26. _(Fixed — full rewrite.)_
2. **`docs/release/DEPLOYMENT.md`'s title and content were v1.0-only.**
   Zero mentions anywhere in the file of `pipeline`, `budget`, or
   `ENABLE_STRATEGY_LAYER` — an operator following it would not learn
   Strategy Layer, Pipeline Orchestration, or Budget Governance exist.
   _(Fixed — retitled, new sections added.)_
3. **`apps/gateway-server/README.md`'s Public API section didn't list
   `POST /v1/execute/pipeline`**, despite the endpoint being real, tested,
   and CHANGELOG headline content. _(Fixed — full endpoint documentation
   added, verified against `packages/gateway-runtime/src/http/routes/execute-pipeline.ts`
   and `validate-pipeline-request.ts`.)_
4. **`docs/release/VERSIONING.md`, `docs/release/SUPPORT_POLICY.md`, and
   `docs/release/README.md`'s index table were all still v1.0-scoped** —
   support policy claimed `v1.0.x` was current; the open-ADR list named
   4 items when 9 are actually open; the release index described
   `RELEASE_NOTES.md`/`KNOWN_LIMITATIONS.md` as "Version 1.0" documents
   when both files, read directly, were already current through v1.2.
   _(Fixed.)_
5. **`docs/release/README.md`'s index was missing a row for
   `DEPLOYMENT-VERCEL.md` entirely**, even though the file exists and is
   referenced from elsewhere. _(Fixed.)_
6. **Milestone-attribution disagreement between `README.md` and
   `CHANGELOG.md`:** README placed `model-registry`/`credential-resolver`
   under EM-3; CHANGELOG placed them under EM-2. Cross-checked against
   `docs/history/IMPLEMENTATION_PROGRESS.md`'s EM-3 scope line, which
   explicitly does _not_ list either package — confirming CHANGELOG's
   attribution is the more likely correct one. _(Fixed — README now
   follows CHANGELOG, with a footnote explaining the reasoning and the
   gap it can't fully close.)_
7. **No standalone `## EM-2` section exists in
   `docs/history/IMPLEMENTATION_PROGRESS.md`** — the document jumps from
   `## EM-1` directly to `## EM-3`. (A parallel `## EM-9` gap was already
   self-flagged by that document's own EM-11 entry before this pass
   started.) _(Fixed — a documentation note added at the EM-1/EM-3
   boundary, cross-referenced from README's footnote, rather than
   inventing content to fill the gap.)_
8. **Five package READMEs (`cost-optimizer`, `prompt-optimizer`,
   `learning`, `plugin-system`) contained stale "not wired in... a future
   `strategy-layer` composition root (EM-8) will..." language, written
   before EM-8 shipped and never revisited after it did.** Verified
   against source individually:
   - `cost-optimizer` and `prompt-optimizer`: **now genuinely wired in and
     invoked** (confirmed via `strategy-layer/src/strategy-layer.ts` and
     the corresponding pipeline stages actually calling `.optimize()`) —
     the "not wired in" claim was simply wrong as of v1.2.
   - `learning`: **partially wired** — its registry is constructed and
     confirmed reachable by `strategy-layer`'s `LearningHookStage`, but
     that stage deliberately never calls `.record()` or `adjustWeights()`
     (no post-execution outcome data is available at that point in the
     pipeline) — a real, nuanced middle ground the original binary
     "not wired in" framing didn't capture.
   - `plugin-system`: **confirmed still not wired in anywhere** (no
     reference to it in `orchestrator` or `strategy-layer` source) — the
     only one of the four where "not wired in" remained accurate, though
     the EM-8-specific prediction needed updating since EM-8 has passed.
     _(All four fixed with source-verified, precise language.)_
9. **Two of `strategy-layer`, `cost-optimizer`, `prompt-optimizer`,
   `learning`, and `plugin-system`'s READMEs were also missing the
   "Dependencies" and "Architecture reference" sections** every earlier
   package (`reliability`, `policy-engine`, `capability-registry`,
   `runtime-profiles`, etc.) includes — a template-consistency gap.
   _(Fixed for all five.)_

### Overstatement (the more consequential category found this pass)

10. **`CHANGELOG.md`, `docs/release/RELEASE_NOTES.md`, and
    `docs/release/KNOWN_LIMITATIONS.md` all stated that v1.2 "promotes
    Budget Governance to Enforcement Mode by default" for any tenant with
    `budgetPolicies` configured.** Traced directly to source
    (`packages/gateway-runtime/src/bootstrap.ts`): `budgetEnforcementMode`
    defaults to `"shadow"` unconditionally — nothing in v1.2 changes that
    default, confirmed by the field's own doc comment
    ("still enforces nothing until this is explicitly set to
    `'enforcing'`") and by `packages/budget-governance/README.md`'s own
    framing ("shadow mode is the default, not an afterthought"). This is
    the more dangerous direction of documentation drift — three
    "authoritative" release documents overstating what ships, in a way
    that (had it gone the _other_ direction, understating a real
    enforcement default) could have meant an operator was surprised by
    live spend-blocking behavior they didn't know was active. _(Fixed
    across all three documents.)_
11. **A previously-undocumented, more consequential gap surfaced while
    verifying finding #10: `apps/gateway-server` — the only deployable
    application in this repository — exposes no environment variable or
    `GATEWAY_CONFIG_PATH` field for `budgetPolicies` or
    `budgetEnforcementMode` at all.** Confirmed by inspecting
    `apps/gateway-server/src/server-config.ts` (populates every other
    `GatewayRuntimeConfig` field from `process.env`, including
    `enableStrategyLayer`, but neither budget field) and
    `apps/gateway-server/src/index.ts` (passes that config to
    `bootstrap()` unmodified). **Practical effect: the published gateway
    binary can never construct Budget Governance, in any mode, regardless
    of environment configuration** — a deployment must write custom
    composition-root code calling `bootstrap()` directly to use this
    feature at all. This had not been documented anywhere prior to this
    pass. _(Fixed — new `KNOWN_LIMITATIONS.md` §9.3, new `DEPLOYMENT.md`
    sections with a worked code example, new notes in
    `apps/gateway-server/README.md`, `CHANGELOG.md`, `RELEASE_NOTES.md`,
    and `README.md`.)_

## Missing Documents

- No dedicated **Migration Guide** exists for callers moving from a
  pre-Strategy-Layer integration to one using `enableStrategyLayer`,
  Pipeline Orchestration, or Budget Governance — DM-1's Phase 8 lists this
  as an expected release document. _(Not created this pass — see Plan,
  "Medium.")_
- No worked example demonstrating Strategy Layer, Pipeline Orchestration,
  or Budget Governance from a caller's perspective — both shipped example
  clients (`examples/minimal-node-client`, `examples/streaming-client`)
  only exercise `POST /v1/execute`/`POST /v1/execute/stream`. _(Not
  created this pass — see Plan, "High.")_
- No platform-level architecture diagram for newcomers exists separate
  from the 2,673-line frozen spec (one narrow exception:
  `docs/architecture/em-8-runtime-flow.md`, which covers only EM-8's flow).

## Duplicated / Overlapping Documentation

- None found that constitutes a genuine content fork (two documents
  disagreeing on the same fact were treated as staleness/overstatement
  findings above, not duplication). `docs/release/RELEASE_NOTES.md`
  intentionally repeats some content from `CHANGELOG.md` in a
  user-facing register — this is appropriate audience-specific
  duplication, not debt, and both are now consistent with each other and
  with source.

## Misleading / Incomplete Documentation

Covered under "Overstatement," above (#10, #11) — the two most
significant misleading-documentation findings from this audit.

## Poorly Organized Documentation

- Root `README.md` had no way for a reader to identify which document was
  "theirs" — a Product stakeholder, an Enterprise Architect, a Platform
  Engineer, an Application Developer, and a Runtime Operator all had to
  read the same linear document to find their entry point. _(Fixed — new
  "Find what you need — by role" table added to the top of `README.md`.)_
- No glossary existed anywhere for platform-specific vocabulary
  (`TaskType`, `ExecutionPlan`, `StrategyDecision`, Runtime Profile vs.
  Execution Profile, Shadow mode, BYOK). A newcomer had to infer these
  from context scattered across the architecture spec. _(Fixed — a
  "Terminology" section added to `README.md`.)_

## Priority Fixes

See the companion
[Documentation Improvement Plan](RuntimeOS-Documentation-Improvement-Plan.md)
for the full Critical/High/Medium/Low breakdown, effort estimates, and
which items are already complete as of this pass.
