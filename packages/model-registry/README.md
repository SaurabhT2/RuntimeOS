# @ai-gateway/model-registry

**Status:** implemented (EM-2). Queryable, config-driven model registry
(architecture §14; Blueprint §8.6).

## Public API

- `ModelRegistry` — `queryModels(filter)`, `getModel(providerId, modelId)`,
  `upsertModel(descriptor)` (architecture §11, verbatim). `DefaultModelRegistry`
  is the shipped implementation: a TTL-cached read layer in front of a
  swappable `ModelStore`.
- `ModelDescriptor` / `modelDescriptorSchema` — architecture §14.1's schema,
  as a TypeScript interface plus a Zod runtime schema.
- `ModelQuery` — the `queryModels` filter shape (designed, not specified by
  architecture §11): `providerId`, `modelClass`, `enabledOnly` (default
  `true`), `minContextWindow`, `requiresStructuredOutput`,
  `requiresToolCalling`, `costTier` — ANDed together.
- `ModelStore` — the storage seam. `InMemoryModelStore` ships now; a
  DB-backed implementation is future work (see Design notes).
- `TtlCache` — the generic TTL-cache-plus-invalidation-event primitive
  `DefaultModelRegistry` is built on (architecture §14.2).
- `SEED_MODELS` — architecture §14.3's illustrative seed table as full
  `ModelDescriptor` records (placeholder model IDs — see file docs).

## Design notes

- **Storage:** architecture §14.2 describes a DB-backed store with a
  Redis-invalidated in-memory cache. No DB driver or Redis client exists
  anywhere in this repo yet — that wiring is `apps/gateway-server`'s
  composition-root job (Blueprint §6.4), which doesn't exist until EM-5.
  This package ships the full interface (`ModelStore`) and the in-process
  half of the cache/invalidation mechanism (`TtlCache`), with
  `InMemoryModelStore` as the only implementation today — the same pattern
  `@ai-gateway/config` already established and was reviewed against in
  EM-1 (env/file/in-memory `ConfigSource`s now, DB-backed later, additively).
- **`lifecycle.ts` is intentionally absent.** The package diagram
  (architecture §9) marks it `(v1.1)`; lifecycle states and auto-migration
  rules are architecture §35 (v1.1), out of EM-2's scope. Building it now
  would be exactly the "implementing future milestone functionality early"
  Blueprint §13.4/§13.5 warns against.

## Usage example

```ts
import { DefaultModelRegistry, SEED_MODELS } from "@ai-gateway/model-registry";

const registry = new DefaultModelRegistry({ seed: SEED_MODELS });

const candidates = await registry.queryModels({
  modelClass: "fast-extraction",
  requiresStructuredOutput: true,
});

const model = await registry.getModel("groq", "groq-fast-extraction-v1");

await registry.upsertModel({ ...model!, availability: { ...model!.availability, enabled: false } });
```

## Dependencies

- `@ai-gateway/core-contracts`
- `@ai-gateway/config`
- `zod`

## Architecture reference

§14

## Testing strategy

Schema round-trip tests validate every seed model against
`modelDescriptorSchema` and reject structurally invalid descriptors.
`TtlCache` unit tests cover expiry and invalidation notification in
isolation. `DefaultModelRegistry` tests cover every `ModelQuery` filter
(individually and combined) and the write → invalidate → re-read round
trip (architecture §14.2's "an operator updates a row/record, and every
gateway instance picks it up within seconds"), including a test asserting
`queryModels` is actually served from cache (the underlying store's `list`
is called exactly once across three identical queries).
