# ADR-0012: Extract `bootstrap()` and the HTTP composition layer into `@ai-gateway/gateway-runtime`, a shared package

**Status:** Accepted
**Date:** 2026-07-11
**Format:** Context / Decision / Consequences / Alternatives

## Context

[ADR-0011](0011-vercel-adapter-app-boundary-duplication.md) accepted
~450 logical lines of duplication between `apps/gateway-server` and
`apps/vercel-adapter` (`bootstrap()`/`GatewayApp`, the router, request
parsing, validation, response-shaping, and the three route handlers),
reasoning that this codebase's app-isolation boundary
(`eslint.config.mjs`'s `boundaries/element-types` rule) made sharing this
code unavailable, and that the only alternative — extracting it into a new
`packages/*` module — was equivalent to the architecture review's
**Option C** ("a generic hosting-adapter abstraction inside `packages/*`",
`docs/Hosting-architecture/EM-5.5-vercel-deployment-architecture-review.md`
§6), which was and remains rejected.

That equivalence was the error. Option C rejects introducing a **new
interface** — an abstract contract for "how a request handler is exposed
to a runtime" that every platform package or hosting target would need to
conform to. Moving `bootstrap()`/the router/the handlers — code that
already existed, already had zero abstraction over hosting model, and
already only touched `node:http` types plus plain platform-package
constructors — into a `packages/*` directory introduces no such interface.
It is a relocation of concrete code, not a new abstraction. The
app-isolation boundary ADR-0011 correctly identified never restricted
`app` → `package` imports; it has only ever restricted `app` → `app`
imports. A shared package was available the entire time.

## Decision

Extract into a new package, `packages/gateway-runtime`
(`@ai-gateway/gateway-runtime`):

- `bootstrap()`, `GatewayApp`, `BootstrapOverrides`, and the new
  `GatewayRuntimeConfig` type (the same config shape `bootstrap()` always
  actually consumed — it never read `apps/gateway-server`'s `http: {
host, port }` field either, before or after this extraction).
- `Router` (method+exact-path matching, no framework dependency).
- `buildGatewayRouter(app)` (registers the three routes) and
  `dispatchGatewayRequest(router, req, res, path)` (matches and invokes,
  or writes the standard 404/405 response) — together, the same logic
  that lived inline in `apps/gateway-server/src/http/server.ts`'s
  `createServer` callback, factored out so a hosting layer whose
  invocation lifetime depends on it (Vercel) can `await` it, while one
  whose process lifetime doesn't (a real `http.Server`) can fire-and-forget
  it, uniformly.
- `extractApiKey`, `readJsonBody`, `validateExecuteRequest`, `sendJson`,
  `sendError`, `toErrorResponseBody`, `statusForGatewayError` — the HTTP
  plumbing, none of which ever depended on anything gateway-server-specific
  (only `node:http` types and `@ai-gateway/core-contracts`).
- `handleExecute`, `handleExecuteStream`, `handleHealth`.
- Test-only: `fakeTelemetry`, `fakeAdapter`, `fakeSlowStreamAdapter`,
  `TEST_MODEL_SEED`, `testRuntimeConfig`, `startTestDispatchServer` — the
  fakes and test harness both apps' test suites already needed, now
  shared for the same reason the production code is.

Both `apps/gateway-server` and `apps/vercel-adapter` depend on this
package as an ordinary `workspace:*` dependency — ADR-0011's "app → app"
concern does not apply, since this is an `app` → `package` edge, the same
kind every other `apps/*` entry already has.

`apps/gateway-server` keeps: `index.ts` (env config → `bootstrap()` →
`createHttpServer(app)` → `.listen()` → `registerGracefulShutdown`),
`lifecycle.ts` (`SIGTERM`/`SIGINT` draining), `http/server.ts` (now a thin
wrapper: build the router once via `buildGatewayRouter`, wrap
`dispatchGatewayRequest` in `createServer`), and `server-config.ts` (env
loading, extending `GatewayRuntimeConfig` with the one field genuinely
local to this hosting layer: `http: { host, port }`). `apps/vercel-adapter`
keeps: `runtime.ts` (lazily bootstraps once per warm instance, now also
caching the built router alongside the `GatewayApp`), `api/v1/[...path].ts`
(derives `path` from Vercel's `query.path` capture, `await`s
`dispatchGatewayRequest`), and `vercel-config.ts` (env loading — returns
`GatewayRuntimeConfig` directly; there is no Vercel-specific extension of
it, since there is no Vercel-specific field to add).

## Consequences

- **Zero duplication of composition/HTTP logic.** The ~450 logical lines
  ADR-0011 accepted duplicating are now defined exactly once.
- **`apps/gateway-server`'s behavior is provably unchanged, its structure
  is not.** Every relocated file was diffed against its pre-extraction,
  git-tracked original; the only two functional deltas found during that
  diff — `createTelemetry`'s `instrumentationName` and
  `DefaultCredentialResolver`'s `defaultActor`, both hardcoded inside the
  original `bootstrap()` as `"@ai-gateway/gateway-server"`/`"gateway-server"`
  — are preserved exactly via `BootstrapOverrides`' new
  `instrumentationName`/`defaultActor` fields, whose _defaults_ (used by
  `apps/gateway-server`'s unchanged call site) are those same original
  values; `apps/vercel-adapter` passes its own (`"@ai-gateway/vercel-adapter"`/
  `"vercel-adapter"`) explicitly, matching what it used to hardcode.
  `apps/gateway-server`'s `package.json` dependency list shrinks (direct
  dependencies on `orchestrator`, both provider packages, `policy-engine`,
  `credential-resolver`, `reliability`, `streaming`, `model-registry`, and
  `core-contracts` are replaced by one dependency on `gateway-runtime`;
  `config`, `middleware`, and `telemetry` remain, since `server-config.ts`
  and `lifecycle.ts` genuinely import from them directly).
- **One genuine, disclosed behavioral addition**, not a silent one:
  `handleExecuteStream` (shared) listens for `req`'s `error` event
  (`message === "aborted"`) in addition to `close`, to correctly detect
  disconnects on Vercel per that platform's own documentation for classic
  Node.js handlers. This benefits `apps/gateway-server` too (a harmless,
  strictly additive cancellation-detection path) and was folded into the
  one shared implementation rather than kept as a Vercel-only patch.
- **A small, additive dependency-graph change.** `.dependency-cruiser.cjs`
  gains one new `DEPENDENCY_TABLE` entry (`gateway-runtime`) and both
  apps' existing entries are updated to list it instead of the packages
  they no longer import directly — the one place this ADR's implementation
  modifies an _existing_ entry rather than only adding new ones. No
  `eslint.config.mjs` change was needed: `"app"` was already permitted to
  depend on `"package"`.
- **Test suites reorganized, not reduced.** Route/handler/router/bootstrap
  unit tests and the canonical end-to-end integration suite now live in
  `packages/gateway-runtime/test/`. Each app keeps tests for what's
  actually still its own (`apps/gateway-server`: `server-config.ts`,
  `lifecycle.ts`, plus an integration suite proving its real
  `createServer`/`.listen()` assembly still works end-to-end;
  `apps/vercel-adapter`: `vercel-config.ts`, `runtime.ts`'s warm-instance
  caching, plus a dedicated test driving the _real_ exported Vercel
  handler to prove `query.path` → `path` derivation — the one piece of
  logic genuinely unique to that app and not exercised anywhere else).

## Alternatives considered

Superseded from ADR-0011 (retained there for the historical record):

- **Import `bootstrap()`/route handlers directly from `apps/gateway-server`.**
  Still rejected: still an `app` → `app` edge, still blocked by the
  existing boundary, and this ADR's own Decision doesn't require it.
- **Amend `eslint.config.mjs` to allow `"app"` → `"app"` imports.** Still
  rejected, and still unnecessary: the actual fix (a shared `package`) was
  always compatible with the existing rule, so no rule change was ever
  needed.
- **Duplication (ADR-0011's original decision).** Superseded by this ADR
  for the reason in this document's Context section — the boundary
  concern that motivated it does not apply to an `app` → `package` edge.

## Postscript: production `vitest` leakage (2026-07-11)

This package's initial implementation of the Decision above re-exported
its test-only fakes/harness (`fakeAdapter`, `startTestDispatchServer`,
etc. — needed by all three test suites, per this ADR's own "share the
test doubles too" reasoning) from the **same** barrel
(`src/index.ts`) as the production exports (`bootstrap`, the route
handlers, ...). Since `src/testing/fixtures.ts` imports `vitest`, and ES
module `export ... from` re-exports load and execute the referenced
module unconditionally regardless of which binding is actually used, this
meant `apps/gateway-server/src/index.ts` importing `bootstrap` from
`"@ai-gateway/gateway-runtime"` transitively loaded `vitest` as part of
real `node dist/index.js` startup — and `vitest`'s own module throws when
loaded outside the actual `vitest` test-runner process. `pnpm build`/
`typecheck`/`lint`/`graph:check` are all static-analysis tools that never
execute the code they check, so none of them caught this; only actually
running the server did.

This is the identical failure mode `@ai-gateway/provider-sdk` already hit
and fixed once (`git log`, "fix(runtime): remove Vitest dependency from
production startup") — a package exporting both production code and
vitest-dependent test doubles must expose them through **separate**
entry points. This package now follows that same, already-established
convention: `src/index.ts` (the production barrel, `vitest`-free) and
`src/testing/index.ts` (a dedicated `./testing` `package.json` `exports`
subpath, imported only from `test/` files in either app). No change to
this ADR's Decision was needed — this was a bug in the first
implementation of it, not a flaw in the decision itself.
