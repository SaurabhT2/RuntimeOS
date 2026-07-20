# AI Gateway — Known Limitations (through v1.2)

This is the single, authoritative consolidation of every documented
limitation of the platform, updated through the v1.2 (EM-11) release. It
draws from package READMEs' "Deferred Work" sections, the Architecture
Decision Records (ADRs), and the Engineering Blueprint's milestone scope
statements. Nothing here is new — every item is already documented at
least once elsewhere in this repository; this document exists so an
operator or integrator does not have to read every package README and
ADR to get the full picture. Sections 1–8 date from the v1.0 baseline and
remain accurate unchanged; section 9 was added for v1.2's Budget
Governance work.

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

The following ten items are recorded as **proposed / draft** ADRs — a
real, verified inconsistency between the frozen Architecture
Specification and the implementation as it exists today, raised because
a later milestone correctly implemented its own scope but, in doing so,
exposed a gap or contradiction one layer up. None has been decided by
the Architecture Review Board. They are listed here for completeness
(this table previously listed only six of the ten — corrected during the
v1.2 documentation pass); resolving them is architecture-review work,
explicitly out of scope for this release-governance pass.

| ADR | Gap |
|---|---|
| [0004](../adr/0004-provider-adapter-cancellation-draft.md) | `ProviderAdapter` has no cancellation primitive, despite architecture §18.4/§24 assuming one exists. |
| [0005](../adr/0005-backoff-strategy-config-mismatch.md) | Architecture §18.1 defines three `BackoffStrategy` values; `@ai-gateway/config`'s frozen (EM-1) type only has two. |
| [0006](../adr/0006-policy-engine-config-dependency-gap.md) | `policy-engine` has no dependency edge onto `@ai-gateway/config`, so scoring weights and routing rules are constructor options rather than config-sourced as architecture §13.3/§13.4 describe. |
| [0007](../adr/0007-stream-manager-signature-gap.md) | Architecture §11's literal `StreamManager` signature can't compile within this codebase's own frozen dependency boundaries, and `cancel(requestId)` has no addressable implementation path. Partially resolved by ADR-0008. |
| [0009](../adr/0009-middleware-config-gap.md) | `middleware` has no `@ai-gateway/config` field for API keys, rate-limit thresholds, or cache TTL, for the same structural reason as ADR-0006. |
| [0010](../adr/0010-gatewayconfig-reliability-section-unconsumed.md) | `GatewayConfig.reliability`, a fully-defined and validated config section, is read by no package anywhere in the codebase. |
| [0014](../adr/0014-prompt-optimizer-execution-profile-registry-dependency-gap.md) | Architecture §34.2's frozen `PromptOptimizer.optimize` signature requires a dependency edge (`prompt-optimizer` → `execution-profile-registry`) that Engineering Blueprint §4.1's table omits. The implementation is correct; only the table is wrong. |
| [0019](../adr/0019-milestone-8-definition-conflict.md) | Architecture §38.2's "Milestone 8" (pass-through skeleton only) and the Engineering Blueprint's "EM-8" (full Wave 6–7 integration) describe incompatible scopes under the same number. |
| [0020](../adr/0020-runtime-profile-read-sites-gap.md) | Two of architecture §37.4's four Runtime Profile read sites (Policy Engine lifecycle-state filtering; Circuit Breaker aggressiveness) have no implemented data path, and `RuntimeProfile`'s own schema has no field cleanly matching §37.4's `streaming`/`timeoutMs` claim. |
| [0025](../adr/0025-budget-enforcer-provider-id-and-exclusion-gap.md) | `switch_provider` budget threshold actions have no observable effect on real provider routing in production — see §9.2 below. **Elevated to a release-blocking-for-that-feature disclosure as of v1.2**, now that Enforcement Mode has been verified end-to-end and documented as ready for a deployment to opt into (shadow remains the default; see §9.2/§9.3); see §9.2. |

See [`docs/adr/README.md`](../adr/README.md) for the complete ADR index,
including the accepted ADRs that are not limitations but settled design
decisions.

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

## 9. Budget Governance (EM-10 / v1.2)

### 9.1 `InMemoryBudgetLedger` is non-durable

Cumulative daily/monthly spend is tracked in a per-process, in-memory
store with no persistence across a restart and no cross-instance
synchronization — the same single-instance limitation already described
in §1.1, extended to a fifth piece of state. A process restart silently
resets every tenant's cumulative spend to zero, and (per §1.1) a
multi-instance deployment gives each instance an independent, incomplete
view of spend, which can under-count total cumulative spend against a
tenant's real budget. `BudgetLedger`'s interface accommodates a durable,
shared implementation additively; none is built as of v1.2.

