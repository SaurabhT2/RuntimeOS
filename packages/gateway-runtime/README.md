# @ai-gateway/gateway-runtime

The shared RuntimeOS composition layer: `bootstrap()`, `GatewayApp`, the
router, the three route handlers (`handleExecute`, `handleExecuteStream`,
`handleHealth`), request parsing, validation, and response-shaping. Every
hosting-specific composition root in this repository — `apps/
gateway-server` (Node/container) and `apps/vercel-adapter` (Vercel) —
depends on this package and calls the same functions; neither defines its
own copy.

This package owns **zero** hosting lifecycle. It never calls
`createServer()`, `.listen()`, registers `SIGTERM`/`SIGINT`, or knows
anything about Vercel Functions. See "What belongs here vs. what stays in
an app" below.

## Public API

- `bootstrap(config: GatewayRuntimeConfig, overrides?): Promise<GatewayApp>`
  — constructs the full platform composition (same packages, same wiring
  order, for every consumer).
- `GatewayApp`, `GatewayRuntimeConfig`, `BootstrapOverrides` — the types
  around it.
- `Router`, `buildGatewayRouter(app)`, `dispatchGatewayRequest(router, req,
res, path)` — the route table and per-request dispatch, method+path
  only, no framework dependency.
- `extractApiKey`, `readJsonBody`, `validateExecuteRequest`, `sendJson`,
  `sendError`, `toErrorResponseBody`, `statusForGatewayError` — the HTTP
  plumbing the route handlers are built from; exported individually in
  case a future hosting layer needs to recombine them differently (none do
  today — both current apps use `dispatchGatewayRequest` as-is).
- `handleExecute`, `handleExecuteStream`, `handleHealth` — the three route
  handlers, each `(req: IncomingMessage, res: ServerResponse, app:
GatewayApp) => Promise<void>`.

All of the above is exported from this package's main entry point
(`import ... from "@ai-gateway/gateway-runtime"`) and is safe to load in
production — none of it pulls in `vitest` or any other test-only
dependency.

**`@ai-gateway/gateway-runtime/testing`** — a separate entry point:
`fakeTelemetry`, `fakeAdapter`, `fakeSlowStreamAdapter`, `TEST_MODEL_SEED`,
`testRuntimeConfig`, `startTestDispatchServer`. Used by this package's own
tests and both apps' test suites. **Import this only from `test/` files.**
It is deliberately not re-exported from the main entry point — see
`docs/adr/0012-shared-gateway-runtime-package.md`'s Postscript for why
mixing the two in one barrel is a production-breaking mistake, not just a
style preference.

