# Deployment Guide — AI Gateway (through v1.2)

This document covers how to run `apps/gateway-server`, the platform's
Node/container composition root, in a real environment, current through
the v1.2 release (EM-0 – EM-11). For what the deployed process can and
cannot do at scale, see [`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md) §1
(Deployment and scaling) first — the platform still targets a
**single-instance deployment**; this has not changed since v1.0. For the
Vercel-hosted alternative composition root, see
`apps/vercel-adapter/README.md` and
[`DEPLOYMENT-VERCEL.md`](DEPLOYMENT-VERCEL.md).

**What's new to deploy since v1.0:** the Strategy Layer
(`ENABLE_STRATEGY_LAYER`, opt-in, default off — see
["Strategy Layer" below](#strategy-layer-em-8-v11v12)) and
`POST /v1/execute/pipeline` (always available, no flag — see
["Pipeline Orchestration" below](#pipeline-orchestration-em-10-v12)) are
both reachable through `apps/gateway-server`'s normal environment-variable
configuration. **Budget Governance is not** — see
["Budget Governance" below](#budget-governance-em-10-v12) for why and
what to do about it.

## Prerequisites

- **Node.js ≥ 20** (`engines.node` in the root `package.json`).
- **pnpm**, via Corepack (`corepack enable` — the exact version is
  pinned in the root `package.json`'s `packageManager` field).
- Credentials for at least one of the two shipped provider adapters
  (Groq and/or NVIDIA NIM) — the server requires both provider
  platform-key environment variable _names_ to be set (see below), but
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

| Variable                              | Required?                                         | Default                                                                     | Purpose                                                                                                                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HOST`                                | No                                                | `0.0.0.0`                                                                   | Listen address.                                                                                                                                                                                                                                                              |
| `PORT`                                | No                                                | `3000`                                                                      | Listen port.                                                                                                                                                                                                                                                                 |
| `GATEWAY_CONFIG_PATH`                 | No                                                | — (falls back to `DEFAULT_GATEWAY_CONFIG`, hot-reload disabled)             | Path to a `GatewayConfig` JSON file (routing/reliability policy — see `@ai-gateway/config`).                                                                                                                                                                                 |
| `GROQ_PLATFORM_API_KEY_ENV_VAR`       | No                                                | `GROQ_PLATFORM_API_KEY`                                                     | Name of the environment variable that holds the actual Groq platform API key.                                                                                                                                                                                                |
| `NVIDIA_NIM_PLATFORM_API_KEY_ENV_VAR` | No                                                | `NVIDIA_NIM_PLATFORM_API_KEY`                                               | Same, for NVIDIA NIM.                                                                                                                                                                                                                                                        |
| `CREDENTIAL_PRIORITY`                 | No                                                | `DEFAULT_GATEWAY_CONFIG.credentialPriority`                                 | Comma-separated resolution order, e.g. `workspace,organization,platform`.                                                                                                                                                                                                    |
| `GATEWAY_API_KEYS_JSON`               | **Yes**, unless `GATEWAY_ALLOW_DEV_DEFAULTS=true` | —                                                                           | JSON array of `{ apiKey, tenant: { organizationId, workspaceId?, projectId?, userId? }, role }` records — the gateway's own caller authentication.                                                                                                                           |
| `GATEWAY_ALLOW_DEV_DEFAULTS`          | No                                                | unset                                                                       | Set to `"true"` to fall back to a single, explicitly insecure development API key (`dev-local-only-insecure-key`) when `GATEWAY_API_KEYS_JSON` is unset. **Never set this in a reachable or production deployment** — the process logs a loud warning if it starts this way. |
| `RATE_LIMIT_REQUESTS_PER_WINDOW`      | No                                                | package default                                                             | Token-bucket size for the rate limiter.                                                                                                                                                                                                                                      |
| `RATE_LIMIT_WINDOW_MS`                | No                                                | package default                                                             | Rate-limit window, in milliseconds.                                                                                                                                                                                                                                          |
| `CACHE_TTL_MS`                        | No                                                | package default                                                             | Response cache TTL, in milliseconds.                                                                                                                                                                                                                                         |
| `CACHE_INCLUDE_TENANT`                | No                                                | `true`                                                                      | Whether the cache key includes tenant scope. Only relax this for genuinely tenant-independent, non-sensitive task types.                                                                                                                                                     |
| `ENABLE_STRATEGY_LAYER`               | No                                                | unset (`GatewayConfig.enableStrategyLayer`'s own default, `false`, governs) | `"true"` or `"false"`. Overrides `GatewayConfig.enableStrategyLayer` when set. See ["Strategy Layer"](#strategy-layer-em-8-v11v12) below before enabling in production.                                                                                                      |

There is deliberately no environment variable in this table for Budget
Governance (`budgetPolicies`/`budgetEnforcementMode`) — see
["Budget Governance"](#budget-governance-em-10-v12) below for why, and
for the one supported way to configure it in v1.2.

You must also set whichever environment variable
`GROQ_PLATFORM_API_KEY_ENV_VAR`/`NVIDIA_NIM_PLATFORM_API_KEY_ENV_VAR`
point to (by default, `GROQ_PLATFORM_API_KEY` and
`NVIDIA_NIM_PLATFORM_API_KEY`) if you want platform-managed (non-BYOK)
credentials for that provider.

## Strategy Layer (EM-8, v1.1/v1.2)

Set `ENABLE_STRATEGY_LAYER=true` to route requests through the Strategy
Layer (architecture §30) ahead of Policy Engine — capability matching,
execution-profile-aware routing, cost optimization, and prompt
optimization, composed into one immutable `StrategyDecision`. It is
**off by default** (`false`), and the pass-through regression suite
(`packages/gateway-runtime/test/integration/end-to-end.test.ts`, "EM-8
Pass-through Regression") proves `enableStrategyLayer: true` and `false`
produce byte-for-byte identical `provider`/`retries`/`failedOver`/
`finishReason` results against a Mock Adapter — but that in-repo proof is
not a substitute for a real staging validation before flipping this flag
in production. **Before enabling this flag for production traffic**,
read [`KNOWN_LIMITATIONS.md` §10.1](KNOWN_LIMITATIONS.md#101-ab-replay-of-em-5-load-test-traffic-and-gateway-latency-budget-validation-cannot-be-performed-within-this-repository):
the Engineering Blueprint's own EM-8 exit criteria call for an A/B replay
of real load-test traffic against a staging deployment with a measured
latency budget, and nothing in this repository can perform that
validation — it requires infrastructure (a staging target, a captured
traffic corpus, a latency-measurement harness) that this codebase does
not, and structurally should not, fabricate a stand-in for.

Runtime Profile selection layers on top of the Strategy Layer via
`GatewayConfig.runtimeProfileId` (a `GATEWAY_CONFIG_PATH` JSON field, not
its own environment variable) — see `packages/runtime-profiles/README.md`
for what a Runtime Profile controls, and
[ADR-0020](../adr/0020-runtime-profile-read-sites-gap.md) for which parts
of its documented behavior are not yet wired.

## Pipeline Orchestration (EM-10, v1.2)

`POST /v1/execute/pipeline` is always reachable — there is no feature
flag for it, and it requires no environment-variable configuration
beyond what a normal `apps/gateway-server` deployment already needs.
Each pipeline step runs through the exact same
`ExecutionOrchestrator.execute()` a single-step `POST /v1/execute` call
uses (no second execution engine, no ability to bypass Policy Engine or
the Strategy Layer from a step). The platform-wide step cap defaults to
`pipeline-orchestrator`'s own default of 20 and can only be changed via
`bootstrap()`'s `maxPipelineSteps` override — like Budget Governance
below, there is no `apps/gateway-server` environment variable for this;
the default of 20 is almost always adequate and changing it requires the
same kind of custom composition-root code described below.

## Budget Governance (EM-10, v1.2)

**As shipped, `apps/gateway-server` cannot enable Budget Governance at
all — this is a real gap, not an oversight in this document.**
`budgetPolicies` and `budgetEnforcementMode` are fields on
`@ai-gateway/gateway-runtime`'s `GatewayRuntimeConfig` (what `bootstrap()`
accepts), but `apps/gateway-server/src/server-config.ts`'s
environment-variable loader does not populate either one — there is no
`BUDGET_POLICIES_JSON`, no `BUDGET_ENFORCEMENT_MODE`, and no
`GATEWAY_CONFIG_PATH` field for it either (`budgetPolicies` is not part
of `@ai-gateway/config`'s `GatewayConfig` schema). Running the published
binary (`node dist/index.js`) can never construct a `BudgetLedger` or
`BudgetEnforcer`, regardless of what you set in your environment. Full
detail: [`KNOWN_LIMITATIONS.md` §9.3](KNOWN_LIMITATIONS.md#93-neither-deployment-application-has-a-configuration-surface-for-budget-governance).

**To use Budget Governance in v1.2, write your own thin composition-root
entrypoint** that mirrors `apps/gateway-server/src/index.ts` but supplies
`budgetPolicies`/`budgetEnforcementMode` to `bootstrap()` directly, e.g.:

```ts
import { bootstrap } from "@ai-gateway/gateway-runtime";
import { loadServerConfigFromEnv } from "./server-config.js"; // reuse the existing loader for everything else

const serverConfig = loadServerConfigFromEnv();

const app = await bootstrap({
  ...serverConfig,
  budgetPolicies: [
    {
      tenant: { organizationId: "acme" },
      dailyBudgetUsd: 50,
      thresholds: [
        { atPercentOfBudget: 100, action: "block" },
        { atPercentOfBudget: 80, action: "alert" },
      ],
    },
  ],
  // Start in "shadow" (the default) until you've watched real telemetry
  // for a burn-in period; only then consider "enforcing".
  budgetEnforcementMode: "shadow",
});
```

**Before setting `budgetEnforcementMode: "enforcing"` in that code**,
read [`KNOWN_LIMITATIONS.md` §9.2](KNOWN_LIMITATIONS.md#92-switch_provider-threshold-actions-have-no-effect-on-real-routing--read-this-before-enabling-enforcement-mode)
in full — `block`, `alert`, and `downgrade_model` are verified working
end-to-end; `switch_provider` is not, and configuring
`perProviderSpendCapUsd` with `switch_provider` will silently do nothing
in production. `InMemoryBudgetLedger` is also non-durable (§9.1) — a
restart zeroes cumulative spend, and this platform has no multi-instance
story for it (§1.1).

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
  cache, circuit-breaker state, any BYOK credentials registered only via
  the in-memory credential store, and (if you've wired Budget Governance
  yourself, per the section above) cumulative Budget Ledger spend, do not
  survive a restart.
- **Do not flip `ENABLE_STRATEGY_LAYER=true` in production without a
  staging validation pass first.** See ["Strategy Layer"](#strategy-layer-em-8-v11v12)
  above — the in-repo regression suite alone is not the validation the
  Engineering Blueprint's own exit criteria call for.
- **If you need Budget Governance, budget time to write and test your
  own composition-root entrypoint.** It is not configurable through the
  published `apps/gateway-server` binary — see
  ["Budget Governance"](#budget-governance-em-10-v12) above.

## Reference deployment

The reference/target deployment for this release is a single Node.js
process behind a TLS-terminating reverse proxy or load balancer, at
whatever hostname your organization assigns it — e.g.
`https://gateway.example.com`. Provisioning and DNS/ingress
configuration for your specific host are an operational detail outside
this repository's scope; the requirements above (Node ≥ 20, TLS
terminated upstream, environment variables set per the table above)
apply identically regardless of hostname.

## Deployment limitations

See [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) for common install/build/
runtime failures and their fixes, and [`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md)
for the full list of intentional scope limitations (not defects).
The ones most relevant to a deployment operator specifically are: §1.1
(single-instance state), §1.2 (no database/KMS), §1.3 (no built-in TLS),
§7.1 (no telemetry exporter registered by default), §9.2 (`switch_provider`
budget actions don't affect routing), §9.3 (`apps/gateway-server` has no
configuration surface for Budget Governance at all), and §10.1 (no
in-repo staging/load-test validation path for `ENABLE_STRATEGY_LAYER`).
