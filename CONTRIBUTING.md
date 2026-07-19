# Contributing to AI Gateway

Thank you for your interest in contributing to AI Gateway. This document
covers the repository workflow, coding standards, documentation and
testing expectations, the ADR process, pull request guidance, issue
reporting, and the philosophy behind how this project runs its
engineering milestones.

## Repository workflow

- **Branch strategy:** trunk-based development with short-lived feature
  branches, targeted to merge within 1–2 days. Long-lived branches
  reintroduce integration risk this project's wave-based development
  approach is designed to avoid.
- **Pull requests:** scope a PR to one package wherever possible.
  Interface changes (see "The ADR process" below) are reviewed and
  merged separately from the implementation that consumes them.
- **Package boundaries are enforced, not just conventions.** Every
  cross-package import is checked three independent ways in CI: pnpm's
  non-hoisted workspace resolution, `dependency-cruiser` (the canonical
  check — `pnpm graph:check`), and ESLint's `eslint-plugin-boundaries`
  (`pnpm lint`). If your change needs a new dependency edge between two
  packages, update `.dependency-cruiser.cjs` in the same PR and explain
  why in the PR description — don't route around the checker.

## Getting set up

```bash
corepack enable
pnpm install
pnpm build          # builds every package, dependency-order aware
pnpm test           # runs the full test suite
pnpm test:coverage  # with coverage
pnpm lint           # ESLint, including the package-boundary rule
pnpm typecheck
pnpm graph:check    # dependency-cruiser: zero cycles, boundaries respected
pnpm format:check
```

All of the above run in CI on every push/PR (`.github/workflows/ci.yml`).
Run them locally before opening a PR — CI failures on a PR that never ran
these locally waste review cycles.

## Coding standards

- **TypeScript, strict mode.** `tsconfig.base.json` enables `strict`,
  `noUncheckedIndexedAccess`, `noImplicitOverride`, and more. Don't
  relax these in a package-level `tsconfig.json` without a documented
  reason.
