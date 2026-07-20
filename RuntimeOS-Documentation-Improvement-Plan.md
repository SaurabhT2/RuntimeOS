# RuntimeOS Documentation Excellence Program (DM-1) — Improvement Plan

Companion to the
[Documentation Audit Report](RuntimeOS-Documentation-Audit-Report.md).
Each item is categorized by priority, given an effort estimate, and marked
with its status as of this documentation pass. Effort estimates are
t-shirt sizes for a single technical writer familiar with this codebase:
**XS** (<1 hr), **S** (1–3 hrs), **M** (half a day), **L** (1–2 days),
**XL** (3+ days / needs engineering input, not documentation-only).

---

## Critical

Documents that actively mislead a reader about what the platform does, or
that omit the platform's headline current-release capabilities from the
one place a reader is most likely to look first.

| # | Item | Effort | Status |
|---|---|---|---|
| C1 | Correct the "Budget Governance promoted to Enforcement Mode by default" overstatement in `CHANGELOG.md`, `RELEASE_NOTES.md`, `KNOWN_LIMITATIONS.md` §9.2 | M | **✅ Done this pass** |
| C2 | Document the newly-verified `apps/gateway-server` Budget Governance config-surface gap (new `KNOWN_LIMITATIONS.md` §9.3) | M | **✅ Done this pass** |
| C3 | Rewrite root `README.md` for v1.2: status, milestone table, full package inventory, correct ADR count | L | **✅ Done this pass** |
| C4 | Update `docs/release/DEPLOYMENT.md` for v1.2: `ENABLE_STRATEGY_LAYER` env var, Pipeline Orchestration, Budget Governance (incl. the config-surface gap and a worked custom-`bootstrap()` example) | L | **✅ Done this pass** |
| C5 | Add `POST /v1/execute/pipeline` to `apps/gateway-server/README.md`'s Public API section | M | **✅ Done this pass** |
| C6 | Reconcile `RELEASE_CHECKLIST.md` against what actually shipped — either produce evidence it was run for v1.2, or accept it wasn't and treat that as a process gap going forward | S | ⬜ Not started — this is a process/governance action, not a documentation-content edit; flagged for the release owner, not silently resolved here |

## High

Real gaps that materially help a specific audience, but don't actively
mislead anyone in the meantime.

| # | Item | Effort | Status |
|---|---|---|---|
| H1 | Update `VERSIONING.md`, `SUPPORT_POLICY.md`, `docs/release/README.md` index — remove stale "v1.0" scoping, fix open-ADR count (4→9), add missing `DEPLOYMENT-VERCEL.md` row | S | **✅ Done this pass** |
| H2 | Reconcile the EM-2/EM-3 package-attribution disagreement between `README.md` and `CHANGELOG.md` | S | **✅ Done this pass** — README now follows CHANGELOG's attribution, with a footnote |
| H3 | Add a documentation note for the missing `## EM-2` section in `IMPLEMENTATION_PROGRESS.md` (the `## EM-9` gap was already self-flagged before this pass) | S | **✅ Done this pass** |
| H4 | Correct stale "not wired in / future EM-8" claims in `cost-optimizer`, `prompt-optimizer`, `learning`, `plugin-system` READMEs, verified individually against source | M | **✅ Done this pass** |
| H5 | Add missing "Dependencies"/"Architecture reference" sections to `cost-optimizer`, `prompt-optimizer`, `learning`, `plugin-system`, `strategy-layer` READMEs for template consistency | M | **✅ Done this pass** |
| H6 | Add a "Find what you need — by role" audience map and a "Terminology" glossary to root `README.md` | M | **✅ Done this pass** (folded into the C3 rewrite) |
| H7 | Add at least one example demonstrating Pipeline Orchestration and/or Strategy Layer configuration end-to-end (the two shipped examples only exercise single-step `/v1/execute`) | L | ⬜ Not started — would add a new `examples/` directory; deliberately deferred rather than rushed, since a poorly-verified example is worse than none |
| H8 | Write a Migration Guide for callers adopting `enableStrategyLayer`, Pipeline Orchestration, or Budget Governance on top of an existing v1.0 integration | L | ⬜ Not started |

## Medium

Improvements that raise document quality without closing an active gap.

