# ADR-0009: `middleware` has no `@ai-gateway/config` field for API keys, rate-limit thresholds, or cache TTL

**Status:** Proposed (draft — raised during EM-4 implementation, not yet decided)
**Date:** 2026-07-08
**Format:** Context / Decision / Consequences / Alternatives

> **Note on this draft:** Same category of finding as ADR-0006 (`policy-engine`'s
> analogous gap against `config`'s `routing` section), raised here for
> `middleware` against `config`'s complete absence of an auth/rate-limit/cache
> section. Not a `middleware` defect — this milestone's `middleware`
> implements architecture §17's A–D lifecycle nodes and §20.4/§20.5 exactly,
> using constructor-supplied options in place of config-sourced values,
> because no such config section exists to read them from. Per this
> milestone's "document, don't invent a solution" instruction,
> `@ai-gateway/config`'s schema is not modified by this document.

## Context

Architecture §20.5 describes `AuthMiddleware` validating caller identity
against configured API keys/roles. §20.4 describes rate-limit counters and
cache TTLs as tenant-scoped, implicitly configurable values ("one
workspace's burst cannot starve another's quota"; "the response cache key
includes tenant scope by default (configurable to relax...)").

`GatewayConfig` (`@ai-gateway/config`, frozen at EM-1,
`packages/config/src/schema.ts`) has exactly three top-level sections:
`credentialPriority`, `routing`, `reliability`. There is no `auth`,
`rateLimit`, or `cache` section, and no field anywhere in the schema for
API keys, per-tenant request quotas, or cache TTLs. `middleware`'s frozen
dependency edge (`.dependency-cruiser.cjs`'s `DEPENDENCY_TABLE`) is
`config`, `telemetry`, `core-contracts` — the edge onto `config` _does_
exist (unlike `policy-engine`'s in ADR-0006), but there is nothing in
`config`'s current schema for `middleware` to read even so.

## Decision

**Not yet decided.** Filed in draft form. `middleware` ships in EM-4 with
API keys (`AuthMiddlewareOptions.keys`), rate-limit thresholds
(`RateLimitMiddlewareOptions.requestsPerWindow`/`windowMs`), and cache
settings (`CacheMiddlewareOptions.ttlMs`/`includeTenantInKey`) as
constructor options with documented defaults — buildable and fully
testable today, and additive to whichever resolution the Board picks (a
future composition root would populate these same constructor options from
an extended `GatewayConfig` rather than a caller supplying literals).

### Option A — Extend `GatewayConfig`'s schema with `auth`/`rateLimit`/`cache` sections

- Directly closes the gap.
- Requires modifying a frozen EM-1 artifact (`@ai-gateway/config`'s
  schema) — the same governance question ADR-0005 and ADR-0006 already
  raised for narrower cases.
- API keys specifically are secret material; if this option is taken,
  `config`'s existing "not for secrets" convention (`credentialPriority`
  is an ordering list, never a key value — real keys live in
  `credential-resolver`'s encrypted store) suggests keys should **not**
  land in `GatewayConfig` even then. A `config`-sourced _reference_ to a
  key store (mirroring how `credential-resolver` already separates
  scope-resolution config from encrypted-secret storage) is a more
  consistent shape than adding a plaintext-adjacent field to
  `GatewayConfig` itself.

### Option B — A dedicated `AuthKeyStore` interface, mirroring `credential-resolver`'s `CredentialStore`

- `AuthMiddleware` would take an `AuthKeyStore` (async `resolve(apiKey):
AuthContext | undefined`) instead of a plain in-memory `Map`, letting a
  real deployment back it with a database the same way
  `credential-resolver`'s `CredentialStore` already does for provider
  credentials.
- Strictly more capable than the current constructor-`Map` shape, and a
  smaller change than extending `GatewayConfig` — `middleware`'s existing
  dependency edge onto `config` is not even needed for this option.
- Deferred rather than built now: nothing in the Engineering Blueprint's
  EM-4 feature list ("Implement: `auth.ts`, `rate-limit.ts`, `cache.ts`,
  `pipeline.ts`") names a persistent store, and building one without a
  named requirement is exactly the scope creep this milestone's brief
  warns against ("If future functionality is required, create extension
  points only"). `AuthMiddlewareOptions.keys` is deliberately a plain
  array today so that swapping in an `AuthKeyStore`-backed implementation
  later is a constructor-option change, not an `AuthMiddleware` rewrite.

## Consequences

- `RateLimitMiddleware` and `CacheMiddleware` are correct for a
  single-gateway-instance deployment only (in-memory state) — see this
  package's README, Deferred Work, for the distributed-backend note this
  ADR does not resolve.
- Whichever option the Board picks, `MiddlewarePipeline`'s own public
  shape (`run(req, apiKey, downstream)`) does not need to change — only
  what constructs the three middleware instances passed to its
  constructor changes.

## Alternatives considered

Doing nothing (hardcoding key/threshold values into `middleware`'s source
rather than exposing them as constructor options) was rejected outright,
not just deferred: it would make every deployment share one fixed rate
limit and one fixed, source-controlled API key list, which contradicts
architecture §20.4's explicit "configurable" framing even before the
`config`-vs-constructor-option question is decided.
