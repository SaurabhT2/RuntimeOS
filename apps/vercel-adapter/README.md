# @ai-gateway/vercel-adapter

The EM-5.5 Vercel composition root: an additive deployment target for the
AI Gateway, approved (revised) in
`docs/Hosting-architecture/EM-5.5-vercel-deployment-architecture-review.md`.
Same platform packages, same REST contract, same request handling as
`apps/gateway-server` — both depend on the same shared composition/HTTP
package, `@ai-gateway/gateway-runtime` (see
[ADR-0012](../../docs/adr/0012-shared-gateway-runtime-package.md)). The
only thing that differs between the two apps is the hosting lifecycle: no
`createServer()`/`.listen()`, no `SIGTERM`/`SIGINT` handling, and a single
Vercel Node.js Function (`api/v1/[...path].ts`) instead of a long-running
process. `apps/gateway-server` is unmodified in behavior and remains the
reference Node/container deployment (`DEPLOYMENT.md`); this app is a
second, independent way to run the same platform.

## Public API

Identical to `apps/gateway-server`'s (`apps/gateway-server/README.md`,
"Public API") — same routes, same auth header convention, same request/
response/error shapes, same streaming semantics, because both apps call
the exact same `@ai-gateway/gateway-runtime` functions to produce them.
See that document for the full contract; it is not repeated here.
Deployment-specific operational detail (environment variables, Vercel
project configuration, `maxDuration`/cancellation) is in
[`docs/release/DEPLOYMENT-VERCEL.md`](../../docs/release/DEPLOYMENT-VERCEL.md).

## Why no `index.ts`

`apps/gateway-server/src/index.ts` is the one file with process-level side
effects: load config, `bootstrap()`, open a listener, register signal
handlers. There is no equivalent file here because there is no equivalent
moment — Vercel owns the process, the listening socket, and the
invocation lifecycle; this app only ever exports a request handler
(`api/v1/[...path].ts`) for the platform to call. `src/runtime.ts` is the
closest analogue: it lazily calls the shared `bootstrap()` once per warm
instance and caches the result (and the built route table alongside it),
which is as close as a platform-managed instance can get to "`bootstrap()`
runs once per running process" without ever calling `.listen()`.

## Runtime composition

The actual composition root — `bootstrap()`, `GatewayApp`, the router,
the route handlers, request parsing, validation, and response-shaping —
is `@ai-gateway/gateway-runtime`'s, a normal `package` dependency this app
shares with `apps/gateway-server`. This app does not define its own copy
of any of that. See that package's README for its wiring order and every
design decision behind it, and
[ADR-0012](../../docs/adr/0012-shared-gateway-runtime-package.md) for why
a shared package (rather than the duplication ADR-0011 originally
accepted) is the correct shape for this.

`src/runtime.ts`'s `getWarmInstance()` is the one piece of composition
logic with no `apps/gateway-server` equivalent at all: a module-level,
lazily-initialized, per-warm-instance cache of both the bootstrapped
`GatewayApp` and its `buildGatewayRouter(app)` route table, reset on a
failed bootstrap so a later invocation (e.g. after an operator fixes a
missing environment variable) gets a real retry rather than replaying a
stale rejection forever. It passes its own `instrumentationName`/
`defaultActor` (`"@ai-gateway/vercel-adapter"`/`"vercel-adapter"`) to the
shared `bootstrap()`, so this app's telemetry spans and credential-audit
log entries are attributable to it specifically, not to the Node
deployment.

## Engineering decisions

1. **A single catch-all Function, not one file per route.**
   `api/v1/[...path].ts` dispatches all three routes through the shared
   `dispatchGatewayRequest` so they share one warm instance's `GatewayApp`
   and route table — same in-memory rate-limit/cache/circuit-breaker
   state across all three, matching `apps/gateway-server`'s one-process
   model as closely as a platform-managed instance allows. Three separate
   `/api` files would each become an isolated Function with isolated
   memory, which would be a real behavioral difference between the two
   deployment targets, not just a hosting-lifecycle one.

2. **This app depends on `@ai-gateway/gateway-runtime`, not on
   `apps/gateway-server`.** An ordinary `app` → `package` dependency —
   the same kind every other `apps/*` entry has, requiring no change to
   this codebase's app-isolation boundary. See
   [ADR-0012](../../docs/adr/0012-shared-gateway-runtime-package.md).