| # | Item | Effort | Status |
|---|---|---|---|
| M1 | Add a platform-level architecture diagram (Mermaid) for newcomers, distinct from the 2,673-line frozen spec | M | ⬜ Not started |
| M2 | Genericize or verify the specific hostname in `DEPLOYMENT.md`'s "Reference deployment" section — worth a second look for an enterprise-facing document, though this audit found no evidence it's inaccurate, only that it reads unusually specific | XS | ⬜ Flagged, not changed — no clear evidence of a problem, just a style question for the release owner |
| M3 | Standardize the remaining EM-6-era package headings (`capability-registry`, `execution-profile-registry`, `runtime-profiles`) against the same template used elsewhere, even though all three already have Dependencies/Architecture reference sections — minor heading-order consistency only | S | ⬜ Not started — lower value than H5's packages, which were missing whole sections rather than just reordered ones |
| M4 | Add an OpenAPI schema (explicitly out of scope per architecture §10 for v1.0, and no milestone has picked it up since) | XL | ⬜ Not started — engineering work, not a documentation-only task; noted in `README.md`'s Roadmap |
| M5 | Verify anchor-link fragments added during this pass (`docs/release/KNOWN_LIMITATIONS.md#93-...`, etc.) render correctly across the specific Markdown renderer(s) this documentation set is actually viewed through, since slug-generation for headings containing `/` and backticks varies by renderer | XS | ⬜ Flagged — all links were verified to resolve to the correct **file**; the in-file anchor fragment's exact match to a given renderer's slug algorithm was not independently verified across every renderer |

## Low

Nice-to-have polish.

| # | Item | Effort | Status |
|---|---|---|---|
| L1 | A first-party SDK/client library — currently zero exist, by design, for API-surface minimalism; worth revisiting now that the surface has grown to four endpoints | XL | ⬜ Not started — engineering, not documentation |
| L2 | A dedicated onboarding tutorial series beyond the two example clients | L | ⬜ Not started |

---

## Documentation Validation

Checked against the Success Criteria before considering this pass complete:

- ✅ Every package has a README (confirmed: 22/22; `providers/` correctly
  excluded as a non-package category directory)
- ✅ Every public API endpoint is documented (`POST /v1/execute`,
  `POST /v1/execute/stream`, `POST /v1/execute/pipeline`,
  `GET /v1/health` — the pipeline endpoint was the one gap, now closed)
- ✅ Every environment variable actually read by `apps/gateway-server` is
  documented in `DEPLOYMENT.md` (`ENABLE_STRATEGY_LAYER` was the one gap,
  now closed) — and, just as importantly, the plan now explicitly
  documents which config (`budgetPolicies`/`budgetEnforcementMode`) is
  **not** reachable via any environment variable, rather than leaving
  that silent
- ✅ Every architecture diagram referenced is current (no diagram was
  found to contradict the implementation; `em-8-runtime-flow.md` was
  spot-checked and matches source)
- ⚠️ Every milestone is accurate — EM-0 through EM-11 are now accurately
  reflected in `README.md` and cross-checked against `CHANGELOG.md` and
  `IMPLEMENTATION_PROGRESS.md`; the EM-2/EM-9 historical-record gaps
  themselves could not be fully closed (the underlying write-ups were
  never produced at the time), so they are honestly flagged rather than
  fabricated — this is the one validation item that is "accurate about
  its own gap" rather than fully "resolved"
- ✅ Every ADR reference resolves (26/26 checked; two broken links this
  pass introduced — ADR-0014 and ADR-0016 filenames — were caught and
  fixed before completion)
- ✅ Every release document is current through v1.2
  (`RELEASE_NOTES.md`, `KNOWN_LIMITATIONS.md`, `CHANGELOG.md`,
  `VERSIONING.md`, `SUPPORT_POLICY.md`, `docs/release/README.md`)
- ✅ Every deployment guide matches implementation (`DEPLOYMENT.md` now
  accurately describes what is and is not configurable for Strategy
  Layer, Pipeline Orchestration, and Budget Governance)
- ✅ Every README reflects RuntimeOS v1.2 (root README rewritten; five
  package READMEs corrected for stale wiring claims; all others already
  current)

All Critical items are closed except C6 (a process/governance action
outside this program's "documentation only" mandate — flagged for the
release owner rather than resolved unilaterally). High items H1–H6 are
closed; H7 and H8 are real, valuable, and deliberately left for a
follow-up pass rather than rushed, since a poorly-verified new example or
migration guide would reintroduce exactly the kind of unverified-claim
risk this program exists to remove.
