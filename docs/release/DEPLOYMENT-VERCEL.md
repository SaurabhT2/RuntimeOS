# Deployment Guide — AI Gateway on Vercel (`apps/vercel-adapter`)

This document covers how to deploy `apps/vercel-adapter`, the additive
Vercel composition root introduced in EM-5.5
(`docs/Hosting-architecture/EM-5.5-vercel-deployment-architecture-review.md`,
approved). It is a sibling to [`DEPLOYMENT.md`](DEPLOYMENT.md), not a
replacement for it: `apps/gateway-server` remains the reference Node/
container deployment, completely unmodified by this milestone, and
everything in `DEPLOYMENT.md` still applies to it unchanged. Read
[`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md) §1 first — every limitation
documented there for a single Node process applies here too, plus the
Vercel-specific consequences noted below.

For what's identical vs. different between the two deployment targets, and
why, see `apps/vercel-adapter/README.md`.

## Prerequisites

Same as [`DEPLOYMENT.md`](DEPLOYMENT.md)'s prerequisites (Node ≥ 20, pnpm
via Corepack, provider credentials), plus:

- A Vercel account/project with **Root Directory** set to
  `apps/vercel-adapter`.
- The Node.js runtime (this app uses `node:http`, `node:crypto`, and
  streaming responses — not the Edge runtime).

## Vercel project setup

1. Create a new Vercel Project from this repository.
2. Set **Root Directory** to `apps/vercel-adapter`.
3. `apps/vercel-adapter/vercel.json` (versioned, not dashboard-only)
   already specifies the Install/Build Commands needed for a pnpm
   monorepo where a workspace member depends on other workspace packages'
   already-built `dist/` output:

   ```json
   "installCommand": "cd ../.. && corepack enable && pnpm install --frozen-lockfile",
   "buildCommand": "cd ../.. && pnpm build"
   ```

   Both `cd ../..` back to the repository root: Root Directory changes the
   working directory for these commands, but `pnpm build` (`turbo run
build`) needs to run against the whole workspace so every package this
   app imports (`@ai-gateway/orchestrator`, `middleware`, the provider
   adapters, etc.) is compiled to `dist/` before Vercel's own function
   bundler traces `api/v1/[...path].ts`'s imports.

4. `vercel.json` also configures the one Vercel Function this app ships
   (`api/v1/[...path].ts`, a catch-all serving `/v1/execute`,
   `/v1/execute/stream`, and `/v1/health` after `rewrites` strips the
   `/api` prefix) with:

   - `"supportsCancellation": true` — see "Streaming and request
     cancellation" below.
   - `"maxDuration": 60` — a placeholder. **Tune this to your Vercel
     plan's limits and your orchestrator's worst-case stream length**
     (retries, failover, and provider latency all extend it). This is the
     same capacity/operator decision the architecture review (§9) leaves
     unresolved; there is no single correct default across plans.

## Environment variables

Loaded and validated by `apps/vercel-adapter/src/vercel-config.ts`,
lazily, on the first invocation a given warm instance handles (see
"In-memory state and multiple instances" below) — set these as the
Vercel Project's Environment Variables. Every variable below has the
**same name, default, and validation** as `DEPLOYMENT.md`'s table for
`apps/gateway-server`, with one exception: there is no `HOST`/`PORT` —
Vercel owns request routing entirely; there is no listen socket for this
app to configure.

| Variable                              | Required?                                         | Default                                     | Purpose                                                                                                                                                                                             |
| ------------------------------------- | ------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GATEWAY_CONFIG_PATH`                 | No                                                | — (falls back to `DEFAULT_GATEWAY_CONFIG`)  | Path to a `GatewayConfig` JSON file. If set, the file must be present in the deployed Function's bundle (see `vercel.json`'s `functions.*.includeFiles` if it lives outside `apps/vercel-adapter`). |
| `GROQ_PLATFORM_API_KEY_ENV_VAR`       | No                                                | `GROQ_PLATFORM_API_KEY`                     | Name of the environment variable holding the actual Groq platform API key.                                                                                                                          |
| `NVIDIA_NIM_PLATFORM_API_KEY_ENV_VAR` | No                                                | `NVIDIA_NIM_PLATFORM_API_KEY`               | Same, for NVIDIA NIM.                                                                                                                                                                               |
| `CREDENTIAL_PRIORITY`                 | No                                                | `DEFAULT_GATEWAY_CONFIG.credentialPriority` | Comma-separated resolution order.                                                                                                                                                                   |
| `GATEWAY_API_KEYS_JSON`               | **Yes**, unless `GATEWAY_ALLOW_DEV_DEFAULTS=true` | —                                           | JSON array of `{ apiKey, tenant, role }` records.                                                                                                                                                   |
| `GATEWAY_ALLOW_DEV_DEFAULTS`          | No                                                | unset                                       | `"true"` falls back to a single insecure dev key. **Never set this on a Production or Preview deployment that's reachable by anyone but you.**                                                      |
| `RATE_LIMIT_REQUESTS_PER_WINDOW`      | No                                                | package default                             | Token-bucket size — per warm instance, not global; see below.                                                                                                                                       |
| `RATE_LIMIT_WINDOW_MS`                | No                                                | package default                             | Rate-limit window, in milliseconds.                                                                                                                                                                 |
| `CACHE_TTL_MS`                        | No                                                | package default                             | Response cache TTL — per warm instance.                                                                                                                                                             |
| `CACHE_INCLUDE_TENANT`                | No                                                | `true`                                      | Whether the cache key includes tenant scope.                                                                                                                                                        |

