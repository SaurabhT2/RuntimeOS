# ADR-0017: `GatewayConfig` gains an optional `enableStrategyLayer` field

**Status:** Accepted (implemented as of EM-8)
**Date:** 2026-07-13
**Format:** Context / Decision / Consequences / Alternatives

## Context

EM-8's work order requires the entire Strategy Layer to run behind a feature flag
(`ENABLE_STRATEGY_LAYER`), disabled by default, so that a deployment can adopt it (or roll
it back) "immediately... without code changes" (EM-8's own Architecture Review Board
acceptance criterion). `@ai-gateway/config`'s `GatewayConfig` (architecture §10.6) is
already this codebase's one deployment-level configuration surface — every other
runtime-behavior toggle in this codebase (routing strategy, reliability thresholds, the
active Runtime Profile per ADR-0013) lives there, loaded once at startup via a single
`ConfigSource` (env-var JSON blob or file), not via a scatter of individually-named
process environment variables.

## Decision

Add an optional `enableStrategyLayer?: boolean` field to `GatewayConfig`, defaulting to
`false` in `DEFAULT_GATEWAY_CONFIG` — the same additive, optional-field pattern ADR-0013
used for `runtimeProfileId`. A deployment turns the Strategy Layer on by setting
`{"enableStrategyLayer": true, ...}` in its config JSON (env var or file), exactly like
every other `GatewayConfig` field.

The literal `ENABLE_STRATEGY_LAYER` environment variable name from the work order is
additionally honored at the `apps/gateway-server` composition layer: that app's own
runtime config loader (which already reads process-level env vars for host/port/etc.,
outside `GatewayConfig`'s own JSON-blob model) reads `process.env.ENABLE_STRATEGY_LAYER`
and passes it to `@ai-gateway/gateway-runtime`'s `bootstrap()` as an explicit override
(`GatewayRuntimeConfig.enableStrategyLayer`), mirroring `credentialPriority`'s existing
override-if-supplied pattern in `bootstrap()`. When the override is present, it wins over
`GatewayConfig.enableStrategyLayer`; when absent, the `GatewayConfig` value (default
`false`) governs. This gives the literal environment-variable ergonomics the work order
names, without introducing a second, parallel per-field configuration-loading mechanism
alongside `config`'s existing single-JSON-document model.

## Consequences

- Rollback is immediate and requires no code change: flipping either the env var or the
  config JSON's `enableStrategyLayer` field back to `false`/absent restores EM-7 behavior
  (architecture §13.5/§30 unwired; `orchestrator` calls `policy-engine` directly, exactly
  as before this milestone) — satisfying EM-8's "Feature flag rollback is immediate"
  acceptance criterion.
- `gatewayConfigSchema` validates the new field as an optional boolean; every existing
  `GatewayConfig` document (with the field absent) continues to validate unchanged.
- Unlike ADR-0006/0009/0010's "config field with no immediate consumer" pattern, this
  field has an immediate, concrete consumer as of this same milestone: `bootstrap()`
  reads it to decide whether to construct an `AIStrategyLayer` instance and wire it into
  the `DefaultExecutionOrchestrator`.

## Alternatives considered

**A dedicated `StrategyLayerConfig` sub-object** (mirroring `routing`/`reliability`'s
nested-object shape) was considered and rejected as premature: this milestone has exactly
one strategy-layer-related toggle (on/off). A single boolean field, not a nested object,
is the minimal change that satisfies this milestone's actual requirement; a richer
sub-object (e.g., per-stage enable/disable) can be introduced additively later if a real
need for one arises — matching this milestone's own "No feature flags prematurely"
sibling constraint (EM-7's, still in force) applied to _this_ flag's own internal shape,
not just to whether the flag exists at all.
