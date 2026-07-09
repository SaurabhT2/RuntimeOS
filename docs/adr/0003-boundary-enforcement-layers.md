# ADR-0003: Boundary enforcement has three layers, not one — and they catch different things

**Status:** Accepted
**Date:** 2026-07-04
**Format:** Context / Decision / Consequences / Alternatives

## Context

While validating EM-0's acceptance criterion ("dependency graph check passes
with zero cycles"), the team deliberately introduced a forbidden import
(`policy-engine` importing `providers/groq`, which Section 4.1's table does
not allow) to confirm the boundary rule is real, not just passing
trivially (Blueprint §6.3-style validation discipline).

Two things were discovered:

1. A **bare side-effect import** (`import "@ai-gateway/groq";`, no bound
   name) of an unresolvable module does **not** produce a TypeScript
   `TS2307` diagnostic, even under `strict: true`. A named import
   (`import { x } from "..."`) of the same unresolvable module does. This
   means `tsc --noEmit` alone is not a reliable boundary-violation detector
   for side-effect-only imports.
2. `dependency-cruiser`'s path-pattern rules (matching resolved file paths
   against Section 4.1's allowed-dependency regexes) also did not flag the
   violation on first attempt — because the import never resolves to a
   concrete file path at all. pnpm's strict, non-hoisted `node_modules`
   layout (Blueprint §3.1) never links `@ai-gateway/groq` into
   `packages/policy-engine/node_modules`, since `groq` isn't declared in
   `policy-engine`'s `package.json` — so the module is genuinely
   unresolvable, not merely disallowed-but-resolvable.

What **did** catch it immediately and unambiguously: `node`'s ESM resolver
at build/test time (`ERR_MODULE_NOT_FOUND` on `node dist/index.js`, and the
same failure surfacing through `vitest run`, which loads real ESM). This
confirms Blueprint §3.1's claim in practice: "pnpm's strict, non-hoisted
`node_modules` layout catches accidental cross-package imports of
transitive dependencies early."

## Decision

Boundary enforcement is treated as three complementary layers, not one:

1. **pnpm's strict `node_modules`** is the actual, unconditional enforcement
   mechanism — an undeclared cross-package import cannot resolve at
   runtime, full stop. This is caught the moment anyone runs `build` or
   `test` locally or in CI.
2. **`dependency-cruiser`** (`.dependency-cruiser.cjs`) is the _fast,
   explicit, CI-gated_ check that (a) proves no cycles exist, (b) names the
   exact allowed edge for every package per Section 4.1's table so a
   violation gets a readable error instead of a raw Node stack trace, and
   (c) via the added `not-to-unresolvable` rule, explicitly fails on any
   unresolvable import — including the undeclared-dependency case — rather
   than relying on a downstream `build`/`test` step to surface it.
3. **ESLint's `boundaries` plugin** enforces the coarser category-level
   rules (e.g. "provider adapters may only import provider-sdk and
   core-contracts") for same-repo relative imports and is kept as
   defense-in-depth, but is not relied on as the sole check for
   cross-package-specifier violations given the resolution caveat above.

No single layer is treated as sufficient on its own; `pnpm graph:check` is
the canonical CI gate (EM-0's literal acceptance criterion), with (1) and
(3) as the mechanisms that make violations impossible to ship even if graph
check were skipped locally.

## Consequences

- `pnpm graph:check` (the EM-0 acceptance criterion) is now confirmed to
  fail, not just theoretically configured to fail, on a real Section-4.1
  violation — verified by deliberately introducing and reverting one.
- Anyone extending `DEPENDENCY_TABLE` in `.dependency-cruiser.cjs` for a
  new wave's packages should re-run this same deliberate-violation check
  once for the new package, per the same discipline, rather than assuming
  the generated rule is correct by construction.
- The TS side-effect-import gap (finding #1 above) is documented here so a
  future engineer doesn't spend time re-diagnosing it; it does not need a
  code fix because layers 1 and 2 already close the gap it leaves open.

## Alternatives considered

- **Rely on `tsc --noEmit` alone** as the boundary check. Rejected: finding
  #1 above demonstrates this misses a real violation shape (side-effect
  imports), which are exactly the kind of import a provider adapter or
  plugin might use for registration side effects in later waves.
- **Add TypeScript path-mapping (`paths` in tsconfig) so cross-package
  imports resolve even without a declared `package.json` dependency**, to
  make `dependency-cruiser`'s path-pattern rules resolve every case.
  Rejected: this would weaken, not strengthen, enforcement — it would make
  pnpm's strict-linking protection (layer 1) ineffective by giving every
  package a back-door resolution path to every other package's source,
  which is the opposite of Blueprint §3.1's stated goal for choosing pnpm.
