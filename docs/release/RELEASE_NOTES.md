# AI Gateway — Release Notes

## Version 1.2.0 — Platform Hardening & Production Readiness (EM-6 – EM-11)

### What's new since v1.0

Version 1.2 builds on the v1.0 baseline below with three major
capabilities and a full production-hardening pass:

- **Strategy Layer** (opt-in, `enableStrategyLayer`) — capability-aware
  and cost-aware model selection sits ahead of Policy Engine, with a
  proven pass-through regression: leaving the flag off produces
  byte-for-byte identical routing to v1.0.
- **Pipeline Orchestration** (`POST /v1/execute/pipeline`) — sequential
  multi-step execution, each step running through the exact same
  `ExecutionOrchestrator.execute()` a single-step request uses. No second
  execution engine, no ability to bypass Policy Engine or Strategy Layer
  from a pipeline step.
- **Budget Governance** — per-tenant daily/monthly spend budgets with
  configurable actions (alert, downgrade to a cheaper model class,
  exclude an over-cap provider, or block outright). Shadow mode remains
  the default in v1.2, exactly as it was at EM-10 — configuring
  `budgetPolicies` alone still enforces nothing. What's new in v1.2 is
  that **Enforcement Mode (`budgetEnforcementMode: "enforcing"`) has now
  been independently verified end-to-end against the real, wired system**
  and is documented as ready to opt into, not that it runs by default.
  Note also that as shipped, `apps/gateway-server` exposes no environment
  variable or config-file field for either `budgetPolicies` or
  `budgetEnforcementMode` — see "Enabling Budget Governance," below.

### Enabling Budget Governance

