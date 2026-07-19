# Changelog

All notable changes to the AI Gateway platform are documented in this file,
most recent release first.

For per-package semantic-versioning detail (each package versions
independently via [Changesets](https://github.com/changesets/changesets)),
see [`docs/release/VERSIONING.md`](docs/release/VERSIONING.md). For a
narrative, user-facing description of a release, see
[`docs/release/RELEASE_NOTES.md`](docs/release/RELEASE_NOTES.md).

---

## [1.2.0] — v1.2 Platform Hardening & Production Readiness (EM-6 – EM-11)

### Overview

AI Gateway v1.2.0 is the second tagged platform release, covering
everything delivered since v1.0.0: the Strategy Layer (capability-aware,
cost-aware, budget-governed request routing, opt-in via
`enableStrategyLayer`), multi-step Pipeline Orchestration, Budget
Governance (now promoted to Enforcement Mode by default for tenants that
configure `budgetPolicies`), and this milestone's own platform-hardening
pass — full regression/conformance/chaos validation, an in-process
performance smoke-test, and a documentation-completeness pass across
every release-governance document. No architectural concept, package,
public interface, or execution path was introduced by EM-11 itself; its
scope was validation and hardening only, per its own Engineering Work
Order.

### Milestone summary

| Milestone | Scope delivered |
|---|---|
| **EM-6** | `capability-registry`, `execution-profile-registry`, Runtime Profiles foundation. |
| **EM-7** | `cost-optimizer`, `prompt-optimizer`, learning extension points, plugin system foundation (Optimization Pipeline). |
| **EM-8** | Strategy Layer integration — `strategy-layer` wires EM-6/EM-7 into a single `StrategyDecision`, consumed by `orchestrator` ahead of `policy-engine`, entirely behind `enableStrategyLayer` (default `false`). Runtime Profile activation (EM-9-attributed work) landed as part of this integration. |
| **EM-10** | `pipeline-orchestrator` (multi-step execution via `ExecutionOrchestrator.execute()` only, `maxSteps`-capped) and `budget-governance` (shadow-mode-first cost governance: thresholds, per-provider caps, cumulative ledger). An Independent Architecture Review returned REQUIRES REWORK on two findings (`BudgetLedger.recordSpend` never wired to production traffic; a telemetry label defect); both were closed in a follow-up rework pass and independently re-verified. |
| **EM-11** | Platform hardening and v1.2 production-readiness validation — no new architecture. Budget Governance promoted to Enforcement Mode. Full regression, provider conformance, chaos-scenario, and performance validation. Documentation finalized across `KNOWN_LIMITATIONS.md`, this changelog, `RELEASE_NOTES.md`, and `IMPLEMENTATION_PROGRESS.md`. |

See [`docs/history/IMPLEMENTATION_PROGRESS.md`](docs/history/IMPLEMENTATION_PROGRESS.md)
for full acceptance-criteria detail on each milestone, and the EM-11
Engineering Completion Report for this release's validation evidence.

### Major capabilities added since v1.0.0

- **Strategy Layer (opt-in via `enableStrategyLayer`)** — capability
  matching, execution-profile-aware routing, cost optimization, and
  prompt optimization, composed into one immutable `StrategyDecision`
  ahead of Policy Engine, with a proven pass-through regression when the
  flag is off (byte-for-byte identical `provider`/`retries`/`failedOver`/
  `finishReason` to the flag being absent).
- **`POST /v1/execute/pipeline`** — sequential multi-step execution
  through the same `ExecutionOrchestrator.execute()` every single-step
  request uses (no second execution engine, no provider/policy bypass),
  `maxSteps`-capped before any step runs, with required/non-required
  per-step failure semantics.
- **Budget Governance** — per-tenant daily/monthly spend budgets with
  configurable threshold actions (`alert`, `downgrade_model`,
  `switch_provider`, `block`), evaluated before execution and enforced
  before Routing Rules. Shipped shadow-mode-first in EM-10; **promoted to
  Enforcement Mode as of v1.2** for any tenant with `budgetPolicies`
  configured. Cumulative spend genuinely accrues from real traffic
  (`BudgetLedger.recordSpend` wired to a post-execution orchestrator hook
  as of the EM-10 rework) and is proven end-to-end, not just unit-tested
  in isolation.

### Known exclusion carried forward with elevated visibility for this release

**`switch_provider` threshold actions do not affect real provider
routing** — the per-provider-cap check that would trigger them never
runs in production (the only `evaluate()` call site always precedes
provider selection), and even if it did, the frozen `StrategyDecision`
interface has no field to carry the exclusion to Policy Engine. This was
low-risk and fully disclosed while Budget Governance was shadow-mode-only
(nothing was actually being enforced regardless); it is more
operationally significant now that v1.2 promotes to Enforcement Mode.
See [`docs/release/KNOWN_LIMITATIONS.md`](docs/release/KNOWN_LIMITATIONS.md)
§9.2 and [ADR-0025](docs/adr/0025-budget-enforcer-provider-id-and-exclusion-gap.md)
(proposed, undecided) for the full detail and operator recommendation.
`block`, `alert`, and `downgrade_model` threshold actions are unaffected
and verified working end-to-end.

### Breaking changes

None. `core-contracts` remains frozen at `1.0.0`; every frozen interface
listed in `docs/release/VERSIONING.md` (`ExecuteRequest`, `ExecuteResponse`,
`ExecutionPlan`, `PolicyEngine`, `ExecutionOrchestrator`, `StrategyDecision`)
is unchanged since its respective freeze milestone.

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
