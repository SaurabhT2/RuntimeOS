# Deployment Guide — AI Gateway v1.0

This document covers how to run `apps/gateway-server`, the v1.0
composition root, in a real environment. For what the deployed process
can and cannot do at scale, see
[`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md) §1 (Deployment and
scaling) first — v1.0 targets a **single-instance deployment**.

## Prerequisites

- **Node.js ≥ 20** (`engines.node` in the root `package.json`).
- **pnpm**, via Corepack (`corepack enable` — the exact version is
  pinned in the root `package.json`'s `packageManager` field).
- Credentials for at least one of the two shipped provider adapters
  (Groq and/or NVIDIA NIM) — the server requires both provider
  platform-key environment variable *names* to be set (see below), but
  a request can still succeed via BYOK credentials even if a platform
  key for a given provider is absent, as long as at least one adapter
  can resolve a credential at request time.
- No external database or cache is required to run v1.0 — every store
  is in-memory (see `KNOWN_LIMITATIONS.md` §1.2). Plan infrastructure
  accordingly: a restart clears rate-limit counters, the response cache,
  circuit-breaker state, and any BYOK credentials registered only in
  that process's memory.

## Build

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build   # turbo run build — builds every package in dependency order
```

## Environment variables

All server-level configuration is loaded from `process.env` and
validated at startup (`apps/gateway-server/src/server-config.ts`); an
invalid or missing required value throws **before the server opens a
network listener** — there is no silent fallback to a broken
configuration.

| Variable | Required? | Default | Purpose |
|---|---|---|---|
| `HOST` | No | `0.0.0.0` | Listen address. |
| `PORT` | No | `3000` | Listen port. |
| `GATEWAY_CONFIG_PATH` | No | — (falls back to `DEFAULT_GATEWAY_CONFIG`, hot-reload disabled) | Path to a `GatewayConfig` JSON file (routing/reliability policy — see `@ai-gateway/config`). |
| `GROQ_PLATFORM_API_KEY_ENV_VAR` | No | `GROQ_PLATFORM_API_KEY` | Name of the environment variable that holds the actual Groq platform API key. |
| `NVIDIA_NIM_PLATFORM_API_KEY_ENV_VAR` | No | `NVIDIA_NIM_PLATFORM_API_KEY` | Same, for NVIDIA NIM. |
| `CREDENTIAL_PRIORITY` | No | `DEFAULT_GATEWAY_CONFIG.credentialPriority` | Comma-separated resolution order, e.g. `workspace,organization,platform`. |
| `GATEWAY_API_KEYS_JSON` | **Yes**, unless `GATEWAY_ALLOW_DEV_DEFAULTS=true` | — | JSON array of `{ apiKey, tenant: { organizationId, workspaceId?, projectId?, userId? }, role }` records — the gateway's own caller authentication. |
| `GATEWAY_ALLOW_DEV_DEFAULTS` | No | unset | Set to `"true"` to fall back to a single, explicitly insecure development API key (`dev-local-only-insecure-key`) when `GATEWAY_API_KEYS_JSON` is unset. **Never set this in a reachable or production deployment** — the process logs a loud warning if it starts this way. |
| `RATE_LIMIT_REQUESTS_PER_WINDOW` | No | package default | Token-bucket size for the rate limiter. |
| `RATE_LIMIT_WINDOW_MS` | No | package default | Rate-limit window, in milliseconds. |
| `CACHE_TTL_MS` | No | package default | Response cache TTL, in milliseconds. |
| `CACHE_INCLUDE_TENANT` | No | `true` | Whether the cache key includes tenant scope. Only relax this for genuinely tenant-independent, non-sensitive task types. |

You must also set whichever environment variable
`GROQ_PLATFORM_API_KEY_ENV_VAR`/`NVIDIA_NIM_PLATFORM_API_KEY_ENV_VAR`
point to (by default, `GROQ_PLATFORM_API_KEY` and
`NVIDIA_NIM_PLATFORM_API_KEY`) if you want platform-managed (non-BYOK)
credentials for that provider.

## Startup

```bash
node apps/gateway-server/dist/index.js
```

or, from the workspace root:

```bash
pnpm --filter @ai-gateway/gateway-server start
```

Startup order is fixed and fail-fast: environment config is loaded and
validated first, then `bootstrap()` constructs every platform package
exactly once, then the HTTP listener opens. Any failure at any of these
three stages is logged to `stderr` and the process exits non-zero — it
will never start listening in a half-initialized state.

## Shutdown

The process registers `SIGTERM`/`SIGINT` handlers that:

1. Stop accepting new connections (`server.close()`).
2. Let in-flight requests finish naturally.
3. Force-exit after a grace period (default **10 seconds**) if something
   is still hung — so a slow downstream provider call never blocks a
   container orchestrator's shutdown deadline.

This is standard behavior for container orchestrators (Kubernetes,
ECS, etc.) sending `SIGTERM` before a pod/task is killed; no additional
configuration is required to be a well-behaved container workload.

## Health endpoint

`GET /v1/health` — **no authentication required.**

Runs a real `ProviderAdapter.healthCheck` against every registered
provider adapter (never a hardcoded response) and returns:

```json
{
  "status": "ok" | "degraded" | "unhealthy",
  "providers": [
    { "providerId": "groq", "healthy": true, "latencyMs": 42 },
    { "providerId": "nvidia-nim", "healthy": false, "message": "..." }
  ]
}
```

- `ok` (HTTP 200) — every registered provider is healthy.
- `degraded` (HTTP 200) — at least one provider is healthy; the gateway
  can still serve traffic via failover.
- `unhealthy` (HTTP 503) — every registered provider failed its check.

## Readiness endpoint

There is no endpoint separate from `/v1/health` in v1.0. Use
`GET /v1/health` for both liveness and readiness probes:

- **Liveness:** the process responding at all (200 or 503, either is
  "alive") is sufficient — a non-responding process is the only true
  liveness failure.
- **Readiness:** gate traffic on HTTP 200 (`ok` or `degraded`) and treat
  503 (`unhealthy`) as "not ready" — a pod reporting `unhealthy` can
  still serve requests via any BYOK-resolved provider that the platform
  health check didn't exercise, but should generally not receive new
  load-balanced traffic while every platform-checked provider is down.

## Logging

Structured JSON logs, one event per line, written to **stdout** by
default (`@ai-gateway/telemetry`'s `ConsoleLogSink`). Every log line has
a fixed core schema: `timestamp`, `level`, `requestId`, `traceId`,
`tenant`, `message`, plus event-specific context fields. This is
directly ingestible by any log pipeline that reads stdout without a
custom parser (e.g., a container platform's default log driver, or a
sidecar shipping to your log aggregator of choice).

To ship logs elsewhere, redirect stdout at the process-supervision layer
(container log driver, `journald`, a process manager) — there is no
in-process log-shipping configuration in v1.0.

## Telemetry (traces and metrics)

**Important:** `@ai-gateway/telemetry` wraps the OpenTelemetry API, but
`@ai-gateway/gateway-runtime`'s `bootstrap()` (the composition root
`apps/gateway-server` calls) only calls `createTelemetry()` —
it does **not** register an OTel `TracerProvider`, `MeterProvider`, or
exporter. Every span and metric the gateway produces (`startSpan`,
`recordMetric`) is real and correctly formed, but is an inert no-op
until an SDK provider is registered somewhere in the process.

To actually export traces/metrics to a backend (Jaeger, Tempo,
Honeycomb, Datadog, or any OTLP-compatible collector), you must register
an OTel SDK provider and exporter yourself — for example, by requiring
`@opentelemetry/sdk-node` with your chosen exporter ahead of
`apps/gateway-server`'s entrypoint, following standard OTel Node.js
auto-instrumentation setup. This is intentional: the Telemetry package's
whole design point is that exporters are swappable via OTel's own
configuration, never via a code change in this codebase — but it does
mean **no traces or metrics leave the process by default in v1.0.**
Logs are the one telemetry signal that works out of the box (see above).

## Production recommendations

- **Run behind a TLS-terminating reverse proxy, load balancer, or
  ingress.** The gateway process itself speaks plain HTTP.
- **Run a single instance**, or multiple instances that you're
  comfortable each having independent rate-limit/cache/circuit-breaker
  state (see `KNOWN_LIMITATIONS.md` §1.1). Do not rely on rate limiting
  or caching being consistent across replicas in v1.0.
- **Supply real model registry seed data.** The shipped `SEED_MODELS`
  uses placeholder model IDs; use `bootstrap()`'s
  `overrides.modelRegistrySeed` to supply real ones for your deployment.
- **Never set `GATEWAY_ALLOW_DEV_DEFAULTS=true`** outside local
  development.
- **Register an OTel exporter** if you need traces/metrics (see above)
  — don't assume they're already being collected.
- **Plan for process restarts to clear state.** In-memory rate limits,
  cache, circuit-breaker state, and any BYOK credentials registered only
  via the in-memory credential store do not survive a restart.

## Reference deployment

The reference/target deployment for this release is
`runtime.saurabhtiwariai.com`. Provisioning and DNS/ingress configuration
for that specific host are an operational detail outside this
repository's scope; the requirements above (Node ≥ 20, TLS terminated
upstream, environment variables set per the table above) apply
identically regardless of hostname.

## Deployment limitations

See [`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md) for the full list.
The ones most relevant to a deployment operator specifically are: §1.1
(single-instance state), §1.2 (no database/KMS), §1.3 (no built-in TLS),
and §7.1 (no telemetry exporter registered by default).