3. **`dispatchGatewayRequest` returns an awaited `Promise<void>`, not a
   fire-and-forget callback.** `apps/gateway-server/src/http/server.ts`'s
   inner request listener doesn't need its callers to await it — a real
   `http.Server`'s process keeps running regardless. A Vercel Function
   invocation's lifetime is tied to its exported handler's returned
   promise, so `api/v1/[...path].ts` awaits it all the way through,
   including a streaming route's full SSE loop.

4. **Cancellation also listens for `req`'s `error` event, not just
   `close`.** Vercel's own documentation for classic Node.js `(request,
response)` handlers names `error` (`message === "aborted"`) as the
   disconnect signal, made prompt by `vercel.json`'s
   `supportsCancellation: true`. This is implemented once, in the shared
   `handleExecuteStream` (`close` is kept too, for `apps/gateway-server`'s
   benefit) — see `@ai-gateway/gateway-runtime`'s own doc comment on that
   function.

5. **No `@vercel/node` dependency.** The classic Node.js `(request:
IncomingMessage, response: ServerResponse)` handler shape needs only
   `node:http`'s own types, which this app already depends on
   transitively; adding `@vercel/node` purely for its `VercelRequest`/
   `VercelResponse` type conveniences would be a dependency this
   milestone's "only introduce the minimum code necessary" doesn't
   require. `api/v1/[...path].ts` extends `IncomingMessage` locally with
   the one field it actually reads (`query.path`, Vercel's dynamic
   route-segment capture).

6. **No `bodyParser: false` config.** That's a Next.js pages-router
   convention. On a plain (non-Next.js) Vercel project, `request.body` is
   documented as a lazily-computed getter — never triggered unless
   accessed. The shared `readJsonBody` reads `req` as a raw stream via
   `data`/`end` events and never touches `.body`, so the stream reaches it
   unconsumed with no extra configuration.

7. **Implementation note, not a decision made here:** Vercel's Node.js
   runtime documentation (as of 2026-05-19) also supports auto-detecting a
   full `createServer(...).listen(...)` Node HTTP server as a Function
   entrypoint directly ("deploy a Node.js server"), which the approved
   architecture's "does not call `createServer()`/`.listen()`" language
   predates. This implementation follows the approved architecture as
   written rather than substituting a newly-available alternative; see
   `docs/Hosting-architecture/EM-5.5-vercel-deployment-architecture-review.md`'s
   Revision History for the specific consequence if a future architecture
   review revisits this.

## Testing strategy

Same shape as `apps/gateway-server`'s (`apps/gateway-server/README.md`,
"Testing strategy") and `@ai-gateway/gateway-runtime`'s:

- **Unit:** `vercel-config.ts` (env parsing/validation — every case
  mirrors `apps/gateway-server/test/server-config.test.ts` minus
  `HOST`/`PORT`) and `runtime.ts` (`getWarmInstance()`'s cache and its
  reset-on-failure behavior).
- **Integration (shared harness):** `test/integration/end-to-end.test.ts`
  imports `@ai-gateway/gateway-runtime`'s own `startTestDispatchServer`
  directly and drives the exact same scenarios and assertions as
  `apps/gateway-server/test/integration/end-to-end.test.ts` and
  `gateway-runtime`'s own suite. Passing with the same assertions is this
  milestone's concrete evidence for "no behaviour differs between the two
  deployment targets except hosting lifecycle."
- **This app's own unique surface:** `test/api-entrypoint.test.ts` drives
  the _real_, exported `api/v1/[...path].ts` handler (not
  `dispatchGatewayRequest` in isolation) via a test-only ephemeral
  `node:http` server that simulates Vercel's `req.query.path` capture from
  the real incoming URL — the one piece of logic genuinely unique to this
  app (path derivation, warm-instance wiring) and not exercised anywhere
  else. Network-free by design (unauthenticated requests, which fail
  synchronously in `AuthMiddleware` before any provider adapter is ever
  reached) — this file is the only one in either app's suite that
  constructs the _real_ `GroqAdapter`/`NimAdapter` (no test seam is
  reachable from the real entrypoint), so it carries a longer explicit
  timeout to account for that real construction cost under parallel test
  execution.

## Deferred work

- Everything `apps/gateway-server/README.md`'s "Deferred work" already
  lists (out of scope for both apps identically).
- Confirming the exact `maxDuration` for a given Vercel plan against the
  orchestrator's real worst-case stream length — an operator/capacity
  decision, not something this implementation can determine on its own
  (see `docs/release/DEPLOYMENT-VERCEL.md`).
- Revisiting the `createServer().listen()` auto-detection capability
  (Engineering decision 7 above) in a future architecture review, if
  desired.
