# @ai-gateway/capability-registry

**Status:** implemented (EM-6). Maps a task type to the abstract
capabilities it requires, independent of any model or provider (architecture
§32; Blueprint §8.14). Not yet wired into `orchestrator`/`policy-engine` —
that integration is `strategy-layer`'s job (Wave 8, EM-8, architecture §30.2).

## Why this package exists, separately from `model-registry`

`model-registry` (architecture §14) answers "what does this **model**
offer?". This package answers a different question: "what does this
**task** need?" (architecture §32.1, ADR-009). Keeping them separate means a
new generation of models never requires a `capability-registry` change, and
a new business requirement for a task (e.g. "extraction now also needs tool
calling") never requires a `model-registry` change — see ADR-009.

```
Task  →  Capabilities Required  →  Execution Profile  →  Candidate Models  →  Selected Provider
        (this package)             (execution-profile-      (model-registry,     (policy-engine,
                                     registry)                 unchanged)          unchanged)
```

## Public API

- `CapabilityRegistry` — `resolveCapabilities(task, req?)`,
  `registerMapping(task, capabilities)` (architecture §32.2, verbatim).
  `DefaultCapabilityRegistry` is the shipped implementation: a TTL-cached
  read layer in front of a swappable `CapabilityStore`, mirroring
  `DefaultModelRegistry`'s design exactly — the same `TtlCache` class,
  imported directly from `@ai-gateway/model-registry` rather than
  reimplemented (that dependency edge is already declared per Blueprint
  §4.1).
- `CapabilitySet` / `capabilitySetSchema` — architecture §32.2's schema.
  `reasoningDepth` reuses `@ai-gateway/model-registry`'s `REASONING_DEPTHS`
  constant so the two registries can never drift onto incompatible
  vocabularies — the concrete expression of Blueprint §8.14's "read-only,
  for cross-checking capability vocabulary" dependency on `model-registry`.
  This package never queries `model-registry` at runtime; matching a
  `CapabilitySet` against real `ModelDescriptor`s stays the Policy Engine's
  job (architecture §13.2, ADR-009).
- `CapabilityStore` / `InMemoryCapabilityStore` — the storage seam, same
  pattern as `ModelStore`.
- `SEED_CAPABILITIES` — one entry per `core-contracts`' `KNOWN_TASK_TYPES`
  (designed, not specified — architecture §32 defines the schema but not a
  seed table; see the file's own doc comment for the reasoning behind each
  entry).
- `CapabilityResolutionError` — thrown by `resolveCapabilities` when a task
  has no registered mapping (architecture §19.3's never-silent-failure
  principle: an unmapped task must surface as a clear, typed error, not
  silently fall back to a guessed default).

## Request-level override folding

`resolveCapabilities(task, req)` folds in `ExecuteRequest.constraints`
exactly as architecture §32.2 describes: `requiredSchema` forces
`structuredOutput: true`; `minContextTokens` raises (never lowers) the
task's default; an explicit `streaming` constraint overrides the task's
default `streamingPreferred`, in either direction. No other inference (e.g.
classifying capability needs from message content) happens in this
package — see the design notes in `src/registry.ts`.

## Usage example

```ts
import { DefaultCapabilityRegistry, SEED_CAPABILITIES } from "@ai-gateway/capability-registry";

const registry = new DefaultCapabilityRegistry({ seed: SEED_CAPABILITIES });

const capabilities = await registry.resolveCapabilities("summarization");
// { structuredOutput: false, toolCalling: false, reasoningDepth: "shallow",
//   streamingPreferred: true, minContextTokens: 8000 }

await registry.registerMapping("ocr_extraction", {
  structuredOutput: true,
  toolCalling: false,
  reasoningDepth: "shallow",
  streamingPreferred: false,
  minContextTokens: 4000,
  visionInput: true,
});
```

## Dependencies

- `@ai-gateway/core-contracts`
- `@ai-gateway/model-registry` (read-only: `REASONING_DEPTHS`, `TtlCache`)
- `zod`

## Architecture reference

§32

## Testing strategy

Schema round-trip tests validate every seed capability set against
`capabilitySetSchema` and reject structurally invalid sets. `seed-data.test.ts`
asserts `SEED_CAPABILITIES` covers every `KNOWN_TASK_TYPES` entry, with no
stray entries, so the two lists can never silently drift apart.
`InMemoryCapabilityStore` tests cover get/upsert/list/delete in isolation.
`DefaultCapabilityRegistry` tests cover: successful seeded resolution;
`CapabilityResolutionError` on an unmapped task; each request-level
constraint override individually (`requiredSchema`, `minContextTokens`
raising-never-lowering, explicit `streaming` in both directions); a request
with no `constraints` object at all; `registerMapping` making a previously
unmapped task resolvable and overwriting a previously-seeded mapping; a
cache-hit test (the underlying store's `get` is called exactly once across
three identical resolves); TTL expiry; and the `onCacheInvalidated`
subscribe/unsubscribe round trip.
