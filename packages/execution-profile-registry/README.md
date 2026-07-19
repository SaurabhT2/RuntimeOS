# @ai-gateway/execution-profile-registry

**Status:** implemented (EM-6). Resolves a task type (or an explicit
override profile ID) to a full `ExecutionProfile`: inference parameters,
retry policy, streaming/structured-output/caching defaults (architecture
§31; Blueprint §8.15). Not yet wired into `orchestrator`/`policy-engine` —
that wiring, and the merge with Runtime Profile adjustments into a
`ResolvedExecutionProfile`, is `strategy-layer`'s job (Wave 8, EM-8,
architecture §31.4).

## What an Execution Profile is, and isn't

An `ExecutionProfile` answers "how should this task run?" — temperature,
max output tokens, retry policy, whether to stream, whether to cache. It
does **not** answer "which provider/model?" (that's the Policy Engine,
architecture §13) and it does **not** answer "what does this deployment's
risk tolerance allow?" (that's `runtime-profiles`, architecture §37). The
three compose in `strategy-layer` (EM-8):

```
Task  →  Capabilities Required   →  Execution Profile   ⊕  Runtime Profile  →  ResolvedExecutionProfile  →  Policy Engine
        (capability-registry)       (this package)          (runtime-profiles)   (strategy-layer, EM-8)      (unchanged)
```

## Why the task and profile vocabularies are different strings

`core-contracts`' `TaskType` is business-facing and granular
(`knowledge_extraction`, `complex_reasoning`, `marketing_content`).
`ExecutionProfileId` is role-based and coarser (`extraction`, `reasoning`,
`composition`) — several task types can share one profile. `seed-data.ts`'s
`TASK_TO_EXECUTION_PROFILE_ID` is the mapping between them; see that file's
doc comment for why architecture §31.4's sequence diagram can call
`getProfile("summarization")` directly even though the two vocabularies
differ everywhere else.

## Public API

- `ExecutionProfileRegistry` — `resolveProfile(task, overrideProfileId?)`,
  `getProfileById(profileId)`, `upsertProfile(profile)`,
  `registerTaskMapping(task, profileId)`. `DefaultExecutionProfileRegistry`
  is the shipped implementation, TTL-cached in front of a swappable
  `ProfileStore`.
- `createSeededExecutionProfileRegistry(options?)` — convenience factory
  pre-loaded with `SEED_EXECUTION_PROFILES` and `TASK_TO_EXECUTION_PROFILE_ID`.
- `ExecutionProfile` / `ResolvedExecutionProfile` / `executionProfileSchema`
  — architecture §31.2's schema. `ResolvedExecutionProfile` is exported now
  (for `strategy-layer` to consume in EM-8) but nothing in this package
  produces one — the Runtime Profile merge happens in `strategy-layer`,
  never here (see the type's own doc comment).
- `RetryPolicy` / `DEFAULT_RETRY_POLICY` — a local, field-for-field copy of
  `@ai-gateway/reliability`'s type (this package cannot depend on
  `reliability` per Blueprint §4.1's dependency table — see
  `retry-policy.ts`'s doc comment for the full rationale).
- `TtlCache` — a local copy of `@ai-gateway/model-registry`'s cache
  primitive, for the same "frozen dependency edge" reason (see `cache.ts`).
- `ExecutionProfileResolutionError` — thrown when neither an override nor
  the task mapping resolves to a registered profile (architecture §19.3's
  never-silent-failure principle).

## `preferences.executionProfileOverride`

`resolveProfile(task, overrideProfileId)`'s second parameter is how this
package implements architecture §31.1's request-level override: when
present, task-driven resolution is bypassed entirely, but the override is
still resolved through the registered-profiles store (never a raw
passthrough) and still raises `ExecutionProfileResolutionError` if the
named profile isn't registered (ADR-010).

## Usage example

```ts
import { createSeededExecutionProfileRegistry } from "@ai-gateway/execution-profile-registry";

const registry = createSeededExecutionProfileRegistry();

const profile = await registry.resolveProfile("summarization");
// { id: "summarization", inference: { temperature: 0.3, maxOutputTokens: 1024 }, ... }

const overridden = await registry.resolveProfile("classification", "coding");
// profile.id === "coding" — task mapping bypassed entirely

await registry.upsertProfile({ ...profile, id: "summarization", timeoutMs: 45_000 });
```

## Dependencies

- `@ai-gateway/core-contracts`
- `@ai-gateway/config` (declared per Blueprint §4.1's dependency table;
  this package's seed data conceptually originates from config-driven
  sources, same as `model-registry`'s declared-but-not-directly-imported
  `config` dependency — no direct import is required today)
- `zod`

## Architecture reference

§31

## Testing strategy

Schema tests validate every seed profile against `executionProfileSchema`
and reject structurally invalid profiles (bad temperature, bad backoff
strategy, bad `retryableErrorCodes` entry, bad `keyStrategy`, missing
field). `seed-data.test.ts` asserts `TASK_TO_EXECUTION_PROFILE_ID` covers
every `KNOWN_TASK_TYPES` entry and only maps to registered seed profile
ids, and that seed profile ids have no duplicates. `cache.test.ts` covers
the local `TtlCache` copy directly (get/set/expiry via an injected clock/
invalidate-one/invalidate-all/subscribe/unsubscribe). `InMemoryProfileStore`
tests cover get/upsert/list/delete in isolation. `DefaultExecutionProfileRegistry`
tests cover: task-driven resolution for every known task end to end;
unmapped-task and unknown-profile-id errors; the override path (both
successful bypass and unknown-override-id failure); `getProfileById` on an
empty registry; `upsertProfile` insert and overwrite; `registerTaskMapping`
making a new task resolvable; a cache-hit test (`store.get` called exactly
once across three identical lookups); TTL expiry; and the
`onCacheInvalidated` subscribe/unsubscribe round trip.
