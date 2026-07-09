# @ai-gateway/gateway-server

The EM-5 composition root: the first deployable AI Gateway MVP (v1.0). A
single `node dist/index.js` process that constructs every platform
package built in EM-0–EM-4 exactly once and wires them into a running
HTTP/SSE server (architecture §6.4, §9, §10; Engineering Blueprint §7
EM-5).

## Scope verification

Blueprint §7 EM-5's own "Features delivered" line: a publicly-callable
`POST /v1/execute` and `POST /v1/execute/stream`, "fully matching
architecture §10." Architecture §10.2's full REST contract additionally
lists `GET /v1/tasks`, `GET /v1/usage`, and `POST|DELETE /v1/credentials`
— **none of those three are implemented in this milestone.** This is a
deliberate scope decision, not an oversight:

- Blueprint §7 EM-5's own literal scope line names only `/v1/execute` and
  `/v1/execute/stream` as "Features delivered" — the "fully matching
  architecture §10" qualifier reads most naturally as "matching §10's
  request/response/error contract for those two routes," not "implement
  every route §10 lists," especially given this milestone's own explicit
  instruction: "do NOT implement... future middleware capabilities" /
  "if future functionality is required, create extension points only."
- `POST /v1/credentials` specifically would require a live-validation
  registration flow. `credential-resolver`'s own `resolver.ts` doc
  comment already names `orchestrator` (not `apps/gateway-server`) as
  the natural owner of that flow and explicitly flags it as **not** in
  EM-4's scope — and nothing in Blueprint §7 EM-5's own scope line brings
  it into EM-5 either. Building it now would mean inventing a
  registration/validation flow that doesn't exist at any lower layer yet,
  which is exactly the "do not implement future behavior, create
  extension points only" instruction this milestone was given.
- `GET /v1/tasks` and `GET /v1/usage` are read-only reporting endpoints
  over data (task-type catalog, usage/cost accounting) that no package
  through EM-4 persists or aggregates anywhere — there is nothing yet for
  either endpoint to correctly report.

This package's `GET /v1/health` (below) is not in architecture §10.2's
table at all under that exact scope discussion, but architecture §25.2
explicitly names a coarse gateway+provider health summary as a
Kubernetes-readiness-probe concern, and this milestone's own instructions
separately require "Health & Operational Endpoints... Validate that
readiness reflects actual runtime state." It is included as this
milestone's own operational-readiness deliverable, not a `/v1/execute`
substitute.

## Public API

### `POST /v1/execute`

Body: an `ExecuteRequest` (`@ai-gateway/core-contracts`). Header:
`Authorization: Bearer <gateway-api-key>` (or `x-api-key: <key>` as a
fallback — see `src/http/auth-header.ts`). Returns a `200` with an
`ExecuteResponse` body, or a non-2xx with `{ error: GatewayError }`.

### `POST /v1/execute/stream`

Same body/auth shape; returns `200` with `content-type:
text/event-stream` and a sequence of `data: {StreamChunk}\n\n` frames
ending in one `done: true` chunk (`@ai-gateway/streaming`'s
`encodeSseChunk`). A failure **before** any chunk is sent surfaces as a
normal non-2xx JSON error response; a failure **after** the SSE response
has already opened surfaces as one final `data: {"error": GatewayError}\n\n`
frame instead, since the HTTP status code can no longer change at that
point.

### `GET /v1/health`

No auth required. Runs a real `ProviderAdapter.healthCheck` against every
registered adapter (never a hardcoded `{status:"ok"}`) and reports
`"ok"` (every provider healthy), `"degraded"` (some healthy — the gateway
can still serve traffic via failover), or `"unhealthy"` (503; none
healthy).

## Runtime composition

`src/bootstrap.ts` is the single composition root (architecture §6.4):
one function, `bootstrap(serverConfig, overrides?)`, constructing exactly
one instance of every package's concrete implementation and returning a
plain `GatewayApp` bundle — deliberately not a class, matching
`orchestrator`'s own "sequencing function, not a class hierarchy"
precedent at this layer. `src/index.ts` is the only file with process-level
side effects (loads env config, calls `bootstrap`, starts the HTTP
server, registers signal handlers) and is guarded so importing it (e.g.
from a future tool) never has those side effects — only running it
directly does.

Wiring order mirrors the dependency table exactly: Telemetry ->
GatewayConfig -> Model Registry -> Credential Resolver -> Reliability ->
Policy Engine -> Provider Adapters -> Streaming -> Orchestrator ->
Middleware -> `GatewayApp`.

## Engineering decisions

1. **No HTTP framework.** `src/http/router.ts` is a hand-rolled,
   ~30-line method+exact-path router. Neither the architecture spec nor
   the Engineering Blueprint names a framework for this package, and this
   milestone's three fixed routes (no path parameters) don't need one. A
   framework dependency was a deliberate non-choice, not an oversight —
   see the router's own doc comment for when this should be revisited
   (many more routes, path parameters).

