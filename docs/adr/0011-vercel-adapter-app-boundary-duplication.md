# ADR-0011: `apps/vercel-adapter` duplicates a small amount of app-layer HTTP glue instead of importing it from `apps/gateway-server`

**Status:** Superseded by [ADR-0012](0012-shared-gateway-runtime-package.md)
**Date:** 2026-07-10
**Format:** Context / Decision / Consequences / Alternatives

> **Superseded 2026-07-11.** This ADR's "Alternatives considered" section
> rejected extracting `bootstrap()`/the HTTP layer into a shared package by
> treating it as equivalent to the architecture review's Option C (a new
> "hosting adapter" _interface_, which was and remains rejected). On
> review, that equivalence doesn't hold: relocating already-concrete,
> non-abstract code to a `packages/*` module a second `apps/*` entry can
> depend on is an ordinary `app` → `package` edge, which this codebase's
> app-isolation boundary (the actual, correct reason app → app imports are
> blocked) never restricted. The duplication this ADR justified turned out
> to be an unforced choice, not a genuine consequence of the boundary. See
> ADR-0012 for the corrected decision and
> `docs/Hosting-architecture/EM-5.5-vercel-deployment-architecture-review.md`'s
> Revision History for the architecture-level record of the same
> correction. This document is retained, unmodified below, as the
> historical record of the reasoning that led to the original (mistaken)
> decision — not as a currently-accurate description of this codebase.

## Context

EM-5.5's approved architecture
(`docs/Hosting-architecture/EM-5.5-vercel-deployment-architecture-review.md`)
requires implementing a Vercel deployment target that "reuses existing
bootstrap logic," "reuses existing request handlers," and reuses existing
middleware/routing/validation/streaming, while leaving `apps/gateway-server`
completely untouched (§7.5, §10: "`apps/gateway-server`: None. Remains
exactly as tagged in v1.0.2"). §7.2 anticipates some tension here directly:
it frames calling `bootstrap()` as either "the same `bootstrap()` function
`apps/gateway-server` calls, **or a copy of it re-exported for reuse**" —
i.e., it already contemplates that a literal shared function might not be
available and leaves the choice to implementation.

That tension turns out to be real, and it predates this milestone: this
codebase's `eslint.config.mjs` (`boundaries/element-types`) classifies every
directory under `apps/*` as type `"app"`, and an `"app"` may depend only on
`"package"`, `"provider-adapter"`, `"provider-sdk"`, or `"core-contracts"` —
never on another `"app"`. This rule was never exercised before this
milestone (there was only ever one `app`), but it applies to
`apps/vercel-adapter` exactly as written, with zero configuration changes,
the moment a second `app` exists. Combined with this milestone's own "do not
modify... the dependency graph" / "preserve all existing package
boundaries" constraints and "`apps/gateway-server`: None" impact
requirement, this means `apps/vercel-adapter` cannot import
`bootstrap()`, the route handlers, or any of `apps/gateway-server/src/http/*`
directly — doing so would either violate the existing boundary rule or
require changing it, and changing it would itself be a "dependency graph"
modification this milestone is instructed not to make.

## Decision

`apps/vercel-adapter` depends only on the same platform packages
`apps/gateway-server` already depends on (`orchestrator`, `middleware`,
`providers/groq`, `providers/nvidia-nim`, and, transitively, every package
those depend on) — never on `apps/gateway-server` itself. This is also
exactly what EM-5.5's own impact analysis (§10) states: "The new app depends
on packages exactly the way `apps/gateway-server` already does; no new edges
into or out of `packages/*` are introduced."

Concretely, `apps/vercel-adapter/src/` contains its own copies of:

- `bootstrap.ts` — the same packages, same constructors, same wiring order
  as `apps/gateway-server/src/bootstrap.ts`; the only difference is the
  config parameter type (no `http` section — see `vercel-config.ts`).
- `vercel-config.ts` — the Vercel counterpart of `server-config.ts`, same
  environment variable names/defaults/validation, no `http.host`/`port`.
- `http/{router,auth-header,read-body,respond,validate-request}.ts` —
  verbatim copies; none of these files have any dependency on anything
  gateway-server-specific to begin with (only `node:http` types and
  `@ai-gateway/core-contracts`), so the duplication is purely mechanical.
- `http/routes/{execute,execute-stream,health}.ts` — copies of
  `handleExecute`/`handleExecuteStream`/`handleHealth`, adjusted only for
  local import paths and (in `execute-stream.ts`) one addition: also
  listening for `req`'s `error` event (Vercel's documented disconnect
  signal for classic Node.js handlers), alongside `close`.
