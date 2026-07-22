# Security Policy

## Supported versions

| Version                          | Supported                                |
| -------------------------------- | ---------------------------------------- |
| 1.0.x                            | :white_check_mark: Yes — current release |
| < 1.0 (pre-release / unreleased) | :x: No — not a released version          |

AI Gateway's packages version independently (see
[`docs/release/VERSIONING.md`](docs/release/VERSIONING.md)). This table
covers the platform release (the `apps/gateway-server` composition and
the packages it wires together at the `v1.0.0` tag), not each package's
individual semver number.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for a suspected security
vulnerability.

Report it privately by opening a GitHub Security Advisory on this
repository (**Security → Advisories → Report a vulnerability**), or, if
that is not available to you, by contacting the repository maintainer
directly through the contact information on their GitHub profile.

Please include:

- The package(s) or endpoint(s) affected.
- Steps to reproduce, or a proof-of-concept if you have one.
- The potential impact as you understand it (e.g., cross-tenant data
  exposure, credential leakage, authentication bypass).

### Disclosure expectations

- We will acknowledge a new report as soon as practical.
- We will not require or request that you delay disclosure indefinitely,
  but we do ask for a reasonable window to investigate and, if
  confirmed, ship a fix before any public disclosure.
- Once a fix is available, we will credit the reporter in the fix's
  changelog entry, unless you ask to remain anonymous.

This is a single-maintainer-governed project at this stage of its
release history; there is no dedicated security team and no bug-bounty
program. Response times are best-effort, not contractually guaranteed.

## Security boundaries

This section describes what Version 1.0 actually implements, to set
accurate expectations — see
[`docs/release/KNOWN_LIMITATIONS.md`](docs/release/KNOWN_LIMITATIONS.md)
for full detail and sourcing on each item.

### What is implemented

- **Multi-tenant isolation**, enforced at two independent layers
  (data-layer lookup and resolver-layer comparison) for credentials,
  and by tenant-scoped keys for rate limiting and response caching. This
  isolation is covered by a dedicated, hard-merge-gated test suite
  (`credential-resolver`'s `test/isolation.test.ts`), including
  regression coverage for a previously-found and fixed cross-tenant
  leak involving blank/whitespace tenant scope fields.
- **Encryption at rest for stored credentials** (AES-256-GCM, via
  `AesGcmEncryptor`) and **error redaction**: a caller-facing error never
  reveals which credential scope was tried, a row ID, or an environment
  variable name — that detail goes only to the append-only audit log.
- **Audit logging** of every credential lifecycle event (register,
  resolve, rotate, revoke) with actor, tenant scope, provider, timestamp,
  and outcome — never the secret value itself.
- **API-key authentication** in front of every authenticated route
  (`Authorization: Bearer <key>` or `x-api-key: <key>`), with key
  masking (a resolved `keyId` never contains the raw key).
- **Per-tenant rate limiting**, so one workspace's traffic burst cannot
  starve another's quota on a shared platform-managed credential.

### What is designed but not yet enforced (v1.0 limitation)

- **RBAC authorization.** A resolved `AuthContext` carries a `role`, but
  no policy-check step yet consumes it to permit or deny an action.
  Every successfully authenticated caller can currently invoke any
  action the implemented routes allow. Do not rely on role
  differentiation for access control in this release.
- **Vault/cloud secret-manager-backed credential storage.** Only
  environment-variable and database-backed (in-memory in this
  repository — see `docs/release/DEPLOYMENT.md`) secret sources exist.
- **Live-validation of a newly registered BYOK key** against the
  provider before accepting it.
- **TLS termination.** The gateway process itself speaks plain HTTP; TLS
  must be terminated by a reverse proxy, load balancer, or ingress in
  front of it.

### Authentication assumptions

- Every request to an authenticated route is assumed to arrive over a
  transport the operator has already secured (TLS terminated upstream)
  and through a network boundary the operator controls — the gateway
  does not itself provide network-level protections (e.g., IP
  allowlisting, mTLS).
- `GET /v1/health` is intentionally unauthenticated, since a health
  probe has no caller/tenant of its own; it does not expose tenant data,
  only aggregate provider health.
- The `GATEWAY_ALLOW_DEV_DEFAULTS=true` environment variable enables a
  single, well-known, explicitly insecure API key
  (`dev-local-only-insecure-key`) for local development only. Setting
  this in any reachable or production deployment is a misconfiguration,
  not a supported mode — the process logs a loud warning when it starts
  this way.

## Dependency update policy

- Third-party dependencies are managed through `pnpm` with a committed
  lockfile (`pnpm-lock.yaml`); CI installs with `--frozen-lockfile`, so
  no dependency version changes silently between a developer's machine
  and CI.
- `core-contracts` and `policy-engine`/`orchestrator` (packages every
  other package transitively depends on) do not take on a new
  third-party dependency without explicit justification in the adding
  PR, since their dependency footprint is every consumer's footprint.
- Dependency updates, including security patches, follow the same PR and
  CI process as any other change — there is currently no automated
  dependency-update bot configured in this repository. Operators running
  a fork or deployment of this gateway should track upstream advisories
  for this repository's dependencies (Node.js, Zod, Turborepo, and the
  provider/OTel SDKs) independently until such automation exists.

## Scope of this policy

This policy covers the AI Gateway platform code in this repository. It
does not cover the security posture of third-party AI providers (Groq,
NVIDIA NIM) themselves, or of infrastructure an operator chooses to run
this gateway on (databases, reverse proxies, container orchestrators).
