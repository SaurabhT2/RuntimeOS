# ADR-0013: `GatewayConfig` gains an optional `runtimeProfileId` field

**Status:** Accepted
**Date:** 2026-07-12
**Format:** Context / Decision / Consequences / Alternatives

## Context

Engineering Milestone EM-6 (Blueprint §7) implements `runtime-profiles`
(architecture §37), the deployment/tenant-wide behavior overlay orthogonal
to Execution Profiles. Architecture §37.4 is explicit about where a
Runtime Profile is selected: "per tenant (organization/workspace, via
`GatewayConfig`, Section 10.6 — **extended with an optional
`runtimeProfileId` field**) or, for self-hosted deployments, per
environment/deployment as a whole."

`GatewayConfig` (`@ai-gateway/config`, shipped EM-1) is a frozen,
already-published interface. The refinement's own Philosophy #6 states that
"a change to `ExecuteRequest`, `GatewayError`, or any exported interface
requires the same ADR discipline already established" elsewhere in this
codebase — this ADR is that discipline being applied to `GatewayConfig`.

This is the same shape of change as ADR-0006, ADR-0009, and ADR-0010: a
`GatewayConfig` field/section that grows with no immediate consumer wired
up at the time it lands (`policy-engine` weights, `middleware` auth/rate-limit
config, and `reliability` config, respectively — `runtimeProfileId` here).
Those three ADRs raise a still-open, consolidated Board question about that
recurring pattern. This ADR does not resolve that question and is not a
proposed answer to it; it only adds one more field of the same shape, with
the "who wires it up" obligation explicitly named below (EM-8's
`strategy-layer` composition root) rather than left implicit.

Two constraints shaped the change:

1. It must be strictly additive — every `GatewayConfig` value valid before
   EM-6 must remain valid, unchanged, after it (no deployment's existing
   config should need updating just because this milestone shipped).
2. It must not introduce a dependency cycle. `runtime-profiles` depends on
   `config` (Blueprint §4.1's `DEPENDENCY_TABLE`); `config` must therefore
   never depend back on `runtime-profiles` for a type.

## Decision

Add one new, optional field to `GatewayConfig`:

```typescript
export interface GatewayConfig {
  // ...existing fields, unchanged...
  runtimeProfileId?: string;
}
```

with `runtimeProfileId: z.string().min(1).optional()` added to
`gatewayConfigSchema`. It is typed as a plain, unconstrained `string` —
**not** `@ai-gateway/runtime-profiles`' `RuntimeProfileId` union — for
constraint 2 above: `config` importing that type would create the exact
cycle the dependency table forbids. `config` does not interpret this
field in any way (the same "read, not interpreted, here" treatment
`config` already gives `routing.perTaskOverrides`, whose scoring logic
lives entirely in `policy-engine`). A composition root is expected to read
`GatewayConfig.runtimeProfileId` and pass it to
`DefaultRuntimeProfileRegistry` as `deploymentDefaultProfileId`; validating
that the string actually names a registered `RuntimeProfile` is
`runtime-profiles`' job (`RuntimeProfileResolutionError`), not `config`'s.

`DEFAULT_GATEWAY_CONFIG` is left unchanged (the field stays `undefined`),
satisfying constraint 1 directly — omitting it is exactly as valid as
supplying it.

## Consequences

- **Zero migration burden.** Every config document that validated against
  `gatewayConfigSchema` before EM-6 still validates, byte-for-byte,
  after it — verified directly by
  `packages/config/test/schema.test.ts`'s "omitted" case.
- **No new dependency edge.** `.dependency-cruiser.cjs`'s `DEPENDENCY_TABLE`
  needs no change for this ADR specifically: `config`'s entry already
  permits none of its own dependents to be re-imported (it had none to
  begin with), and this decision keeps it that way.
- **A follow-on obligation for `strategy-layer` (EM-8).** Whoever builds
  the actual composition root that constructs a `DefaultRuntimeProfileRegistry`
  is responsible for threading `GatewayConfig.runtimeProfileId` through to
  it as `deploymentDefaultProfileId`. Nothing in EM-6 does this wiring —
  consistent with EM-6's explicit "do not wire into the Orchestrator yet"
  scope.
- **Future changes to `GatewayConfig` continue to require this same ADR
  discipline** — this ADR does not relax that rule, it exercises it.

## Alternatives considered

- **A separate `RuntimeProfileConfig` type/config file, outside
  `GatewayConfig`.** Rejected: contradicts architecture §37.4's explicit
  text, which names `GatewayConfig` itself as the extension point, not a
  new sibling config surface — and a new config surface would be exactly
  the kind of unnecessary new abstraction the refinement instructs against
  introducing.
- **Type `runtimeProfileId` as `RuntimeProfileId` (the real union), and add
  `runtime-profiles` as a `config` dependency.** Rejected: creates the
  dependency cycle described in Context — `runtime-profiles` already
  depends on `config`.
- **A `Record<tenantKey, RuntimeProfileId>` map directly inside
  `GatewayConfig`**, mirroring `routing.perTaskOverrides`' per-key shape.
  Rejected as over-scoping this change: architecture §37.4 describes a
  single field, and per-tenant assignment is already served by
  `runtime-profiles`' own `setTenantRuntimeProfile`/`TenantAssignmentStore`
  (admin-API-writable, per §37.4's own wording) — duplicating that
  concern inside `GatewayConfig` would be two sources of truth for the
  same fact.
