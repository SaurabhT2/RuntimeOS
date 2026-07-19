# ADR-0005: `BackoffStrategy` has three values in architecture §18.1 but two in `@ai-gateway/config` (frozen, EM-1)

**Status:** Proposed (draft — raised during EM-2 implementation, not yet
decided)
**Date:** 2026-07-06
**Format:** Context / Decision / Consequences / Alternatives

> **Note on this draft:** This ADR documents a pre-existing inconsistency
> between the approved Architecture Specification and `@ai-gateway/config`,
> which was implemented and frozen in EM-1. It is **not** a `reliability`
> defect — `reliability`'s own `RetryPolicy.backoff` (this milestone,
> EM-2) implements architecture §18.1 exactly, as a three-value union. It
> is also **not** a `config` defect in the sense of needing an urgent fix —
> `config` is frozen (EM-0/EM-1 governance) and correctly implements the
> `GatewayConfig` schema exactly as EM-1 delivered and the EM-1 closure
> review approved it. This document exists to put the inconsistency on
> record for the Architecture Review Board's decision, per this
> milestone's "document, don't invent a solution" instruction for any
> architectural inconsistency implementation exposes. `config` is not
> modified by this document.

## Context

architecture §18.1 defines the Retry Engine's policy shape with:

```
backoff: "exponential" | "linear" | "none"
```

`@ai-gateway/config`'s `GatewayConfig.reliability.backoff` (frozen, EM-1;
`packages/config/src/schema.ts`) is:

```ts
export const BACKOFF_STRATEGIES = ["exponential", "linear"] as const;
export type BackoffStrategy = (typeof BACKOFF_STRATEGIES)[number];
```

`"none"` is absent from `config`'s version. This was not something the
EM-1 Architecture Review flagged, and the EM-1 Closure Review approved
`config` as delivered — the mismatch only became visible now, while
implementing `reliability`'s `RetryPolicy` (this package needs the _full_
architecture §18.1 type to be a correct, spec-following implementation of
the Retry Engine, and `reliability` does not import `config`'s
`BackoffStrategy` for exactly this reason — see `reliability`'s own
`types.ts` and README).

**Why this matters:** an operator configuring `GatewayConfig.reliability`
(the deployment-facing, human-editable settings surface) has no way to
express architecture §18.1's `"none"` option — "retry attempts happen with
no delay between them" — through `config` today. The only operator-facing
way to get that effect is indirectly: setting `maxRetries: 0` disables
retries entirely (a different thing — zero retries, not "retries with zero
delay"), or an operator can set `baseDelayMs`/`maxDelayMs` to `0` under
`"linear"`, which happens to produce the same runtime behavior as `"none"`
would, but does so as an implicit side effect of the delay math rather
than as an explicit, self-documenting policy choice.

## Decision

**Not yet decided.** Filed in draft form for the Board.

### Option A — Extend `config`'s `BackoffStrategy` to the full three-value set

Add `"none"` to `packages/config/src/schema.ts`'s `BACKOFF_STRATEGIES`.

- Directly closes the gap: an operator gets a real, explicit `"none"`
  option in `GatewayConfig`.
- Requires modifying a frozen (EM-0/EM-1) package. Blueprint governance
  treats EM-0/EM-1 as "immutable except for critical defects" — whether
  this qualifies as a "critical defect" (as opposed to a minor,
  workaround-available gap) is exactly the kind of call this ADR exists to
  route to the Board rather than deciding unilaterally during EM-2.
  Nothing about EM-2's own scope requires `config` to change — `reliability`
  works correctly today using its own, independently-defined
  `BackoffStrategy`.
- Additive in the narrow sense (widening an enum, not removing a value),
  so any config file that validates against the current two-value schema
  continues to validate unchanged.

### Option B — Leave `config` as-is; document the two ways to approximate `"none"`

- No frozen-package change at all.
- The operator-facing gap remains: there's no explicit, self-documenting
  `"none"` setting in `GatewayConfig`, only two workarounds (see Context)
  that produce the same runtime effect less legibly.
- Simplest, lowest-risk option if the Board considers this cosmetic rather
  than a genuine operator-facing limitation.

### Cross-cutting considerations

- Whichever the Board decides, no change to `reliability`'s own
  `RetryPolicy`/`BackoffStrategy` is implied — that type already matches
  architecture §18.1 exactly, independent of `config`'s own type. This ADR
  is entirely about whether `config`'s narrower type should widen to match,
  not about `reliability`'s correctness.
- If Option A is chosen, whoever wires `GatewayConfig.reliability` into a
  `reliability.RetryPolicy` (orchestrator or `apps/gateway-server`'s
  composition root — not built yet; not this milestone's scope) gets a
  direct, one-to-one mapping for `backoff`. Under Option B, that same
  future wiring code needs its own small translation note (documented
  wherever that wiring is built) explaining that `"none"` isn't
  representable in config the way `"exponential"`/`"linear"` are.

**Recommendation (non-binding):** Option A. Widening a frozen enum to match
its own architecture specification's stated shape is a narrow, low-risk
change (no existing valid config becomes invalid), and the operator-facing
gap Option B leaves behind is exactly the kind of small inconsistency that
tends to surface as a confusing support question later rather than now.
That said, this is squarely a governance call about how strictly EM-1's
freeze applies to a schema-widening fix, which is why it's routed here
rather than actioned during EM-2.

## Consequences

- Until this ADR is resolved, `reliability`'s `RetryPolicy.backoff` and
  `config`'s `GatewayConfig.reliability.backoff` remain two independently
  defined types that happen to overlap on two of three values. Any future
  code translating one into the other (not built yet — see Cross-cutting
  considerations) needs to handle that its input type may not cover its
  output type's full range.
- No code in this repository changes as a result of this ADR. `config`'s
  `schema.ts` is unmodified; `reliability`'s `types.ts` is unmodified by
  this document (it already implements architecture §18.1 correctly, which
  is what surfaced the mismatch in the first place).

## Alternatives considered

- **Have `reliability` import and reuse `config`'s narrower
  `BackoffStrategy` instead of defining its own.** Rejected: this would
  make `reliability`'s own `RetryPolicy` an _incorrect_ implementation of
  architecture §18.1 (missing `"none"`) in order to avoid a documentation
  ADR — trading a real spec deviation for a smaller paper trail. The
  Engineering Rules for this milestone are explicit that implementation
  should follow the architecture, and any inconsistency it exposes should
  be documented, not worked around by under-implementing the spec.
