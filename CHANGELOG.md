# Changelog

All notable changes to the AI Gateway platform are documented in this file.

This is the **first official release**. There is no prior release history to
reconcile — the entries below describe what Version 1.0.0 contains, not what
changed relative to an earlier tag.

For per-package semantic-versioning detail (each package versions
independently via [Changesets](https://github.com/changesets/changesets)),
see [`docs/release/VERSIONING.md`](docs/release/VERSIONING.md). For a
narrative, user-facing description of this release, see
[`docs/release/RELEASE_NOTES.md`](docs/release/RELEASE_NOTES.md).

---

## [1.0.0] — v1.0 Baseline (EM-0 – EM-5)

### Overview

AI Gateway v1.0.0 is the first tagged release of the platform: a
provider-agnostic AI execution gateway that accepts a caller's task
description and routes, executes, retries, and fails over across AI
providers without the caller ever naming a provider or model. This release
packages the full v1.0 MVP scope defined by the
[Architecture Specification](docs/architecture/architecture-spec.md) and
the [Engineering Blueprint](docs/architecture/engineering-blueprint.md),
and is delivered as a single deployable process,
[`apps/gateway-server`](apps/gateway-server/README.md).

### Milestone summary

Per Engineering Blueprint §7, the following milestones are complete and
included in this release:

| Milestone | Scope delivered |
|---|---|
| **EM-0** | Monorepo scaffold and shared tooling; `core-contracts` implemented and frozen at `1.0.0`. |
| **EM-1** | `provider-sdk` (`ProviderAdapter` interface, Mock Adapter, conformance harness), `telemetry`, `config`. |
| **EM-2** | `reliability` (retry engine, circuit breaker, timeout manager, health monitor), `model-registry`, `credential-resolver`. |
| **EM-3** | `policy-engine` (task-to-model scoring, ranking, `ExecutionPlan` assembly), the Groq and NVIDIA NIM provider adapters, `streaming`. |
| **EM-4** | `orchestrator` (full request lifecycle: policy → credential resolution → retry → failover → streaming → completion), `middleware` (auth, rate limiting, response caching). |
| **EM-5** | `apps/gateway-server` (the composition root), `examples/*`. |

See [`docs/history/IMPLEMENTATION_PROGRESS.md`](docs/history/IMPLEMENTATION_PROGRESS.md)
for full acceptance-criteria detail on each milestone.

### Major capabilities

- **Provider-agnostic execution.** Callers submit an `ExecuteRequest`
  (task, content, constraints, preferences) and never name a provider or
  model directly; the Policy Engine selects one.
- **Automatic retry and failover.** A retryable failure is retried per a
  configurable backoff policy; exhausted retries trigger failover to the
  next-ranked candidate provider, gated by a per-`(providerId, modelClass)`
  circuit breaker.
- **Streaming and non-streaming execution.** `POST /v1/execute` returns a
  single response; `POST /v1/execute/stream` returns Server-Sent Events,
  with failover only possible before the first chunk reaches the caller.
- **BYOK and platform-managed credentials.** Per-tenant credential
  resolution across `user`/`project`/`workspace`/`organization`/`platform`
  scopes, with envelope encryption at rest and append-only audit logging
  of every credential lifecycle event.
- **Multi-tenant isolation.** Every credential lookup, rate-limit counter,
  and cache entry is scoped by tenant and independently tested for
  cross-tenant isolation at two enforcement layers.
- **Authentication and rate limiting.** API-key authentication and a
  continuously-refilling, tenant-scoped token-bucket rate limiter sit in
  front of every request.
- **Response caching.** Deterministic, non-streaming requests may be
  served from a TTL'd, tenant-scoped cache.
- **Operational health reporting.** `GET /v1/health` runs a real
  `ProviderAdapter.healthCheck` against every registered adapter and
  reports `ok` / `degraded` / `unhealthy`, suitable as a container
  orchestrator readiness probe.
- **Graceful shutdown.** `SIGTERM`/`SIGINT` stop new connections, drain
  in-flight requests, and force-exit after a configurable grace period.

### Architecture highlights

- **Single composition root.** `apps/gateway-server/src/bootstrap.ts` is
  the only file in the codebase that imports every package's concrete
  implementation; every other package depends only on interfaces.
- **Enforced package boundaries**, checked three independent ways in CI:
  pnpm's non-hoisted workspace resolution, `dependency-cruiser` (the
  canonical, CI-gated check), and ESLint's `eslint-plugin-boundaries`
  (see [ADR-0003](docs/adr/0003-boundary-enforcement-layers.md)).
- **`core-contracts` frozen at `1.0.0`** as the one dependency every other
  package and every external consumer shares — see
  [ADR-0001](docs/adr/0001-em0-core-contracts-freeze.md).
- **Zero provider leakage.** No provider SDK type or assumption is
  importable outside `packages/providers/*`; every adapter is validated
  against a shared conformance suite (`tools/adapter-conformance-tests`).

### Public APIs

- `POST /v1/execute` — non-streaming execution.
- `POST /v1/execute/stream` — Server-Sent Events streaming execution.
- `GET /v1/health` — unauthenticated health/readiness endpoint.

Architecture §10.2 additionally specifies `GET /v1/tasks`, `GET /v1/usage`,
and `POST|DELETE /v1/credentials`. These are **not implemented in v1.0.0**
— see [`docs/release/KNOWN_LIMITATIONS.md`](docs/release/KNOWN_LIMITATIONS.md)
for why this is a deliberate scope boundary rather than an oversight.

### Streaming

Server-Sent Events (`text/event-stream`), one `data: {StreamChunk}\n\n`
frame per chunk, terminated by a `done: true` chunk. A failure before any
chunk is sent surfaces as a normal non-2xx JSON error; a failure after
streaming has started surfaces as a final `data: {"error": GatewayError}\n\n`
frame, since the HTTP status code can no longer change at that point.
WebSocket transport is not implemented in v1.0.0.

### Providers

Two real provider adapters ship in v1.0.0:

- **Groq** — OpenAI-compatible chat completions endpoint, streaming and
  non-streaming, with a proactive token-bucket rate limiter tuned to
  free-tier limits.
- **NVIDIA NIM** — structurally equivalent adapter, without a proactive
  rate limiter.

Both pass the shared adapter conformance suite. A `MockAdapter` is also
shipped (in `provider-sdk`) for testing and local development without
real provider credentials.

### Breaking changes

None — this is the first release.

### Known exclusions

The following are intentionally out of scope for v1.0.0 and are tracked
as deferred work, not defects:

- Multi-instance / horizontally-scaled deployment (see
  [`docs/release/KNOWN_LIMITATIONS.md`](docs/release/KNOWN_LIMITATIONS.md)).
- `GET /v1/tasks`, `GET /v1/usage`, `POST|DELETE /v1/credentials`.
- RBAC authorization enforcement (authentication only in v1.0.0).
- Vault / AWS Secrets Manager / Azure Key Vault / GCP Secret Manager
  credential sources (env-var and DB-backed sources only).
- WebSocket streaming transport.
- Fully preemptive request cancellation.
- OpenAPI schema generation.

Four architecture/implementation gaps remain open as **proposed / draft**
ADRs, not yet decided by the Architecture Review Board — see
[`docs/adr/README.md`](docs/adr/README.md) and
[`docs/release/KNOWN_LIMITATIONS.md`](docs/release/KNOWN_LIMITATIONS.md).

---

## Release governance artifacts added in this pass

This release also adds the governance documentation a public v1.0 platform
release requires: `CONTRIBUTING.md`, `SECURITY.md`, and
`docs/release/{RELEASE_NOTES,KNOWN_LIMITATIONS,DEPLOYMENT,VERSIONING,
RELEASE_CHECKLIST,SUPPORT_POLICY}.md`. See
[`docs/release/README.md`](docs/release/README.md) for the index. No
runtime code, package, or architecture document was modified to produce
this release; see that document's own Validation section for confirmation.