- **Every exported type has a companion Zod schema.** This is how the
  codebase validates values at trust boundaries (an incoming HTTP
  request, a provider adapter's translated response) instead of trusting
  a type that erases at runtime.
- **Small, single-purpose interfaces.** A new interface with more than
  3–4 methods is a signal to reconsider its scope before merging. Don't
  add an interface "just in case" — promote a concrete implementation to
  an interface only when a second real implementation is actually being
  built.
- **Every exported function that can fail returns or throws a
  `GatewayError`-shaped error by the time it crosses a package
  boundary.** A raw provider SDK error, a raw database error, or any
  other unshaped exception must never escape a package's public API.
- **No provider-specific logic outside `packages/providers/*`.** Not
  just imports — a provider's error message string or rate-limit header
  format being pattern-matched anywhere else is exactly the kind of
  leak the conformance suite and code review both exist to catch.
- **No business logic in the gateway.** AI Gateway does not own RAG,
  prompt libraries, brand voice, or workflows. If a change references a
  specific tenant, workspace, or business concept by name inside
  `policy-engine`, `orchestrator`, or similar core packages (as opposed
  to treating `tenant.organizationId` as an opaque scoping key), that's
  a sign the logic belongs in a consuming application instead.
- **No hidden in-process state.** A module-level `let`/mutable variable
  outside a package's documented store client is a design smell — ask
  whether the value would still be correct if a second gateway instance
  existed (architecture Principle P3: the Execution Core is stateless).
- **Naming matches the architecture documents exactly.** Package names
  and exported interface names match the Architecture Specification and
  Engineering Blueprint's naming — no "translation table" should ever be
  needed between what's designed and what's built.

### Test coverage expectations by package tier

| Tier | Packages (examples) | Bar |
|---|---|---|
| Contract tier | `core-contracts` | 100% of exported types exercised by a round-trip (parses/rejects) test. |
| Core logic tier | `policy-engine`, `reliability` | 90%+ line coverage, enforced in CI. |
| Adapter tier | `providers/*` | 100% pass rate on the shared conformance suite; line coverage is secondary. |
| Thin/composition tier | `orchestrator`, `middleware`, `apps/gateway-server` | Integration coverage of every request-lifecycle node, rather than a line-coverage percentage. |

## Documentation expectations

- **Every PR that adds or changes a public interface updates that
  package's README in the same PR.** Documentation written after the
  fact drifts from what actually shipped.
- **Every exported interface, type, and public function carries a TSDoc
  comment.** Don't hand-maintain a separate API reference.
- **A package's README states what it does *not* implement**, not just
  what it does, whenever a reasonable reader might otherwise assume
  broader scope than what shipped (see any existing package README's
  "Deferred Work" or "Scope Verification" section for the pattern this
  project uses).

## Testing expectations

- Match new logic to the coverage tier table above.
- Property-based tests are used where inputs are combinatorial (see
  `reliability`'s retry/backoff tests) — prefer this over hand-enumerating
  cases when the state space is large.
- Cross-tenant isolation tests are a hard merge gate for any change
  touching credential resolution, rate limiting, or caching — write the
  test that proves isolation would fail if the relevant tenant filter
  were removed, not just a test that happens to pass.

## The ADR process

Architecture Decision Records live in `docs/adr/`. Two situations call
for one:

1. **Freezing or changing an interface.** Per the Engineering Blueprint
   §6.3: propose the interface as a standalone PR (types, TSDoc, and a
   type-level test only, no implementation); review focuses purely on
   the contract. Once merged, the interface is stable for the rest of
   that milestone — changing it afterward needs an ADR using the
   Context / Decision / Consequences / Alternatives format in
   `docs/adr/0000-template.md`.
2. **Finding a real, verified inconsistency between the Architecture
   Specification and the implementation.** This project's convention is
   to *document* such a gap as a proposed ADR rather than silently
   resolve it with a local workaround, so the Architecture Review Board
   can make the call with full context. See `docs/adr/README.md`'s
   "Proposed / Draft" section for five worked examples of this pattern.

Do not resolve an open, proposed ADR by picking one option yourself in
an unrelated PR — flag it in review and let the Architecture Review
Board decide, or open a new PR that is explicitly about resolving that
ADR.

## Pull request guidance

Before requesting review, check your own PR against:

- Does this PR cross a package boundary the dependency-boundary lint
  rule should already be catching — and if the lint rule allowed it, is
  that actually correct?
- Does a new or changed interface include a corresponding ADR if it's a
  breaking change?
- Does every new error path produce a `GatewayError` (or a documented
  local error type) rather than letting a raw exception escape?
- Are there tests for every new branch, matching the coverage tier above?
- Does this introduce provider leakage, business logic in the gateway,
  a circular dependency, premature optimization, an unnecessary new
  abstraction, tight coupling to another package's internals, hidden
  state, or configuration drift? (See Engineering Blueprint §13 for the
  full write-up of each.)

## Issue reporting

When filing an issue, include:

- The package(s) involved (matching `packages/*`/`apps/*` names exactly).
- Whether this is a defect in implemented v1.0 scope, or a request for
  scope that `docs/release/KNOWN_LIMITATIONS.md` already documents as
  deferred — if the latter, please reference that document rather than
  re-filing a known limitation as a new bug.
- Repro steps or a failing test where possible.

For security vulnerabilities, do **not** open a public issue — see
[`SECURITY.md`](SECURITY.md).

## Milestone governance philosophy

This project builds in explicit, scoped Engineering Milestones (EM-0
onward — see `docs/architecture/engineering-blueprint.md` §7). Two rules
follow from that:

- **Don't implement a future milestone's functionality early**, even if
  it seems easy or obviously needed. If you find yourself building
  something a later milestone owns, stop and either raise it in review
  or create an extension point (an interface or seam) rather than a full
  implementation. This project treats early functionality as scope
  creep, not a bonus.
- **Don't silently redesign or "fix" an architecture-level inconsistency
  you find while implementing something else.** Document it (an ADR, or
  a note in the relevant package's README) and let it be decided at the
  appropriate review level. This keeps the Architecture Specification
  and Engineering Blueprint as reliable a record of *intent* as the code
  is a record of what was actually built — the two are expected to be
  cross-checked against each other, not silently reconciled by whoever
  happens to notice a gap first.