You must also set whichever environment variable
`GROQ_PLATFORM_API_KEY_ENV_VAR`/`NVIDIA_NIM_PLATFORM_API_KEY_ENV_VAR` point
to, exactly as in the Node deployment.

## Routes

Identical paths, methods, request/response shapes, and status codes to
`apps/gateway-server` (`DEPLOYMENT.md`'s "Health endpoint" section applies
verbatim to `GET /v1/health` here too):

- `POST /v1/execute`
- `POST /v1/execute/stream` (Server-Sent Events)
- `GET /v1/health` — no authentication required.

`vercel.json`'s `rewrites` maps these public paths onto the single
`api/v1/[...path].ts` Function; there is no `/api`-prefixed public route.

## Streaming and request cancellation

`POST /v1/execute/stream` streams `text/event-stream` chunks exactly like
the Node deployment. Two Vercel-specific points:

- **`supportsCancellation: true`** (`vercel.json`) is what makes a client
  disconnect promptly reach `apps/vercel-adapter`'s cancellation handling
  — without it, an abandoned stream may keep running (and keep consuming
  Function execution time/cost) until it finishes or times out on its
  own. See Vercel's own documentation on request cancellation for the
  current mechanics.
- **`maxDuration`** bounds every request this Function serves, including
  `/v1/execute` and `/v1/health` — not just the streaming route — because
  all three share one Function (deliberately, so they share one warm
  instance's in-memory state; see below). Size it to your slowest
  expected stream, not your fastest request.

## In-memory state and multiple instances

Exactly the caveat `KNOWN_LIMITATIONS.md` §1.1 already documents for
`apps/gateway-server` under horizontal scaling, restated for Vercel's
specific instance model: rate-limit counters, the response cache, and
circuit-breaker state live in one warm instance's memory
(`apps/vercel-adapter/src/runtime.ts`), reused across invocations on that
instance but never shared with any other concurrent instance, and reset
entirely on a cold start. Under load, Vercel may run any number of
concurrent instances of this Function, each with independent state — the
same **consequence** as running multiple replicas of `apps/gateway-server`
behind a load balancer without shared state, just via a different
mechanism (platform-managed instances instead of manually-run replicas).
This is not a regression introduced by the Vercel target; it is the same,
already-documented v1.0 limitation surfacing under a different hosting
model.

## Logging and telemetry

Same as [`DEPLOYMENT.md`](DEPLOYMENT.md)'s "Logging" and "Telemetry"
sections: structured JSON lines to stdout, and `createTelemetry()` without
a registered OTel SDK provider (spans/metrics are real but inert until you
register one). On Vercel, stdout is captured by Vercel's own log
system/log drains — there is no `journald`/container log driver to
configure separately.

## Production recommendations

- **Set a real `GATEWAY_API_KEYS_JSON`** and never enable
  `GATEWAY_ALLOW_DEV_DEFAULTS` on a reachable deployment (same as
  `DEPLOYMENT.md`).
- **Tune `maxDuration`** to your actual worst-case stream length and your
  Vercel plan's limits (see above) — do not leave the placeholder value
  unexamined.
- **Supply real model registry seed data** via `bootstrap()`'s
  `overrides.modelRegistrySeed`, same as the Node deployment.
- **Register an OTel exporter** if you need traces/metrics to leave the
  process.
- **Do not assume rate limits or cache hits are consistent across
  requests** under concurrent Vercel instances (see above).

## Deployment limitations

Everything in [`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md) that applies
to `apps/gateway-server` applies here too, with §1.1 (single/multi-instance
state) reframed per "In-memory state and multiple instances" above. This
deployment target adds no new capability limitations beyond what
EM-5.5's architecture review already identifies (Finding 4: in-memory
state under multiple instances; Finding 5: streaming duration bounded by
plan/runtime `maxDuration`).
