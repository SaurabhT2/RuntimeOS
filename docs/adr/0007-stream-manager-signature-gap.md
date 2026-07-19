# ADR-0007: `StreamManager.openStream`'s literal signature (architecture §11) does not compile against this codebase's dependency boundaries, and `cancel(requestId)` is otherwise unaddressable

**Status:** Proposed (draft — raised during EM-3 implementation, not yet decided)
**Date:** 2026-07-07
**Format:** Context / Decision / Consequences / Alternatives

## Context

Architecture §11 gives, verbatim:

```typescript
// packages/streaming/src/stream-manager.ts
export interface StreamManager {
  openStream(plan: ExecutionPlan, cred: ScopedCredential): AsyncIterable<NormalizedChunk>;
  cancel(requestId: string): void;
}
```

Two independent problems surfaced implementing this literally, in `streaming`, for EM-3:

1. **`ExecutionPlan` is `@ai-gateway/policy-engine`'s type**, and Section
   4.1's `DEPENDENCY_TABLE` (`.dependency-cruiser.cjs`, frozen EM-0)
   restricts `streaming` to `["providers/provider-sdk", "core-contracts"]`
   — no edge to `policy-engine` exists. Importing `ExecutionPlan` into
   `streaming` is not possible without either widening that frozen table
   (a `policy-engine` -> ... no, a `streaming` -> `policy-engine` edge) or
   this ADR's chosen alternative below.
2. **Even with that edge, an `ExecutionPlan` alone is not enough to call
   `adapter.invokeStream()`.** It carries routing decisions
   (`providerId`, `modelId`, `temperature`, etc.) but neither a resolved
   `ProviderAdapter` _instance_ (adapters are resolved by `providerId`
   against some adapter registry, which doesn't exist as a concrete
   artifact until an orchestrator/composition-root builds one, EM-4/EM-5)
   nor a built `NormalizedInvocation` (the message list, tools, etc.,
   built from the original `ExecuteRequest` — also not `policy-engine`'s
   job; see `policy-engine`'s own README, "Relationship to
   orchestrator/streaming").
3. **`cancel(requestId: string)` has no way to learn what `requestId` an
   `openStream` call corresponds to**, since `openStream`'s parameter list
   as given has no `requestId` (nor anything else stable and caller-known)
   to key later cancellation by.

None of these are `streaming`-package implementation mistakes to fix
quietly — they are gaps in the literal interface text itself, surfaced by
actually trying to compile and call it for the first time (this package
was an empty scaffold through EM-0–EM-2).

## Decision

**Not yet decided** at the architecture level — filed for the Board.
`streaming` ships in EM-3 with `openStream`'s signature adapted to:

```typescript
openStream(
  adapter: ProviderAdapter,
  invocation: NormalizedInvocation,
  cred: ScopedCredential,
  requestId: string,
): AsyncIterable<NormalizedChunk>;
```

This is buildable and testable today without touching any frozen
artifact, and is forward-compatible with whichever resolution the Board
picks (see Alternatives) — the orchestrator (EM-4), the one package with
a legitimate dependency edge onto both `policy-engine` and `streaming`,
is expected to be the seam that resolves an `ExecutionPlan` into
`(adapter, invocation)` before calling this method, using whatever
`requestId` it already carries from the original `ExecuteRequest`'s
handling.

### Option A — Give `orchestrator` (not `streaming`) the job of translating `ExecutionPlan` -> `(adapter, invocation)`, keep `streaming`'s signature as adapted here

- No frozen-artifact change. Matches this milestone's shipped code exactly.
- `streaming` stays a thin, provider-adapter-level transport package —
  consistent with its Blueprint description ("StreamManager interface +
  implementation, sse.ts... SSE streaming transport"), not an orchestration
  layer.
- The architecture document's §11 snippet becomes documentation of
  _intent_ (what `StreamManager` conceptually does) rather than a literal,
  compilable type — which several other §11 interfaces already are in
  practice (`PolicyContext`'s shape, similarly, had to be designed rather
  than transcribed; see `policy-engine`'s ADR-0006).

### Option B — Add a `streaming` -> `policy-engine` dependency edge, and give `ExecutionPlan` an adapter-resolution mechanism

- Would need `.dependency-cruiser.cjs` (frozen EM-0) modified.
- Still doesn't solve problem 2 above on its own — `ExecutionPlan` would
  additionally need either an embedded `ProviderAdapter` reference (which
  makes `ExecutionPlan` no longer a plain, serializable routing decision —
  a change to `policy-engine`'s own EM-3 design, not just `streaming`'s)
  or `streaming` would need its own adapter registry/resolution logic
  (duplicating whatever the orchestrator already needs to do to invoke
  `adapter.invoke()` for the non-streaming path).
- Not recommended: solves less than Option A while costing more (a new
  frozen-table edge, plus additional design work on `ExecutionPlan`
  itself).

### Option C — Add `requestId` (and a `providerId`/`modelId` pair, resolved externally to an adapter) onto `ExecutionPlan` itself

- Doesn't fix problem 1 (the missing dependency edge) or fully fix
  problem 2 (still no `ProviderAdapter` instance, only more routing data).
- Not recommended for the same reason as Option B: pushes complexity into
  `policy-engine`'s `ExecutionPlan` shape for a problem that belongs to
  the orchestrator seam, not the routing-decision data structure.

**Recommendation (non-binding):** Option A. It's what ships in this
milestone regardless of the Board's eventual decision, imposes no change
on any frozen artifact, and correctly locates "translate a routing
decision into an actual provider call" at the one package built
specifically to assemble Waves 1–3 (EM-4's `orchestrator`, per Blueprint
§5/§8's own description of that milestone's job).

## Consequences

- `StreamManager`'s public type in this codebase does not literally match
  architecture §11's snippet. Anyone reading the architecture doc
  alongside the code needs this ADR to reconcile the two — flagged here
  explicitly rather than left as a silent surprise.
- No code in this repository changes as a result of this ADR being in
  "Proposed" status; `streaming`'s shipped `StreamManager` interface is
  exactly the adapted signature above regardless of which option the
  Board eventually formalizes.
- The orchestrator (EM-4) inherits an explicit, load-bearing
  responsibility (`ExecutionPlan` -> `(adapter, invocation)` resolution)
  that architecture §11's diagram doesn't currently show as belonging to
  any one package. EM-4's own design work should account for it.

## Alternatives considered

- **Leave `openStream` exactly as architecture §11 states it and accept
  that it will not compile / cannot be meaningfully implemented.**
  Rejected outright — Blueprint's own "no placeholders, no pseudo-code"
  Definition of Done for this milestone precludes shipping a
  known-non-functional interface.