*Source: `packages/budget-governance/README.md` ("Known gap: no durable
`BudgetLedger` implementation"); ADR-0022.*

### 9.2 `switch_provider` threshold actions have no effect on real routing — read this before enabling Enforcement Mode

**Correction (this section previously stated that v1.2 promotes Budget
Governance to Enforcement Mode "by default." That is inaccurate and has
been corrected here, in `CHANGELOG.md`, and in `RELEASE_NOTES.md`.**
Source (`packages/gateway-runtime/src/bootstrap.ts`) confirms
`budgetEnforcementMode` still defaults to `"shadow"` even when
`budgetPolicies` is configured — identical to EM-10's behavior. Nothing
in v1.2 flips that default, and `apps/gateway-server` (the only
deployable app in this repository) has no environment variable or
config-file field for either setting at all; see §9.3, below.**

**This is nonetheless the most operationally important limitation in
this document as of v1.2**, because v1.2 is the first release where
Enforcement Mode has been independently verified end-to-end against the
real, wired system (see
[`docs/history/IMPLEMENTATION_PROGRESS.md`](../history/IMPLEMENTATION_PROGRESS.md)'s
EM-11 entry) and documented as something a deployment can deliberately
opt into — the release where a deployment that *does* explicitly set
`budgetEnforcementMode: "enforcing"` (via a custom `bootstrap()` call;
see §9.3) needs to understand this gap before doing so, since
misunderstanding it there could translate into unmitigated real-provider
spend, not just an inert shadow-mode log line.

A `BudgetThresholdAction` configured with `action: "switch_provider"` is
evaluated, and a corresponding `forcedProviderExclusion` decision is
computed correctly by `DefaultBudgetEnforcer` — but that decision **never
changes which provider a request is actually routed to**, for two
independent, compounding reasons, both empirically confirmed against the
real, wired system (not just read from source) as part of EM-11
hardening:

1. **The triggering check itself never runs in production.** The only
   production call site of `BudgetEnforcer.evaluate()`
   (`packages/strategy-layer/src/stages/budget-enforcement-stage.ts`)
   always evaluates *before* Policy Engine has selected a provider, and
   passes a `NO_PROVIDER_SELECTED_YET` sentinel as the `providerId`
   argument. `perProviderSpendCapUsd` checks are explicitly skipped
   whenever `providerId` is that sentinel — so a per-provider cap can
   never actually be breached in the real request flow, regardless of
   real spend.
2. **Even if it did run, there is nowhere for the result to go.** The
   frozen `StrategyDecision` interface (architecture §30, frozen since
   EM-8) has no field capable of carrying a provider-exclusion set
   forward to Policy Engine's routing rules — `budgetProviderExclusionRule`
   is implemented and unit-tested in isolation in `budget-governance`,
   but is not, and structurally cannot be, registered into
   `policy-engine`'s routing rules without a change to a frozen
   interface, which is out of scope for a hardening milestone.

**Observable production behavior:** a tenant with a `perProviderSpendCapUsd`
+ `switch_provider` threshold configured will see that provider continue
to receive traffic and continue accruing cost past the configured
per-provider cap, exactly as if no such threshold had been configured at
all — silently, with no error and no indication in the response that the
configured protection did not apply. (Telemetry for the *tenant-wide*
`dailyBudgetUsd`/`monthlyBudgetUsd` thresholds — `alert`, `downgrade_model`,
`block` — is unaffected by this gap and functions correctly; this is
specific to `perProviderSpendCapUsd` + `switch_provider`.)

**What does work correctly in Enforcement Mode, verified end-to-end
against the real system as part of EM-11:** `block` (a tenant-wide cap
breach genuinely rejects the request with `BUDGET_EXCEEDED`),
`downgrade_model` (genuinely biases Policy Engine's model scoring toward
a cheaper class, verified via a full budget-governance → strategy-layer →
policy-engine code-path trace, each link independently unit-tested), and
`alert` (genuinely never blocks, verified end-to-end).

**Recommendation for operators:** do not configure `perProviderSpendCapUsd`
or a `switch_provider` threshold action expecting it to reroute traffic
away from an over-cap provider in v1.2. Use `block` (tenant-wide) if hard
protection is required, or `downgrade_model` if a softer, cost-reducing
response is preferred. This gap is tracked as
[ADR-0025](../adr/0025-budget-enforcer-provider-id-and-exclusion-gap.md)
(proposed, undecided) and requires an Architecture Review Board decision
to close, since closing it needs either a frozen-interface change or an
architecturally-approved alternative carrier — neither of which a
hardening milestone is authorized to introduce unilaterally.

*Source: ADR-0025; `packages/budget-governance/README.md` ("Known gap:
`forcedProviderExclusion` is computed but not enforced"); EM-11 Engineering
Completion Report, Budget Governance Validation section (empirical
end-to-end reconfirmation via `packages/gateway-runtime/test/bootstrap.test.ts`).*

### 9.3 Neither deployment application has a configuration surface for Budget Governance

`budgetPolicies` and `budgetEnforcementMode` are fields on
`@ai-gateway/gateway-runtime`'s `GatewayRuntimeConfig` (the object
`bootstrap()` accepts), not on `@ai-gateway/config`'s `GatewayConfig`.
Neither of this repository's two deployment applications' own
environment-variable loaders populates either field:

- `apps/gateway-server`'s (`apps/gateway-server/src/server-config.ts`'s
  `loadServerConfigFromEnv`) populates every other `GatewayRuntimeConfig`
  field it needs from `process.env` — including `enableStrategyLayer`,
  via the literal `ENABLE_STRATEGY_LAYER` variable — but has **no
  corresponding variable, and no `GATEWAY_CONFIG_PATH`-file field, for
  `budgetPolicies` or `budgetEnforcementMode`**. Confirmed by inspection:
  neither `apps/gateway-server/src/server-config.ts` nor
  `apps/gateway-server/src/index.ts` references either field name
  anywhere.
- `apps/vercel-adapter`'s (`apps/vercel-adapter/src/vercel-config.ts`'s
  `loadVercelConfigFromEnv`) has the identical gap, confirmed the same
  way. Unlike `enableStrategyLayer` — which `apps/vercel-adapter` *can*
  reach via a `GATEWAY_CONFIG_PATH` JSON file, just without a dedicated
  env var (see
  [`docs/release/RUNTIME_CONFIGURATION_MATRIX.md`](RUNTIME_CONFIGURATION_MATRIX.md))
  — `budgetPolicies`/`budgetEnforcementMode` have no config-file route
  either, since neither field exists in `@ai-gateway/config`'s
  `GatewayConfig` Zod schema (`packages/config/src/schema.ts`) at all.

