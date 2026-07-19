# @ai-gateway/runtime-profiles

**Status:** implemented (EM-6). A deployment/tenant-wide behavior overlay —
provider preference, reliability aggressiveness, cost ceilings, telemetry
verbosity, caching aggressiveness (architecture §37; Blueprint §8.16). Not
yet wired into any of the four read sites architecture §37.4 names — that
wiring is `strategy-layer`'s job (Wave 8, EM-8) plus targeted follow-up
changes to `policy-engine`/`reliability` at that time.

## Distinction from Execution Profiles (architecture §37.1)

An **Execution Profile** (`execution-profile-registry`, §31) describes how
a given _task type_ should run. A **Runtime Profile** is orthogonal: it
describes how the _entire gateway deployment/tenant_ should behave,
overlaying adjustments on top of whatever Execution Profile is resolved.
The same `task: "summarization"` request behaves differently under a
`free_tier` Runtime Profile than under an `enterprise` one, without the
application changing anything.

## Where Runtime Profiles apply (architecture §37.4)

A Runtime Profile is selected per tenant, or per deployment for self-hosted
setups. It is read by four sites, none of which this milestone wires up:

- Execution Profile Registry — adjusts `streaming`/`caching`/`timeoutMs` defaults.
- Cost Optimizer — sets `preferFreeTierProviders` and cost ceilings.
- Policy Engine's Candidate Query — filters by `allowedLifecycleStates`.
- Retry Engine / Circuit Breaker — adjusts retry/backoff and breaker thresholds.

"No component outside `runtime-profiles` and [those] four read sites needs
to know Runtime Profiles exist" (architecture §37.4) — this package is
therefore deliberately self-contained today.

## Public API

- `RuntimeProfileRegistry` — `getActiveRuntimeProfile(tenant)`,
  `setTenantRuntimeProfile(tenant, profileId)` (the admin-API-writable
  override §37.4 describes), `upsertProfile(profile)`.
  `DefaultRuntimeProfileRegistry` resolves, in order: an explicit per-tenant
  assignment, a configured deployment-wide default
  (`deploymentDefaultProfileId`, meant to be sourced from
  `GatewayConfig.runtimeProfileId` — see below), then `"production"`.
- `createSeededRuntimeProfileRegistry(options?)` — convenience factory
  pre-loaded with `SEED_RUNTIME_PROFILES`.
- `RuntimeProfile` / `RuntimeProfileId` / `runtimeProfileSchema` —
  architecture §37.2's schema, verbatim.
- `ModelLifecycleState` — a local copy of architecture §35.1's type. This
  package cannot depend on `model-registry` (Blueprint §4.1 lists only
  `config`), and `model-registry`'s `ModelDescriptor` doesn't have a
  `lifecycle` field yet — that's a different milestone's scope (see
  `runtime-profile.ts`'s doc comment for the full reasoning). The
  `allowedLifecycleStates` field exists in the schema today exactly as
  §37.2 specifies; it simply has no consumer until the Policy Engine change
  described above happens.
- `TenantRef` / `tenantKey` — a minimal local tenant identifier (organization
  - optional workspace), used instead of importing `core-contracts`'
    `ExecuteRequest.tenant` shape for the same frozen-dependency-edge reason.
- `RuntimeProfileResolutionError` — thrown when a `RuntimeProfileId` (from
  a tenant assignment, the deployment default, or an explicit lookup) has
  no registered profile (architecture §19.3's never-silent-failure principle).

## `GatewayConfig.runtimeProfileId`

Per architecture §37.4, `GatewayConfig` (Section 10.6, `@ai-gateway/config`)
gains an optional `runtimeProfileId: string` field this milestone (ADR-0013).
It is typed as a plain `string` in `config` (not this package's
`RuntimeProfileId` union) so that `config` — a dependency of this package —
never depends back on it. A composition root reads
`GatewayConfig.runtimeProfileId` and passes it to this registry as
`deploymentDefaultProfileId`; this package does not read `config` directly
at runtime today (the same "declared dependency, no runtime import
required yet" pattern `model-registry` already uses for its own `config`
dependency).

## Usage example

```ts
import { createSeededRuntimeProfileRegistry } from "@ai-gateway/runtime-profiles";

const registry = createSeededRuntimeProfileRegistry();

const defaultProfile = await registry.getActiveRuntimeProfile({ organizationId: "acme" });
// production preset — no override, no deployment default configured

await registry.setTenantRuntimeProfile({ organizationId: "acme" }, "enterprise");
const profile = await registry.getActiveRuntimeProfile({ organizationId: "acme" });
// enterprise preset
```

## Dependencies

- `@ai-gateway/config` (schema/type only today — see above)
- `zod`

## Architecture reference

§37

## Testing strategy

Schema tests validate every seed preset against `runtimeProfileSchema`,
including the optional-fields-omitted case for `cost`, and reject
structurally invalid profiles (bad lifecycle state, bad aggressiveness
enum, non-positive `maxProvidersInFailoverChain`, missing field).
`seed-data.test.ts` asserts the seed set matches exactly the six named
presets with no duplicates, that the default id is one of them, and spot
checks two presets' `allowedLifecycleStates` against their qualitative
§37.3 description (`enterprise` = `stable` only, `development` includes
`experimental`). `tenant.test.ts` covers the org-only vs. org+workspace key
forms. `cache.test.ts` covers the local `TtlCache` copy directly. Store
tests cover both `InMemoryRuntimeProfileStore` and
`InMemoryTenantAssignmentStore` in isolation. `DefaultRuntimeProfileRegistry`
tests cover the full three-level fallback (tenant override → deployment
default → `"production"`), workspace-scoped tenants being independent of
their parent org, `setTenantRuntimeProfile` rejecting an unregistered id,
`upsertProfile` insert and overwrite, a cache-hit test, TTL expiry, and the
`onCacheInvalidated` subscribe/unsubscribe round trip.
