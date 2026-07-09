# AI Gateway — Version 1.0 Release Notes

## What is AI Gateway?

AI Gateway is a universal AI execution platform. Instead of calling a
specific provider's API and hand-rolling your own retry, failover, and
credential logic, you describe *what you want done* — a task, some
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
guide, including the target reference deployment at
`runtime.saurabhtiwariai.com`.

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