`budgetPolicies` and `budgetEnforcementMode` are fields on
`@ai-gateway/gateway-runtime`'s `GatewayRuntimeConfig`, consumed by
`bootstrap()`. As shipped, `apps/gateway-server`'s environment-variable
loader (`loadServerConfigFromEnv`) does not populate either field, so
running the published `apps/gateway-server` binary as-is can never
construct Budget Governance, regardless of mode. To use it today, a
deployment must call `bootstrap()` directly from its own composition
code (as `apps/gateway-server` itself does internally) and supply
`budgetPolicies`/`budgetEnforcementMode` explicitly — see
[`docs/release/DEPLOYMENT.md`](DEPLOYMENT.md#budget-governance-em-10-v12)
for a worked example. This is tracked as
[`KNOWN_LIMITATIONS.md` §9.3](KNOWN_LIMITATIONS.md#93-neither-deployment-application-has-a-configuration-surface-for-budget-governance).

### Before you enable Budget Governance enforcement

Two of the four threshold actions are fully verified working in
Enforcement Mode end-to-end: **`block`** and **`alert`**. A third,
**`downgrade_model`**, is verified working as a soft routing bias. The
fourth, **`switch_provider`**, does **not** currently affect real
provider routing — a known, disclosed gap (not a defect discovered after
the fact). If you're configuring budget policies for production, read
[`docs/release/KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md) §9.2 first —
it explains exactly what does and doesn't work, and what to configure
instead.

### Validation for this release

Full regression (every suite that passed at v1.0 and every milestone
since still passes, 1,239/1,239 individual tests), provider conformance
(both shipped adapters — Groq, NVIDIA NIM — re-validated against the
shared conformance suite), and a chaos-scenario sweep (provider failure,
retry exhaustion, circuit-breaker activation, failover, timeout handling,
pipeline step failure, streaming cancellation, and a new Budget
Governance infrastructure-failure scenario) all pass. See the EM-11
Engineering Completion Report for full detail, including this release's
performance-validation scope and its limits (an in-process framework-
overhead smoke-test only — see that report for why a genuine
production-scale load test isn't something this repository can produce
on its own, consistent with the same limitation already documented for
v1.1's EM-8 validation in §10 of `KNOWN_LIMITATIONS.md`).

### Breaking changes

None. Every frozen interface (`ExecuteRequest`, `ExecuteResponse`,
`ExecutionPlan`, `PolicyEngine`, `ExecutionOrchestrator`,
`StrategyDecision`) is unchanged since its freeze milestone.

---

## Version 1.0.0 — Baseline (EM-0 – EM-5)

## What is AI Gateway?

AI Gateway is a universal AI execution platform. Instead of calling a
specific provider's API and hand-rolling your own retry, failover, and
credential logic, you describe _what you want done_ — a task, some
content, and your constraints — and the gateway takes care of selecting
a suitable model, executing the request, retrying transient failures,
and failing over to another provider if one is unavailable. You never
name a provider or model in the request.

## What does Version 1.0 deliver?

Version 1.0 is a complete, deployable Minimum Viable Platform: a single
HTTP/SSE server (`apps/gateway-server`) that wires together every
platform capability built up to this point into one running process.

### Major capabilities

- **`POST /v1/execute`** — send a task, get back a normalized response,
  regardless of which provider actually served it.
- **`POST /v1/execute/stream`** — the same request shape, streamed back
  as Server-Sent Events for callers who want partial output as it's
  generated.
- **`GET /v1/health`** — a real readiness check that reflects actual
  provider health, not a hardcoded "ok."
- **Automatic retry and failover** across two real, production-capable
  providers (Groq and NVIDIA NIM), governed by a circuit breaker so a
  struggling provider stops receiving traffic until it recovers.
- **Bring-your-own-key (BYOK) or platform-managed credentials**, scoped
  per organization/workspace/project/user, encrypted at rest, with a
  full audit trail of every credential event.
- **Multi-tenant isolation** for credentials, rate limits, and cached
  responses — independently tested so one tenant cannot see or exhaust
  another's resources.
- **API-key authentication and per-tenant rate limiting** in front of
  every request.

### Deployment model

Version 1.0 ships as a single Node.js process
(`node apps/gateway-server/dist/index.js`), configured entirely through
environment variables, with no external database or cache dependency
required to run it. This is intentional: the v1.0 baseline targets a
**single-instance deployment** — see Current Limitations below and
[`docs/release/DEPLOYMENT.md`](DEPLOYMENT.md) for the full deployment
guide, including the target reference deployment shape (a single
Node.js process behind a TLS-terminating reverse proxy, at whatever
hostname your organization assigns it — e.g. `https://gateway.example.com`).

### Intended audience

Version 1.0 is intended for:

- Teams that want a single, provider-agnostic entry point for LLM calls
  across one or more providers, without building their own routing,
  retry, and failover logic.
- Self-hosted or small-scale production deployments running a single
  gateway instance (or a small, independently-scaled set of instances
  where cross-instance consistency of rate limits/cache/circuit-breaker
  state is not required).
- Engineering teams comfortable operating a Node.js service they build
  and deploy themselves — there is no managed/hosted offering in this
  release.

It is **not yet** intended for deployments that require multiple gateway
instances sharing rate-limit, cache, or circuit-breaker state, or that
require the usage/cost-reporting and BYOK self-service endpoints
described in the Architecture Specification (§10.2) — those are not
implemented in this release.

## Current limitations

Version 1.0 is a deliberately scoped MVP, not a partial or incomplete
implementation of a larger v1.0 plan. Every limitation below is a named,
documented scope boundary from the Engineering Blueprint, not an
oversight discovered after the fact:

- **Single-instance deployment.** Rate limiting, response caching,
  circuit-breaker state, and provider health tracking are all in-memory
  within one process. Running more than one instance behind a load
  balancer works, but each instance has its own independent view of
  this state.
- **Three of the six routes named in the Architecture Specification are
  not implemented**: `GET /v1/tasks`, `GET /v1/usage`, and
  `POST|DELETE /v1/credentials`. Only `/v1/execute`,
  `/v1/execute/stream`, and `/v1/health` are live in v1.0.
- **Authentication, not authorization.** API keys are validated and
  resolve to a role, but no policy-check step yet enforces what that
  role can and cannot do.
- **Two secret sources** (environment variables and a database-backed
  store) are supported. Vault, AWS Secrets Manager, Azure Key Vault, and
  GCP Secret Manager are not yet implemented.
- **No WebSocket transport** — streaming is Server-Sent Events only.

A complete, consolidated list — including the exact source and rationale
for each item — is maintained in
[`docs/release/KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md).

## What's next

Engineering work beyond this baseline is already planned in the
Engineering Blueprint's later milestones, covering areas such as smarter,
cost- and capability-aware routing, expanded credential-source support,
and multi-instance-ready shared state. That work has not started as of
this release and is out of scope for these release notes; nothing about
its scope or timing should be inferred from this document. For current
status, watch this repository's `CHANGELOG.md` and future release notes.

## Feedback and support

See [`SECURITY.md`](../../SECURITY.md) for vulnerability reporting and
[`docs/release/SUPPORT_POLICY.md`](SUPPORT_POLICY.md) for the support
policy covering this release.
