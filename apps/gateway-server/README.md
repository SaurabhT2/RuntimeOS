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
fallback — see `@ai-gateway/gateway-runtime`'s `extractApiKey`). Returns a
`200` with an `ExecuteResponse` body, or a non-2xx with
`{ error: GatewayError }`.

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

### `POST /v1/execute/pipeline` (v1.2, EM-10, architecture §41.3)

Same auth as `POST /v1/execute` (`Authorization: Bearer <gateway-api-key>`
or `x-api-key`). Always available — no feature flag, no config required
beyond what a normal deployment already needs. Runs every step
sequentially through the same `ExecutionOrchestrator.execute()` a
single-step request uses; no second execution engine, no way to bypass
Policy Engine or (if enabled) the Strategy Layer from a step. Capped at
`maxPipelineSteps` (default 20) before any step runs.

Body:

```jsonc
{
  "id": "pipeline-1",
  "tenant": { "organizationId": "acme", "workspaceId": "eng" }, // same shape as ExecuteRequest.tenant
  "steps": [
    {
      "id": "step-1",
      "task": "summarize", // any TaskType
      "input": { "text": "..." }, // literal input for this step
      "required": true, // optional, default true — see below
    },
    {
      "id": "step-2",
      "task": "chat",
      "inputFrom": "step-1", // OR: use step-1's ExecuteResponse.output as this step's input.text
      // (output.text if present, else JSON.stringify(output.json))
    },
  ],
}
```

Each step supplies exactly one of `input` (a literal
`ExecuteRequest.input`) or `inputFrom` (a prior step's `id`) — not both,
not neither. A step with `required: false` (default `true`) that fails
does not stop the pipeline; a later step's `inputFrom` pointing at a
failed or skipped step's `id` fails with `INVALID_TASK`.

Returns `200` with a `PipelineResult`:

```jsonc
{
  "pipelineId": "pipeline-1",
  "stepResults": {
    "step-1": {/* ExecuteResponse */},
    "step-2": {/* ExecuteResponse, or a serialized GatewayError if this step failed */},
  },
  "totalCostUsd": 0.0031, // sum of every successful step's usage.estimatedCostUsd
  "durationMs": 842, // wall-clock duration of the whole call
}
```

A step never reached because an earlier `required` step failed has no
entry in `stepResults` at all. There is no dedicated caching step for
pipeline results (architecture §41 doesn't call for one, and the shared
`MiddlewarePipeline`'s cache step is typed for one `ExecuteRequest` in /
`ExecuteResponse` out, which a multi-step pipeline doesn't fit).

**Budget Governance note:** if a deployment has wired Budget Governance
in via a custom composition root (see
[`docs/release/DEPLOYMENT.md`](../../docs/release/DEPLOYMENT.md#budget-governance-em-10-v12) —
the published `apps/gateway-server` binary cannot do this on its own),
budget enforcement applies per step, the same as it would to an
equivalent standalone `POST /v1/execute` call for that step.

See [`examples/pipeline-client`](../../examples/pipeline-client) for a
complete, runnable external client calling this endpoint.

## Runtime composition

The composition root itself — `bootstrap()`, `GatewayApp`, the router, the
route handlers, request parsing, validation, and response-shaping — lives
in `@ai-gateway/gateway-runtime` (a shared `packages/*` dependency, not
something this app defines), per
[ADR-0012](../../docs/adr/0012-shared-gateway-runtime-package.md). See
that package's README for the wiring order and every design decision
made when writing it (it originated here, in EM-5, before the EM-5.5
extraction — the decisions carry over unchanged).

What remains in this app is exactly its own hosting lifecycle: `src/index.ts`
is the only file with process-level side effects (loads env config via
`server-config.ts`, calls the shared `bootstrap()`, starts the HTTP
server, registers signal handlers) and is guarded so importing it (e.g.
from a future tool) never has those side effects — only running it
directly does. `src/http/server.ts` builds the shared route table once
(`buildGatewayRouter`) and wraps the shared `dispatchGatewayRequest` in a
real `node:http` `createServer()` call — this file owns the listen socket;
the shared package never does.

## Engineering decisions

1. **Fail-fast environment-driven configuration.** `src/server-config.ts`
   loads and Zod-validates every process-level setting (listen
   address, which env var holds each provider's platform key, gateway API
   keys, rate-limit/cache tuning) and throws before any network listener
   opens if anything required is missing or malformed — this milestone's
   own "no silent configuration failures" requirement. `GatewayServerConfig`
   extends the shared package's `GatewayRuntimeConfig` with exactly one
   local addition, `http: { host, port }` — `bootstrap()` never reads it
   (see `gateway-runtime`'s README).

2. **`http/server.ts` is a thin wrapper, not a second implementation of
   routing.** It builds the shared router once at server-construction
   time (not per-request) and delegates every request to
   `dispatchGatewayRequest` — the exact same function
   `apps/vercel-adapter` awaits per-invocation. This file's only job is
   "own the `createServer`/`.listen()` call"; see
   [ADR-0012](../../docs/adr/0012-shared-gateway-runtime-package.md) for
   why the routing/dispatch logic itself isn't duplicated here.

Every other design decision this app's HTTP layer embodies (no framework,
model-registry seed handling, the `GatewayConfig.reliability` gap, HTTP-
boundary validation ordering, the `CREDENTIAL_INVALID`/`CREDENTIAL_NOT_FOUND`
status mapping, streaming auth sequencing) now lives in
`@ai-gateway/gateway-runtime`'s README, since that's where the code those
decisions describe now lives.

## Testing strategy

- **Unit:** `server-config.ts` (env parsing/validation, including the one
  field genuinely local to this app, `http`) and `lifecycle.ts` (graceful
  shutdown, signal handling, a simulated hung-close force-exit).
- **Integration:** `test/integration/end-to-end.test.ts` drives this
  app's _real_ `createHttpServer(app)` + `.listen()` assembly over real
  HTTP — proving this app's own hosting-layer wiring is correct, not
  re-deriving the underlying request-handling behavior from scratch
  (that's `@ai-gateway/gateway-runtime`'s own integration suite's job;
  see that package's README, Testing strategy). Fake, in-memory
  `ProviderAdapter`s throughout — never a live network call in CI.
- **Coverage:** 91.3/88.3/100/91.3 (statements/branches/functions/lines).
  The route/handler/router/bootstrap unit tests that used to be counted
  here moved to `@ai-gateway/gateway-runtime`'s own suite along with the
  code they test — see that package's README for its own (higher)
  coverage numbers.

## Deferred work

- `/v1/tasks`, `/v1/usage`, `POST|DELETE /v1/credentials` — see Scope
  verification above.
- **No environment variable or config-file field for Budget Governance.**
  `server-config.ts`'s `loadServerConfigFromEnv` populates every other
  `GatewayRuntimeConfig` field `bootstrap()` needs from `process.env` —
  including `enableStrategyLayer` — but not `budgetPolicies` or
  `budgetEnforcementMode`. This app cannot construct Budget Governance as
  shipped; a deployment that wants it must write its own composition-root
  entrypoint that calls `bootstrap()` with those fields directly, rather
  than running `dist/index.js` as-is. See
  [`docs/release/KNOWN_LIMITATIONS.md` §9.3](../../docs/release/KNOWN_LIMITATIONS.md#93-neither-deployment-application-has-a-configuration-surface-for-budget-governance)
  and [`docs/release/DEPLOYMENT.md`](../../docs/release/DEPLOYMENT.md#budget-governance-em-10-v12).
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
