# ADR-0006: `policy-engine` has no dependency edge onto `@ai-gateway/config` — architecture §13.3/§13.4 vs. Section 4.1's `DEPENDENCY_TABLE`

**Status:** Proposed (draft — raised during EM-3 implementation, not yet decided)
**Date:** 2026-07-07
**Format:** Context / Decision / Consequences / Alternatives

> **Note on this draft:** This ADR documents a pre-existing inconsistency
> between the approved Architecture Specification and the frozen (EM-0)
> `.dependency-cruiser.cjs` dependency table. It is **not** a `policy-engine`
> defect — this milestone's `policy-engine` implements architecture §13's
> decision pipeline exactly, using constructor-supplied defaults in place of
> the config-sourced values §13.3/§13.4 describe, precisely because no
> dependency edge exists to read them from `@ai-gateway/config` directly.
> Per this milestone's "document, don't invent a solution" instruction for
> any architectural inconsistency implementation exposes, `.dependency-cruiser.cjs`
> is not modified by this document.

## Context

Architecture §13.3 states: "Weights (`w_quality`, `w_latency`, `w_cost`,
`w_health`) are part of `GatewayConfig.routing` and are overridable per
task type, per workspace, and per organization." §13.4 states routing
rules "are... registered via config, not compiled into the scorer."

Section 4.1's `DEPENDENCY_TABLE` (`.dependency-cruiser.cjs`, frozen EM-0)
declares:

```js
"policy-engine": ["model-registry", "reliability", "core-contracts"],
```

`config` is absent. `GatewayConfig` (`@ai-gateway/config`, frozen EM-1) has
no `routing.weights`/`routing.rules` fields in the first place — its
`GatewayConfig.routing` shape (`packages/config/src/schema.ts`) is
`{ defaultStrategy, perTaskOverrides? }` only, with `RoutingOverride`
limited to `{ strategy?, preferredProviders? }`. So even if the dependency
edge existed, `config`'s current schema could not carry §13.3's four named
weights or §13.4's rule declarations without its own schema change.

**Why this matters:** `policy-engine` cannot, as specified, read its
scoring weights or its routing rules from `GatewayConfig` at all in EM-3 —
neither the dependency edge nor the config schema field exists for either.

## Decision

**Not yet decided.** Filed in draft form for the Board. `policy-engine`
ships in EM-3 with `weights`/`rules` as `PolicyEngineConfig` constructor
options (documented defaults: `DEFAULT_SCORING_WEIGHTS`,
`[preferredProvidersRule]`) — this is buildable and fully testable today,
and is additive to whichever resolution the Board picks (a future
composition root would simply populate these same constructor options from
`GatewayConfig` rather than the caller supplying hardcoded defaults).

### Option A — Add a `policy-engine` -> `config` dependency edge, and extend `GatewayConfig.routing`'s schema with `weights`/`rules`

- Directly closes the gap: architecture §13.3/§13.4 become literally true.
- Requires modifying two frozen artifacts: `.dependency-cruiser.cjs`
  (EM-0) and `@ai-gateway/config`'s schema (EM-1) — same governance
  question ADR-0005 already raised for a narrower case (widening
  `BackoffStrategy`), but larger in scope here (a new dependency edge, not
  just a wider enum).
- `RoutingRule`'s `applies`/`apply` are functions — config (a
  serializable, schema-validated data structure) cannot carry them
  directly. Config could carry rule _declarations_ (e.g. `{ type:
"preferredProviders", providers: [...] }`) that a factory turns into
  `RoutingRule` instances, but that factory/registry doesn't exist yet and
  is its own design question.

### Option B — Leave the dependency table and config schema as-is; policy-engine keeps constructor-option defaults, translated by a future composition root

- No frozen-artifact change at all.
- `apps/gateway-server`'s bootstrap (EM-5) or the orchestrator (EM-4) reads
  `GatewayConfig.routing` and constructs the `PolicyEngineConfig` object
  passed to `DefaultPolicyEngine`, translating field-by-field where the
  shapes overlap (`preferredProviders` already matches
  `RoutingOverrideLike` structurally) and leaving weights/rule-declaration
  support out of `config` until a dedicated schema-extension pass.
- Matches the precedent set by ADR-0005 (leave a frozen package's narrower
  schema as-is, translate at the seam that needs the fuller shape) and by
  `provider-sdk`/`reliability`'s duplicated types generally.

**Recommendation (non-binding):** Option B for EM-3/EM-4 — the composition
root doesn't exist yet regardless (EM-5 scope), so there is no immediate
consumer for a widened `config` schema today. Revisit as Option A once
`apps/gateway-server`'s bootstrap is being built and a concrete
config-to-constructor-options translation is needed, at which point the
Board can decide whether to extend `config`'s frozen schema or keep the
translation entirely outside it.

## Consequences

- Until resolved, every `PolicyEngineConfig.weights`/`.rules` value in a
  running deployment is either the shipped default or whatever a caller
  hardcodes at construction — there is no operator-configurable,
  hot-reloadable path for either, unlike every other `GatewayConfig`-backed
  setting.
- No code in this repository changes as a result of this ADR.
  `.dependency-cruiser.cjs` and `@ai-gateway/config/src/schema.ts` are
  unmodified; `policy-engine`'s constructor-option design is unaffected by
  which option the Board eventually picks.

## Alternatives considered

- **Have `policy-engine` read `process.env` directly for weight overrides,
  bypassing `config` entirely.** Rejected: this would duplicate exactly the
  environment-parsing/validation responsibility `config` already owns
  (Blueprint §8.2), producing two independent, potentially-divergent
  sources of the same operator-facing setting.
