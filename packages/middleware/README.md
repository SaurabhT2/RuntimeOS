# @ai-gateway/middleware

**Status:** implemented (EM-4). Auth, rate limiting, and response caching —
architecture §17's `A`–`D` request-lifecycle nodes, §20.4/§20.5.

## Public API

- `AuthMiddleware` — `authenticate(apiKey)`: resolves an API key to an
  `AuthContext` (`{ tenant, role, keyId }`), or throws a non-retryable
  `GatewayError("CREDENTIAL_INVALID", ...)`.
- `RateLimitMiddleware` — `check(tenant)` / `checkOrThrow(tenant)`: a
  continuously-refilling token bucket keyed by tenant scope. Throws a
  retryable `GatewayError("RATE_LIMITED", ...)` once exhausted.
- `CacheMiddleware` — `get(req)` / `set(req, response)` / `clear()`: a
  TTL'd response cache keyed by tenant scope (by default) + request
  content. Never caches a streaming request.
- `MiddlewarePipeline` — `run(req, apiKey, downstream)`: composes the three
  above in architecture §17's order (auth → rate limit → cache-check →
  `downstream` → cache-store), where `downstream` is a generic
  `(req, auth) => Promise<ExecuteResponse>` function — see Engineering
  Decision 1.

## Scope Verification

Per the Engineering Blueprint's EM-4 section, this package implements
**only**: `auth.ts`, `rate-limit.ts`, `cache.ts`, `pipeline.ts`
(architecture §20.5's stated feature list). It does **not** implement: the
RBAC _policy-check_ step (§20.5's own sentence names this as a separate
concern from `AuthMiddleware` — "authorization logic can evolve without
touching orchestration logic" implies a step that consumes
`AuthContext.role`, which does not exist as a Blueprint-named EM-4
deliverable), any HTTP framework integration/header parsing (no HTTP
framework dependency exists anywhere in this codebase yet — that is
`apps/gateway-server`'s job, EM-5), or a persistent auth-key store (see
ADR-0009, Option B).

## Design notes / Engineering Decisions

1. **No dependency edge onto `orchestrator`, in either direction.**
   architecture §4.1's `DEPENDENCY_TABLE` gives `middleware` exactly
   `config`, `telemetry`, `core-contracts`, and gives `orchestrator` no
   edge onto `middleware` either. `MiddlewarePipeline.run`'s `downstream`
   parameter is therefore a generic, structurally-typed function rather
   than an `ExecutionOrchestrator` import — wiring a real
   `orchestrator.execute` (bound) into a real `MiddlewarePipeline` is
   `apps/gateway-server/src/bootstrap.ts`'s job (EM-5), the same
   composition-root pattern `orchestrator`'s own `ProviderAdapterRegistry`
   uses one layer down (ADR-0008).

2. **API keys, rate-limit thresholds, and cache TTL are constructor
   options, not `@ai-gateway/config` fields — ADR-0009.** `GatewayConfig`
   (frozen EM-1) has no section for any of the three. Each middleware
   class takes documented defaults as constructor options instead
   (mirroring `policy-engine`'s analogous ADR-0006 workaround) — a future
   composition root can populate the same options from an extended config
   schema without this package's public API changing.

3. **`CREDENTIAL_INVALID` for gateway-auth failure, not a new error code.**
   `core-contracts`' `GatewayErrorCode` union has no dedicated
   `UNAUTHORIZED`/`FORBIDDEN` code (adding one would be a frozen
   `core-contracts` schema change, out of scope — see ADR-0001's
   versioning-discipline note on that package). `CREDENTIAL_INVALID` is
   the closest existing fit for "the caller's credential to _this
   gateway_ did not check out," distinguished by context from
   `credential-resolver`'s own `CREDENTIAL_NOT_FOUND`/`CREDENTIAL_INVALID`
   (a _provider_ credential failing to resolve, a different layer
   entirely).

4. **Rate limiting is keyed by tenant scope (`organizationId:workspaceId`),
   not by API key.** architecture §20.4's own framing ("one workspace's
   burst cannot starve another's quota") is about workspaces, not
   individual keys — two API keys issued to the same workspace
   intentionally share one bucket.

5. **The cache key excludes `requestId`/`correlationId`/`preferences`.**
   Correlation fields are caller bookkeeping, not part of what makes two
   requests "the same" for caching purposes; `preferences.prioritize`
   (architecture §10.3's soft weighting hint) does not change what a
   _correct_ answer looks like, only how a provider is selected, so two
   requests differing only in `preferences` still share a cache entry.

6. **In-memory-only rate limiter and cache.** Correct for a single gateway
   instance; a multi-instance deployment needs a shared backend (Redis
   token bucket, etc.). Not built here — nothing in the Blueprint's EM-4
   feature list names a distributed backend, and building one without a
   named requirement is the scope creep this milestone's brief warns
   against. See Deferred Work.

## Testing Strategy

- `auth.test.ts`: valid/unknown/missing-key resolution, key masking
  (`keyId` never contains the raw key), short-key edge case.
- `rate-limit.test.ts`: window exhaustion, per-tenant-scope isolation,
  continuous refill over time, workspace-vs-organization-only scoping,
  `checkOrThrow`'s `RATE_LIMITED` error shape.
- `cache.test.ts`: hit/miss, content-sensitivity, tenant isolation (default
  on, opt-out via `includeTenantInKey: false`), TTL expiry, streaming
  requests never cached, `clear()`, correlation-field-insensitivity.
- `pipeline.test.ts`: the full `run()` composition — downstream call/skip
  in every branch (auth failure, rate-limit failure, cache hit, cache
  miss-then-store), `AuthContext` propagation to `downstream`, streaming
  requests bypassing the cache every time.
- **Coverage** (`vitest run --coverage`, this package): statements 100%,
  branches 98.2%, functions 100%, lines 100%.

## Deferred Work

- A distributed rate-limit/cache backend (Redis or equivalent) for
  multi-instance deployments.
- The RBAC policy-check step consuming `AuthContext.role` (architecture
  §20.5) — not a named EM-4 deliverable; `AuthContext.role` is produced
  and available today for whichever future milestone adds it.
- `AuthKeyStore` (ADR-0009, Option B) — a pluggable, potentially
  database-backed replacement for the constructor-`Map` key list.

## Dependencies

- `@ai-gateway/core-contracts`
- `@ai-gateway/config`
- `@ai-gateway/telemetry`

## Architecture reference

§17 (request lifecycle, nodes A–D), §20.4 (rate limiting / caching),
§20.5 (RBAC / `AuthMiddleware`)
