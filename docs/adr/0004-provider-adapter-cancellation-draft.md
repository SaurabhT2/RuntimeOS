# ADR-0004: `ProviderAdapter` has no cancellation primitive — architecture §11 vs. §18.4/§24

**Status:** Proposed (draft — raised by independent EM-1 review, not yet decided)
**Date:** 2026-07-05
**Format:** Context / Decision / Consequences / Alternatives

> **Note on this draft:** This ADR documents a pre-existing inconsistency in
> the approved Architecture Specification. It is **not** an EM-1
> implementation defect — the frozen `ProviderAdapter` interface (§11) was
> implemented verbatim, and EM-1 correctly did not add an out-of-spec
> `abort()`/`AbortSignal` on its own initiative. This document exists to
> put the inconsistency, and candidate resolutions, on record for the
> Architecture Review Board's decision before the affected future
> milestones begin. It does not itself decide the outcome, and no
> implementation change accompanies it.

## Context

Architecture §11 (`Internal Interfaces`) specifies the frozen
`ProviderAdapter` interface as:

```ts
interface ProviderAdapter {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  invoke(req: NormalizedInvocation, cred: ScopedCredential): Promise<NormalizedResult>;
  invokeStream(req: NormalizedInvocation, cred: ScopedCredential): AsyncIterable<NormalizedChunk>;
  healthCheck(cred: ScopedCredential): Promise<ProviderHealthSnapshot>;
  estimateCost(req: NormalizedInvocation): CostEstimate;
}
```

Neither `invoke` nor `invokeStream` accepts an `AbortSignal` (or any other
cancellation token), and the interface has no `abort()` method. EM-1
implements this verbatim — `packages/providers/provider-sdk/src/provider-adapter.ts`
matches §11 field-for-field.

However, later sections of the same, approved architecture document assume
an adapter-level abort capability exists:

- **§18.4:** "A single end-to-end deadline is computed from
  `constraints.maxLatencyMs` (or a system default) at request entry and
  propagated as a `AbortSignal`/deadline timestamp through every layer —
  Policy Engine, Credential Resolver, Retry Engine, **Provider Adapter**."
- **§24 (Testing Strategy, Streaming row):** "Tests asserting chunk
  ordering, **cancellation propagation (client disconnect → adapter
  `abort()`)**, and correct `finishReason` on truncation/cancel/completion."