See `docs/adr/0011-shared-gateway-runtime-package.md` for the full
rationale (this is a revision of what was originally ADR-0011's
"duplicate instead" decision — see that document's "Status" line) and
`docs/Hosting-architecture/EM-5.5-vercel-deployment-architecture-review.md`
§7 (revised) for the architecture this package implements.

## What belongs here vs. what stays in an app

| Concern                                                                                   | Lives here | Lives in the app |
| ----------------------------------------------------------------------------------------- | ---------- | ---------------- |
| Platform composition (`bootstrap()`, `GatewayApp`)                                        | ✅         |                  |
| Router / route handlers / request parsing / validation / response shaping                 | ✅         |                  |
| `createServer()` / `.listen()` / `SIGTERM`/`SIGINT` (`apps/gateway-server`)               |            | ✅               |
| Vercel Function entrypoint / warm-instance `GatewayApp` caching (`apps/vercel-adapter`)   |            | ✅               |
| Deriving `path` from the incoming request (`req.url` vs. Vercel's dynamic route segments) |            | ✅               |
| Environment-variable loading (`HOST`/`PORT` vs. none; otherwise identical)                |            | ✅               |

The dividing line is exactly "hosting lifecycle and hosting-specific
request adaptation" vs. "everything else" — matching this milestone's
own framing of the two hosting layers.

## Design decisions (carried over from `apps/gateway-server`)

This code originated in `apps/gateway-server` (EM-5) and moved here
unmodified in reasoning, per [ADR-0012](../../docs/adr/0012-shared-gateway-runtime-package.md).
The decisions below were made when it lived there; they're recorded here
now, not duplicated in both apps' READMEs.

1. **No HTTP framework.** `router.ts` is a hand-rolled, ~35-line
   method+exact-path router. Neither the architecture spec nor the
   Engineering Blueprint names a framework for this layer, and the
   gateway's three fixed routes (no path parameters) don't need one. A
   framework dependency was a deliberate non-choice, not an oversight —
   see the router's own doc comment for when this should be revisited
   (many more routes, path parameters).

2. **`SEED_MODELS` is used as-is; a real deployment must supply real
   model IDs.** `model-registry`'s seed data is placeholder (its own
   README says so); `GroqAdapter`/`NimAdapter` pass `modelId` straight
   through as the literal provider-side string (EM-3 Engineering
   Decision 3). `bootstrap()` does not invent real model IDs on an
   operator's behalf — `overrides.modelRegistrySeed` is the seam a real
   deployment (or a test) uses to supply its own.

3. **`GatewayConfig.reliability` is not wired to `CircuitBreaker`/
   `RetryEngine`.** Discovered while originally writing `bootstrap()` —
   see `docs/adr/0010-gatewayconfig-reliability-section-unconsumed.md`
   (ADR candidate). Both are constructed with their own shipped defaults
   instead of a guessed mapping.

4. **HTTP-boundary request-shape validation, before middleware.**
   `MiddlewarePipeline`'s stages (`CacheMiddleware` in particular) assume
   they're handed an already-well-shaped `ExecuteRequest` — reasonably,
   since that's how every existing EM-4 test exercises them. A malformed
   body (e.g. a missing `tenant`) would otherwise throw a raw, non-
   `GatewayError` exception inside `CacheMiddleware` before
   `orchestrator`'s own schema validation ever runs. `http/validate-request.ts`
   validates against the same `executeRequestSchema` orchestrator itself
   uses (not a second, divergent schema) immediately after body-parsing,
   closing that gap without changing `middleware`'s frozen contract.

5. **`CREDENTIAL_INVALID` -> 401, `CREDENTIAL_NOT_FOUND` -> 424.**
   Architecture §19.1 groups both under one "401/424" cell without
   specifying which gets which. See `http/respond.ts`'s doc comment for
   the full reasoning (`AuthMiddleware`'s own gateway-auth failures are
   the only `CREDENTIAL_INVALID` source that's unambiguously a
   caller-identity problem).

6. **Streaming auth/rate-limit run outside `MiddlewarePipeline.run`.**
   `pipeline.run`'s `downstream` returns a single `ExecuteResponse`, never
   a stream, and its cache-check step never applies to streaming anyway.
   `handleExecuteStream` calls `AuthMiddleware.authenticate`/
   `RateLimitMiddleware.checkOrThrow` directly instead — the same two
   stages, wired a second way for the one lifecycle shape
   `MiddlewarePipeline` doesn't cover end-to-end, not new business logic.

## Testing strategy

- **Unit:** `bootstrap.ts` (wiring, config-loading, override seams,
  telemetry/audit identity defaults), every `http/*` module (router,
  respond, auth-header, read-body, validate-request) in isolation, and the
  streaming route's `error`-event cancellation path (direct, since a real
  HTTP client can't reliably trigger it).
- **Route-level:** each of the three routes exercised over a _real_
  `node:http` server (`src/testing/test-server.ts`'s
  `startTestDispatchServer`) with fake, in-memory `ProviderAdapter`s —
  never a live network call, matching this codebase's established
  `fetchImpl`-as-test-seam convention.
- **Integration:** `test/integration/end-to-end.test.ts` drives the
  Runtime Integration flow (Client -> Gateway API -> Middleware ->
  Orchestrator -> ... -> Client Response) as real HTTP round trips,
  including a failover scenario where the client only ever sees a normal
  `200`. Both `apps/gateway-server` and `apps/vercel-adapter` run this
  exact same suite of scenarios again through their own real entrypoint,
  via `startTestDispatchServer` — this is the concrete evidence for "no
  behaviour differs between the two deployment targets except hosting
  lifecycle."

## Why `GatewayRuntimeConfig` has no `http` section

`bootstrap()` never read a host/port before this package existed either —
`apps/gateway-server`'s original `bootstrap()` accepted a config type with
an `http` field but never referenced it. Making that pre-existing fact
explicit (by giving the shared config type no such field at all) isn't a
behavior change; `apps/gateway-server`'s own config loader still parses
`HOST`/`PORT` for its own `createServer().listen()` call, just no longer
threads them through `bootstrap()`.
