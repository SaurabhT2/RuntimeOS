# ADR-0015: `plugin-system` depends on `providers/provider-sdk`, correcting an interface-fidelity defect

**Status:** Accepted (implemented as of EM-7, correcting a defect found in EM-7's own first draft by the Independent Engineering Review)
**Date:** 2026-07-13
**Format:** Context / Decision / Consequences / Alternatives

## Context

Architecture §11 freezes `GatewayPlugin`:

```typescript
export interface GatewayPlugin {
  name: string;
  onRequest?(req: ExecuteRequest): Promise<ExecuteRequest>;
  onResponse?(res: ExecuteResponse): Promise<ExecuteResponse>;
  onProviderRegistered?(adapter: ProviderAdapter): void;
}
```

`ProviderAdapter` is `@ai-gateway/provider-sdk`'s own exported type
(`{ id, capabilities, invoke, invokeStream, healthCheck, estimateCost }`).
Engineering Blueprint §4.1's dependency table lists `plugin-system`'s
dependencies as `core-contracts` only — no `provider-sdk` edge.

EM-7's first draft of this package resolved that gap by substituting a
locally-defined `RegisteredProviderAdapter` (`{ id: string }` only) for the
real `ProviderAdapter`, reasoning by analogy to `runtime-profiles`' small
local type copies (e.g. `TenantRef`). The Independent Engineering Review of
EM-7 (Issue #1) found this analogy didn't hold: unlike those small,
near-lossless copies, dropping `capabilities`/`invoke`/`invokeStream`/
`healthCheck`/`estimateCost` from `ProviderAdapter` removes real,
architecture-granted capability from any plugin author's `onProviderRegistered`
implementation — a plugin correctly written against this package's
published type cannot call `adapter.healthCheck()` even though architecture
§11 says it can. The review also found the correct fix was available and
low-cost: `provider-sdk` depends only on `core-contracts` (Blueprint §4.1's
own Wave 1 table entry), so adding the edge carries no layering or
circularity risk — the exact same pattern `prompt-optimizer` used correctly,
in this same milestone, for its own forced `execution-profile-registry`
gap (ADR-0014).

## Decision

Add `providers/provider-sdk` as a dependency of `plugin-system`
(`package.json` and `.dependency-cruiser.cjs`'s `DEPENDENCY_TABLE`).
`GatewayPlugin.onProviderRegistered` now takes the real `ProviderAdapter`
type, matching architecture §11 exactly. `RegisteredProviderAdapter` is
removed; nothing in this milestone's own code ever calls
`onProviderRegistered` with a real adapter (no Orchestrator/provider
wiring exists yet — that remains EM-8's job), so no runtime behavior
changes, only the type plugin authors write against.

Unlike ADR-0014, this decision is **not** left open for the Board: there is
no genuine trade-off here (both options considered below resolve to the
same practical outcome, and one is strictly worse), so this ADR is filed as
Accepted rather than Proposed, consistent with the "Accepted decisions are
settled" convention `docs/adr/README.md` already establishes for
comparably unambiguous fixes (e.g. ADR-0012 correcting ADR-0011 in the same
milestone it was discovered).

## Consequences

- `plugin-system`'s dependency edges are now `core-contracts`,
  `providers/provider-sdk` — Blueprint §4.1's table should be corrected to
  match at the next opportunity (the same table-maintenance question
  ADR-0014 raises for `prompt-optimizer`, but not itself re-litigated here).
- No other package's dependency edges change. `plugin-system` still has no
  edge onto `orchestrator`, `policy-engine`, or `strategy-layer` — EM-7's
  "no integration with Orchestrator" constraint is unaffected.
- Any future `GatewayPlugin` implementation (including the `createPassthroughLoggingPlugin`
  example this package ships) can now legitimately be written against the
  full `ProviderAdapter` surface inside `onProviderRegistered`, matching
  what architecture §11 always intended plugin authors to have.

## Alternatives considered

**Duplicating a local, full copy of `ProviderAdapter`** (mirroring
`reliability`'s precedent of field-for-field duplicating
`ProviderHealthSnapshot` rather than depending on `provider-sdk`) was
considered and rejected: that precedent exists specifically because
`reliability`'s frozen dependency edge (`core-contracts`, `config`,
`telemetry` only) _must never_ depend on `provider-sdk` (architecture
§11/EM-1 review precedent — `reliability` sits below `provider-sdk` in the
intended layering, so the edge would be backwards). `plugin-system` has no
such constraint: it sits at Wave 7, strictly above `provider-sdk`'s Wave 1,
so depending on it directly is the ordinary, correct shape — duplicating a
five-member interface with two async iterator-returning methods, when a
clean forward edge is available, would only invite drift between the copy
and the real interface as `provider-sdk` evolves.
