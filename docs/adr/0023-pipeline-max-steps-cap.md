# ADR-0023: Pipelines Enforce a Mandatory, Platform-Configured `maxSteps` Cap

**Status:** Accepted (ratifies architecture §46's ADR-014 verbatim; see ADR-0021 for why this repository number, not "0014")
**Date:** 2026-07-17
**Format:** Context / Decision / Consequences / Alternatives

> Ratified from architecture §46's ADR-014 without modification — see
> ADR-0021 for why this is filed under this repository's own next number
> rather than "0014" (already used, on an unrelated topic, since EM-7).

## Context

Section 45.3 identified that an unbounded `ExecutionPipeline` (architecture
§41.2) lets a single API call amplify into unbounded per-step
orchestration and provider-call load, effectively an accidental
load-test vector with no application-level throttle.

## Decision

`maxSteps` becomes a mandatory, platform-configured hard cap enforced at
the API layer (`/v1/execute/pipeline`, architecture §10.2/§41.3) before
any step executes — a pipeline exceeding it is rejected with a typed
`GatewayError` (`INVALID_TASK`-class, non-retryable) rather than partially
executing.

## Consequences

A rare legitimate long pipeline must be split by the caller into multiple
pipeline calls; the common case (a handful of steps, per architecture
§41's own worked examples) is entirely unaffected.

**Honored by EM-10's implementation:**

- `@ai-gateway/pipeline-orchestrator`'s `DefaultPipelineOrchestrator`
  checks `pipeline.steps.length > this.maxSteps` as the very first thing
  `executePipeline` does — before `orchestrator.execute()` is called for
  any step — and throws `GatewayError("INVALID_TASK", ...)` (non-retryable)
  on violation. Tested directly (`pipeline-orchestrator`'s own test
  suite: rejected over the limit with zero steps executed, allowed
  exactly at the limit).
- `maxSteps` defaults to `20` (this ADR's own "e.g., 20") and is
  platform-configured at `gateway-runtime`'s `bootstrap()` (`GatewayRuntimeConfig.maxPipelineSteps`),
  not per-pipeline-request — matching "mandatory, platform-configured,"
  not a per-caller opt-out.
- The `/v1/execute/pipeline` route (`gateway-runtime`) surfaces this
  rejection as a normal `400`-class HTTP error (via the existing
  `GatewayErrorCode` → HTTP status mapping, `INVALID_TASK` → 400) — tested
  end-to-end.

## Alternatives considered

No cap, relying on the existing per-tenant rate limiter (architecture
§20.4) to catch runaway usage indirectly — rejected because rate limiting
operates on request *count*, not on the amplification factor a single
oversized pipeline request represents.