- `http/dispatch.ts` — the Vercel-native replacement for
  `createHttpServer`'s inner request-listener (same routes, same 404/405
  behavior), factored out specifically because it must never call
  `createServer()`/`.listen()` (§7.4) and must return an awaitable
  `Promise<void>` rather than fire-and-forget (Vercel ties a Function
  invocation's lifetime to its handler's returned promise; a real
  `http.Server` doesn't care).

Every one of these files' doc comments points back to this ADR and names
its gateway-server counterpart, so a future reader auditing for drift knows
exactly what to diff.

## Consequences

- **`apps/gateway-server` is truly untouched.** Zero lines changed, matching
  §10's impact analysis exactly and matching this milestone's "do not
  break it" constraint literally, not just in spirit.
- **All business logic is still fully reused, not duplicated.** Every
  package in `DEPENDENCY_TABLE` (`orchestrator`, `middleware`,
  `policy-engine`, `credential-resolver`, `reliability`, `streaming`,
  `telemetry`, `config`, `core-contracts`, both provider adapters) is
  imported unmodified by both apps. What's duplicated is only the thin
  (~250-line) app-layer HTTP plumbing that has no business logic in it at
  all — the same category of code `apps/gateway-server/src/index.ts`
  itself is (correctly) excluded from that app's own coverage requirements
  for the same reason.
- **Drift risk.** The duplicated files can, in principle, drift from their
  gateway-server counterparts over time. Mitigated by: (a) every duplicated
  file's doc comment names its counterpart explicitly; (b) the integration
  test suite (`apps/vercel-adapter/test/integration/end-to-end.test.ts`)
  asserts the _same_ scenarios and _same_ assertions as
  `apps/gateway-server/test/integration/end-to-end.test.ts`, so a future
  behavioral divergence fails a test, not just a code review; (c) any
  future change to `apps/gateway-server`'s HTTP layer or `bootstrap()`
  should be checked against this app's copies as part of that change's own
  review, exactly as changing a frozen interface already requires checking
  every consumer.
- **Two composition roots to maintain**, which EM-5.5's own architecture
  review already names as an accepted trade-off of the "two composition
  roots" approach (§8) independent of this ADR's specific duplication
  mechanics.
- **Future option, not a decision made here:** this codebase's Vercel
  Node.js runtime documentation (as of 2026-05-19) also supports capturing
  a full `createServer(...).listen(...)` Node HTTP server as a Vercel
  Function entrypoint directly ("deploy a Node.js server" — see
  `apps/vercel-adapter/README.md`, "Implementation note"). If that
  capability is confirmed stable and adopted in a future architecture
  revision, `apps/vercel-adapter` could import `apps/gateway-server`'s real
  `createHttpServer(app)` almost as-is instead of `dispatch.ts` — though
  the `bootstrap()`/`vercel-config.ts` duplication described above would
  still exist independent of that, per the app-isolation boundary this ADR
  documents. Not evaluated further here per this milestone's "implement
  the approved architecture, don't redesign it" instruction.

## Alternatives considered

- **Import `bootstrap()`/route handlers directly from `apps/gateway-server`.**
  Rejected: violates the existing `eslint.config.mjs` app-isolation
  boundary (`"app"` may not depend on another `"app"`) without any change
  to this milestone's own constraints authorizing that change, and
  contradicts §10's "no new edges... introduced" / "`apps/gateway-server`:
  None" language.
- **Extract `bootstrap()` and the route handlers into a new shared
  package** (`packages/*` or a shared `apps/`-adjacent library) that both
  apps import. Rejected: this milestone's "do not introduce new
  abstractions unless required by the approved architecture" constraint,
  combined with EM-5.5's own rejection of "Option C" (a generic
  hosting-adapter abstraction, §6) for a closely related reason — both
  would give the platform packages, or an adjacent shared module, new
  hosting-target-shaped structure the approved architecture chose not to
  introduce. It would also require modifying `apps/gateway-server` (to
  import from the new shared location instead of defining these files
  locally), contradicting "`apps/gateway-server`: None."
- **Amend `eslint.config.mjs` to allow `"app"` → `"app"` imports for this
  one case.** Rejected: this is itself a "dependency graph" / boundary
  modification, which this milestone is explicitly instructed not to make
  ("preserve all existing package boundaries").