- **§8.2 sequence diagram** ("Streaming Execution with Client
  Cancellation"): `Stream->>Prov: abort()` is shown as a concrete
  interaction between the Streaming layer and the Provider Adapter.

No mechanism on the frozen §11 interface can fulfill any of the above. This
is the "cancellation gap" identified as the independent EM-1 review's most
significant finding (review §5, §10, §13; Required Change #2).

**Why this matters now, not later:** `MockAdapter`'s `withTimeout` helper
races a promise against a timer and gives up waiting when the timer fires
first — it does not, and structurally cannot, stop the in-flight work,
because there is nothing on the interface to stop it. This has no observable
cost for a Mock Adapter with no real I/O. It will have a real cost for
Groq/NIM adapters (EM-4) making real HTTP calls: an abandoned-but-still-
running request continues to consume rate-limit budget on the provider
side, and `StreamManager.cancel(requestId)` (§11) has no adapter-level
mechanism to actually fulfill on.

## Decision

**Not yet decided.** This ADR is filed in draft form to surface the
inconsistency and candidate approaches to the Architecture Review Board.
Per the Engineering Blueprint's rule that changes to a frozen interface
require an ADR (Blueprint §6.3; architecture §28/§39/§46), `ProviderAdapter`
is not modified by this document or by this stabilization pass.

The two live candidate approaches, as raised by the review:

### Option A — Add an `AbortSignal` parameter to `invoke`/`invokeStream`

```ts
invoke(req: NormalizedInvocation, cred: ScopedCredential, signal?: AbortSignal): Promise<NormalizedResult>;
invokeStream(req: NormalizedInvocation, cred: ScopedCredential, signal?: AbortSignal): AsyncIterable<NormalizedChunk>;
```

- Matches §18.4's own language ("propagated as a `AbortSignal`/deadline
  timestamp") most directly.
- Idiomatic for Node/fetch-based HTTP clients (most real adapters will call
  `fetch` or an SDK that already accepts `AbortSignal`), likely minimizing
  adapter-author friction in EM-4.
- Additive if the parameter is optional: existing call sites (and
  `MockAdapter`) continue to compile without passing it, though any caller
  that wants real cancellation must be updated to pass one.
- Does not by itself give `healthCheck` a cancellation path if that is ever
  needed; would need its own signal parameter if so (not currently in
  scope of the §11 gap as raised).

### Option B — Add an `abort()` method to `ProviderAdapter`

- Matches the §8.2 sequence diagram's literal `Stream->>Prov: abort()`
  interaction most directly.
- Coarser-grained: a single `abort()` cancels _whatever_ is in flight for
  that adapter instance, rather than one specific in-flight call. This is
  a materially different cancellation model from Option A's per-call
  signal and would need its own answer for concurrent in-flight requests
  on the same adapter instance (e.g. does `abort()` cancel all of them, or
  is there an implicit one-call-at-a-time assumption per adapter
  instance?) — a question Option A does not have, since each call gets
  its own signal.

### Cross-cutting considerations for either option

- Whichever is chosen, it should be additive to the current §11 shape (no
  removal/renaming of existing members), consistent with the Blueprint's
  general preference for additive frozen-interface changes over breaking
  ones.
- Either option needs a corresponding conformance-suite scenario
  (`packages/providers/provider-sdk/src/conformance.ts`) asserting that a
  cancelled in-flight call actually stops doing adapter-side work (not just
  that the caller stops waiting), otherwise the same gap simply moves from
  "untestable" to "untested."
- `NormalizedChunk`'s existing `usage` field-placement question (review §5,
  Technical Debt table, Low severity) is a related but separate forward
  question for `streaming` (Wave 3) and is tracked independently — it is
  not resolved by this ADR.

**Recommendation (non-binding, for the Board's consideration):** Option A
(`AbortSignal` parameter) is the more conventional shape for the kind of
HTTP-calling adapters EM-4 will introduce, and maps directly onto §18.4's
own "propagated as an `AbortSignal`" language rather than requiring a
separate abstraction. Option B more literally matches the §8.2 diagram, but
that diagram is reasonably read as an illustrative sequence rather than a
literal method-signature specification, whereas §18.4 is prose describing
the propagation mechanism directly. Final choice is left to the Board.

## Consequences

- Until this ADR is resolved (Accepted, in either form, or Superseded),
  neither Reliability's timeout/circuit-breaker work nor Streaming's
  cancellation-propagation acceptance criterion (§18.4) can be considered
  buildable to completion against `ProviderAdapter` as it stands — retry
  and circuit-breaker logic itself can be built against `invoke`/
  `invokeStream` as-is, but true in-flight cancellation cannot (review
  §13).
- Groq/NVIDIA adapters (EM-4) can still be implemented against the
  interface exactly as frozen today — nothing about a real HTTP-based
  adapter is incompatible with `invoke`/`invokeStream`/`healthCheck`/
  `estimateCost` as currently specified. They will, however, need whichever
  cancellation mechanism this ADR settles on by the time Streaming's
  client-disconnect-aborts-upstream-call criterion (§18.4) is implemented.
- No code in this repository changes as a result of this draft. `provider-sdk/src/provider-adapter.ts`, `mock-adapter.ts`, and `conformance.ts`
  are unmodified.

## Alternatives considered

- **Leave the interface unchanged and have Reliability/Streaming work
  around it** (e.g. by only ever racing a timer without true cancellation,
  as `MockAdapter` currently does). Rejected as a durable solution: this
  works for a Mock Adapter with no real I/O, but for a real HTTP-calling
  adapter it silently leaks in-flight requests against the provider's
  rate-limit budget on every timeout/cancellation, which §18.4 and §24 both
  treat as a real, tested behavior, not an acceptable gap.
- **Resolve this gap implicitly inside each future adapter** (e.g. each
  adapter manages its own internal cancellation without a shared interface
  member). Rejected: this defeats the purpose of a shared `ProviderAdapter`
  interface and the shared conformance suite (§19.2's "every adapter must
  pass identically" guarantee) — cancellation would then be adapter-
  specific and untestable by the shared suite.