2. **`SEED_MODELS` is used as-is; a real deployment must supply real
   model IDs.** `model-registry`'s seed data is placeholder (its own
   README says so); `GroqAdapter`/`NimAdapter` pass `modelId` straight
   through as the literal provider-side string (EM-3 Engineering
   Decision 3). This composition root does not invent real model IDs on
   an operator's behalf — `bootstrap()`'s `overrides.modelRegistrySeed`
   is the seam a real deployment (or a test) uses to supply its own.

3. **`GatewayConfig.reliability` is not wired to `CircuitBreaker`/
   `RetryEngine`.** Discovered while writing `bootstrap()` — see
   `docs/adr/0010-gatewayconfig-reliability-section-unconsumed.md` (ADR
   candidate). Both are constructed with their own shipped defaults
   instead of a guessed mapping.

4. **HTTP-boundary request-shape validation, before middleware.**
   `MiddlewarePipeline`'s stages (`CacheMiddleware` in particular) assume
   they're handed an already-well-shaped `ExecuteRequest` — reasonably,
   since that's how every existing EM-4 test exercises them. A malformed
   body (e.g. a missing `tenant`) would otherwise throw a raw, non-
   `GatewayError` exception inside `CacheMiddleware` before
   `orchestrator`'s own schema validation ever runs. `src/http/validate-request.ts`
   validates against the same `executeRequestSchema` orchestrator itself
   uses (not a second, divergent schema) immediately after body-parsing,
   closing that gap without changing `middleware`'s frozen contract.

5. **`CREDENTIAL_INVALID` -> 401, `CREDENTIAL_NOT_FOUND` -> 424.**
   Architecture §19.1 groups both under one "401/424" cell without
   specifying which gets which. See `src/http/respond.ts`'s doc comment
   for the full reasoning (`AuthMiddleware`'s own gateway-auth failures
   are the only `CREDENTIAL_INVALID` source that's unambiguously a
   caller-identity problem).

6. **Streaming auth/rate-limit run outside `MiddlewarePipeline.run`.**
   `pipeline.run`'s `downstream` returns a single `ExecuteResponse`, never
   a stream, and its cache-check step never applies to streaming anyway.
   `execute-stream.ts` calls `AuthMiddleware.authenticate`/
   `RateLimitMiddleware.checkOrThrow` directly instead — the same two
   stages, wired a second way for the one lifecycle shape
   `MiddlewarePipeline` doesn't cover end-to-end, not new business logic.

7. **Fail-fast environment-driven configuration.** `src/server-config.ts`
   loads and Zod-validates every process-level setting (listen
   address, which env var holds each provider's platform key, gateway API
   keys, rate-limit/cache tuning) and throws before any network listener
   opens if anything required is missing or malformed — this milestone's
   own "no silent configuration failures" requirement.

## Testing strategy

- **Unit:** `server-config.ts` (env parsing/validation), `bootstrap.ts`
  (wiring, config-loading, override seams), every `http/*` module
  (router, respond, auth-header, read-body, validate-request) in
  isolation, and `lifecycle.ts` (graceful shutdown, signal handling, a
  simulated hung-close force-exit).
- **Route-level:** each of the three routes exercised over a _real_
  `node:http` server (`test/test-server.ts` starts the actual
  `createHttpServer(app)` this process itself runs) with fake, in-memory
  `ProviderAdapter`s — never a live network call in CI, matching this
  codebase's established `fetchImpl`-as-test-seam convention.
- **Integration:** `test/integration/end-to-end.test.ts` drives this
  milestone's own named Runtime Integration flow (Client -> Gateway API
  -> Middleware -> Orchestrator -> ... -> Client Response) as real HTTP
  round trips, including a failover scenario where the client only ever
  sees a normal `200`.
- **Coverage:** 95.5/90.1/93.9/95.5 (statements/branches/functions/lines),
  above the shared 90/90/90/85 threshold every package in this monorepo
  enforces.

## Deferred work

- `/v1/tasks`, `/v1/usage`, `POST|DELETE /v1/credentials` — see Scope
  verification above.
- Multi-instance deployment: `RateLimitMiddleware`/`CacheMiddleware`
  (in-memory) and `reliability`'s `CircuitBreaker`/`HealthMonitor`
  (also in-memory) have no cross-instance consistency. A real
  multi-replica deployment needs a shared backend for all four — flagged
  repeatedly through EM-2/EM-4's own documentation as a known,
  intentional limitation of the current implementations, not something
  this milestone silently assumes is solved.
- `GatewayConfig.reliability` wiring — ADR-0010 (candidate).
- OpenAPI schema generation — architecture §10 doesn't mandate one for
  v1.0, and nothing in Blueprint §7 EM-5's scope line names it.