**Practical effect:** running either published application binary with
any combination of environment variables can never construct Budget
Governance — `budgetLedger`/`budgetEnforcer` stay `undefined` in
`bootstrap()` regardless of mode, because the
`runtimeConfig.budgetPolicies` either app supplies is always empty. This
is true independent of §9.1/§9.2 above: even a deployment that has read
and understood the `switch_provider` gap and wants to configure `block`-
or `downgrade_model`-only policies has no supported way to do so through
either shipped app.

**What does work:** the `budget-governance` package itself, and
`@ai-gateway/gateway-runtime`'s `bootstrap()`, both fully support
`budgetPolicies`/`budgetEnforcementMode` when a caller constructs and
passes them programmatically — this is exactly how
`packages/gateway-runtime/test/bootstrap.test.ts`'s Budget Governance
suite (and EM-11's end-to-end verification) exercises the feature. A
deployment that wants Budget Governance in v1.2 must write its own thin
composition-root file (mirroring `apps/gateway-server/src/index.ts` or
`apps/vercel-adapter/src/runtime.ts`) that calls `bootstrap()` directly
with `budgetPolicies` and `budgetEnforcementMode` supplied in code or
loaded from its own configuration mechanism — see
[`docs/release/DEPLOYMENT.md`](DEPLOYMENT.md#budget-governance-em-10-v12)
for a worked sketch.

**Tracked, not left implicit:** closing this gap for both apps is a
scoped engineering backlog item, not a RuntimeOS implementation defect —
see
[`docs/backlog/expose-complete-gatewayruntimeconfig-surface.md`](../backlog/expose-complete-gatewayruntimeconfig-surface.md),
which also covers the smaller, related `maxPipelineSteps` gap (neither
app exposes an override for the pipeline step cap either).

*Source: `apps/gateway-server/src/server-config.ts` and
`apps/vercel-adapter/src/vercel-config.ts` (no `budget`-related
identifier anywhere in either file, confirmed by inspection);
`packages/gateway-runtime/src/bootstrap.ts` (`GatewayRuntimeConfig`'s
`budgetPolicies`/`budgetEnforcementMode` fields and their consumption);
`apps/gateway-server/src/index.ts` and `apps/vercel-adapter/src/runtime.ts`
(both pass their respective loader's result to `bootstrap()`
unmodified).*

## 10. v1.1 / Strategy Layer release validation

### 10.1 A/B replay of EM-5 load-test traffic and gateway latency budget validation cannot be performed within this repository

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
