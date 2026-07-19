# AI Gateway v1.0 — Known Limitations

This is the single, authoritative consolidation of every documented
limitation of the Version 1.0 release. It draws from package READMEs'
"Deferred Work" sections, the Architecture Decision Records (ADRs), and
the Engineering Blueprint's milestone scope statements. Nothing here is
new — every item is already documented at least once elsewhere in this
repository; this document exists so an operator or integrator does not
have to read every package README and ADR to get the full picture.

None of these are defects. Each was a deliberate scope decision made at
the milestone where it was raised, and each is traceable to a specific
source below.

## 1. Deployment and scaling

### 1.1 Single-instance deployment only

Four pieces of state are held in-memory, per-process, with no
cross-instance synchronization:

| State | Package | Component |
|---|---|---|
| Rate-limit token buckets | `middleware` | `RateLimitMiddleware` |
| Response cache | `middleware` | `CacheMiddleware` |
| Circuit breaker state | `reliability` | `InMemoryCircuitBreaker` |
| Provider health tracking | `reliability` | `InMemoryHealthStateStore` (behind `HealthMonitor`) |

Running a single gateway process works correctly. Running more than one
instance behind a load balancer also works, but each instance maintains
an independent view of all four — one instance's circuit breaker can be
open while another's is closed for the same provider, and rate limits
are enforced per-instance rather than per-tenant globally. A shared
backend (e.g., Redis) for all four is required before a true
multi-replica deployment, and is not built in v1.0.

*Source: `apps/gateway-server/README.md` (Deferred Work), `middleware/README.md`
(Design note 6, Deferred Work), `orchestrator/README.md` (Deferred Work).
Architecture §23 describes the target multi-instance design (shared Redis/DB);
that design is not yet implemented.*

### 1.2 No database or KMS in this repository

`model-registry`, `credential-resolver`, and `config` each ship an
in-memory implementation of their storage seam (`InMemoryModelStore`,
`InMemoryCredentialStore`, in-memory `ConfigSource`s) behind an interface
designed to accept a real database or KMS-backed implementation
additively, without any interface change. No real database driver, Redis
client, or KMS integration exists anywhere in this repository as of
v1.0 — wiring one in is explicitly the responsibility of whoever operates
`apps/gateway-server` in a given environment, via that package's
override seams.

*Source: `model-registry/README.md`, `credential-resolver/README.md`
(Deferred Work), `config/README.md` (Extension points).*

### 1.3 No built-in TLS or reverse proxy

`apps/gateway-server` starts a plain `node:http` server; it does not
terminate TLS itself. A production deployment must place a
TLS-terminating reverse proxy, load balancer, or ingress in front of it.

*Source: `apps/gateway-server/src/http/server.ts` (uses `node:http`, not
`node:https`); architecture §20.1 assumes "TLS everywhere."*

## 2. Public API surface

### 2.1 Three architecture §10.2 routes are not implemented

`GET /v1/tasks`, `GET /v1/usage`, and `POST|DELETE /v1/credentials` are
specified in the Architecture Specification but not built in v1.0. This
was a deliberate EM-5 scope decision: `/v1/credentials` needs a
live-validation registration flow that doesn't exist at any lower layer
yet; `/v1/tasks` and `/v1/usage` are reporting endpoints over data
(task-type catalog, usage/cost accounting) that no package through EM-4
persists or aggregates.

*Source: `apps/gateway-server/README.md`, "Scope verification" section.*

### 2.2 No OpenAPI schema

Nothing in the Architecture Specification or Engineering Blueprint
mandates one for v1.0, and none is generated.

*Source: `apps/gateway-server/README.md` (Deferred Work).*

## 3. Authentication and authorization

### 3.1 RBAC is not enforced

`AuthMiddleware` authenticates an API key and resolves it to an
`AuthContext` carrying a `role`, but no policy-check step consumes that
role to permit or deny an action. Architecture §20.5 describes RBAC as
"`AuthMiddleware` + a policy-check step" — only the first half exists in
v1.0. Every authenticated caller can currently perform any action the
authenticated routes allow.

*Source: `middleware/README.md` (Scope Verification, Deferred Work).*

### 3.2 API keys are configured at startup, not managed at runtime

`apps/gateway-server`'s API keys are supplied via the
`GATEWAY_API_KEYS_JSON` environment variable (or a single insecure
development key when explicitly opted in) at process start. There is no
API or admin flow to add, rotate, or revoke a gateway API key without a
restart. This is a distinct, higher-layer concern from
`credential-resolver`'s BYOK provider-credential rotation, which *is*
implemented (see 4.2).

*Source: `apps/gateway-server/src/server-config.ts`; ADR-0009 (`middleware`
has no persistent `AuthKeyStore` — Option B in that ADR is the future
direction).*

## 4. Credentials and secrets

### 4.1 Only two secret sources are implemented

`EnvSecretSource` and `DbSecretSource` (backed by the in-memory
credential store, see 1.2) are implemented. Vault, AWS Secrets Manager,
Azure Key Vault, and GCP Secret Manager — all listed as first-class in
architecture §15.3 — are not. `SecretSource`'s interface already
accommodates them additively.

*Source: `credential-resolver/README.md` (status line, Deferred Work).*

### 4.2 No live-validation on BYOK registration

`registerCredential` accepts and stores a caller-supplied key without
calling `ProviderAdapter.healthCheck` against it first (architecture
§16.2's full flow). `credential-resolver` has no dependency on
`provider-sdk` and never will; a higher-layer caller (`orchestrator` is
the natural candidate) would need to add this. It has not been added as
of v1.0.

*Source: `credential-resolver/README.md` (Design notes, Deferred Work);
`orchestrator/README.md` (Deferred Work).*

## 5. Reliability and streaming

### 5.1 Cancellation stops waiting, not the underlying work

`TimeoutManager.withTimeout` races work against a deadline and rejects
if the deadline fires first, but this does not abort the in-flight
provider call itself — there is no `AbortSignal`-style cancellation
primitive on `ProviderAdapter`. Streaming cancellation is cooperative
(`StreamManager.cancel(requestId)` stops yielding further chunks to the
caller) rather than preemptive. This is tracked as an open, undecided
ADR — see 6.1 below.

*Source: `reliability/README.md`; `streaming/README.md` (Deferred Work);
`orchestrator/README.md` (Deferred Work); ADR-0004.*

### 5.2 Streaming failover only before the first chunk

Once any chunk has reached the caller, a mid-stream provider failure
surfaces as a terminal error rather than silently switching providers
mid-response (which would splice two providers' output together).

*Source: `orchestrator/README.md`, Design notes / Engineering Decision 5.*

### 5.3 No WebSocket transport

Streaming is Server-Sent Events only.

*Source: `streaming/README.md` (Deferred Work).*

## 6. Open architecture/implementation gaps (draft ADRs)

The following four items are recorded as **proposed / draft** ADRs — a
real, verified inconsistency between the frozen Architecture
Specification and the implementation as it exists today, raised because
a later milestone correctly implemented its own scope but, in doing so,
exposed a gap or contradiction one layer up. None has been decided by
the Architecture Review Board. They are listed here for completeness;
resolving them is architecture-review work, explicitly out of scope for
this release-governance pass.

| ADR | Gap |
|---|---|
| [0004](../adr/0004-provider-adapter-cancellation-draft.md) | `ProviderAdapter` has no cancellation primitive, despite architecture §18.4/§24 assuming one exists. |
| [0005](../adr/0005-backoff-strategy-config-mismatch.md) | Architecture §18.1 defines three `BackoffStrategy` values; `@ai-gateway/config`'s frozen (EM-1) type only has two. |
| [0006](../adr/0006-policy-engine-config-dependency-gap.md) | `policy-engine` has no dependency edge onto `@ai-gateway/config`, so scoring weights and routing rules are constructor options rather than config-sourced as architecture §13.3/§13.4 describe. |
| [0009](../adr/0009-middleware-config-gap.md) | `middleware` has no `@ai-gateway/config` field for API keys, rate-limit thresholds, or cache TTL, for the same structural reason as ADR-0006. |
| [0010](../adr/0010-gatewayconfig-reliability-section-unconsumed.md) | `GatewayConfig.reliability`, a fully-defined and validated config section, is read by no package anywhere in the codebase. |

See [`docs/adr/README.md`](../adr/README.md) for the complete ADR index,
including the four **accepted** ADRs that are not limitations but
settled design decisions.

## 7. Observability

### 7.1 No OpenTelemetry exporter is registered by default

`@ai-gateway/telemetry` deliberately never registers an OTel
`TracerProvider`/`MeterProvider` or exporter — every span and metric it
produces is a correct, inert no-op until a real SDK provider is
registered, and `@ai-gateway/gateway-runtime`'s `bootstrap()` (the
composition root every deployment target calls) does not register
one. Traces and metrics are produced but go nowhere unless an operator
adds OTel SDK exporter registration in their own deployment. Structured
logs, by contrast, are written to stdout by default and require no
additional wiring.

*Source: `telemetry/README.md` (Design notes); confirmed by inspection of
`packages/gateway-runtime/src/bootstrap.ts`, which calls `createTelemetry()`
with no exporter configuration. See
[`docs/release/DEPLOYMENT.md`](DEPLOYMENT.md) for how to wire one.*

## 8. Configuration

### 8.1 Placeholder model registry seed data

`model-registry`'s shipped `SEED_MODELS` uses placeholder model IDs, not
real provider-side model identifiers. A real deployment must supply its
own seed data via `bootstrap()`'s `overrides.modelRegistrySeed` — the
gateway does not invent real model IDs on an operator's behalf.

*Source: `apps/gateway-server/README.md`, Engineering decision 2;
`model-registry/README.md`.*

## 9. v1.1 / Strategy Layer release validation

### 9.1 A/B replay of EM-5 load-test traffic and gateway latency budget validation cannot be performed within this repository

The Engineering Blueprint's EM-8 entry (Section 7, "Strategy Layer
Integration") lists, among its required tests: "Feature-flagged A/B test
in staging shows no unexpected routing changes and no latency regression
beyond budget," describing this as reusing "EM-5's load-test traffic ...
verbatim since it's an engineering, not architectural, concern" (Section
7, EM-8 Risks). This is distinct from, and in addition to, the in-repo
regression suite that does exist today
(`packages/gateway-runtime/test/integration/end-to-end.test.ts`'s "EM-8
Pass-through Regression" describe block): that suite proves, with a
handful of synthetic in-process requests and a Mock Adapter, that
`enableStrategyLayer: true` and `enableStrategyLayer: false` produce
identical `provider`/`retries`/`failedOver`/`finishReason` results. It
does **not**, and structurally cannot, satisfy the Blueprint's actual
requirement, because that requirement needs two things nothing in this
repository provides:

1. **A captured corpus of EM-5's real load-test traffic.** No such
   corpus — recorded requests, a replay tool, or even a reference to
   where EM-5's load test was run — exists anywhere in this repository.
   `tools/orchestrator-integration-tests` and
   `tools/adapter-conformance-tests` are both hand-written functional
   suites, not load-test artifacts, and neither is designed to be
   "replayed" in the sense the Blueprint describes.
2. **A staging environment with a measurable, real gateway-overhead
   latency budget.** There is no P50/P99 (or any other) latency
   benchmark harness anywhere in this repository (confirmed by
   inspection: no file under any package matches
   `*benchmark*`/`*load-test*`, and no test asserts a latency bound in
   milliseconds against a real or simulated network path). Per
   [Limitation 1.2](#12-no-database-or-kms-in-this-repository)'s and
   `apps/gateway-server/README.md`'s own scope statements, this
   repository ships code, not a deployed staging environment — "staging"
   is an operator-provisioned target this codebase can be deployed to,
   not an artifact this codebase contains.

Per the EM-8 Independent Architecture & Engineering Review (Finding 2):
this is not a defect introduced by the Strategy Layer integration itself,
and it is explicitly **not** to be closed by fabricating a stand-in
staging environment or a synthetic "load test" inside this repository —
doing so would produce a check that passes without actually validating
what the Blueprint requires (real traffic shape, a real deployed gateway,
a real latency measurement), which is a worse outcome than leaving the
gap documented. The two prerequisites above — a captured EM-5 traffic
corpus and a staging deployment with a latency-measurement harness — are
release-infrastructure concerns, not package-engineering concerns; no
package's source code is missing anything to satisfy them.

**Recommendation for RuntimeOS Release Governance:** this validation step
belongs in this checklist's [§4 Testing](RELEASE_CHECKLIST.md#4-testing) or
[§5 Deployment](RELEASE_CHECKLIST.md#5-deployment) section, gating the
v1.1 tag specifically (not v1.0, which ships with `enableStrategyLayer`
defaulting to `false` and is unaffected), once Release Governance
provisions: (a) a real or representative staging deployment target, (b)
a captured or reconstructed EM-5 load-test traffic corpus and a replay
mechanism against that target, and (c) a latency-measurement harness with
an explicit budget (the Blueprint's EM-8 Risks entry proposes "an agreed
budget," not yet numerically defined anywhere in the Architecture
Specification or Engineering Blueprint — that number is itself a Release
Governance decision, not one this review is positioned to make). Until
those three exist, the v1.1 tag should not be cut on the strength of the
in-repo pass-through regression suite alone.

*Source: EM-8 Independent Architecture & Engineering Review, Finding 2;
`docs/architecture/engineering-blueprint.md`, Section 7 (EM-8 Tests
required, EM-8 Risks); `packages/gateway-runtime/test/integration/end-to-end.test.ts`.*

---

*This document is maintained as part of release governance and should be
updated whenever a package's Deferred Work section changes, a new ADR is
filed, or an existing one is accepted/resolved.*
