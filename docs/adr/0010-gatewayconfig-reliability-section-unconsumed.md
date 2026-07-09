# ADR-0010: `GatewayConfig.reliability` is unconsumed by any package

**Status:** Proposed (ADR candidate — raised during EM-5 implementation, not yet decided)
**Date:** 2026-07-08
**Format:** Context / Decision / Consequences / Alternatives

> **Note on this draft:** Not an `apps/gateway-server` defect, and not a
> defect in any frozen EM-0–EM-4 package either — every package behaves
> exactly as its own tests and README already document. This ADR exists
> because EM-5's composition root (`bootstrap.ts`) is the first place in
> the codebase where _every_ package is wired together at once, which is
> what makes this gap externally visible for the first time: a section of
> a frozen, Zod-validated, publicly-documented config type
> (`GatewayConfig.reliability`) that no package anywhere reads. Per this
> milestone's "if implementation reveals an architectural inconsistency,
> document it as an ADR candidate — do not redesign the architecture"
> instruction, this document only describes the gap and lists options; it
> does not change `@ai-gateway/config`'s schema, `policy-engine`, or
> `reliability`.

## Context

`GatewayConfig.reliability` (architecture §10.6, `@ai-gateway/config`,
frozen at EM-1) declares three fields:

```ts
reliability: {
  maxRetries: number;
  backoff: "exponential" | "linear";
  circuitBreakerThreshold: number;
}
```

Tracing every read of this section across the EM-0–EM-4 baseline:

- `policy-engine`'s `DefaultPolicyEngine.selectExecutionPlan` assigns
  `retryPolicy: DEFAULT_RETRY_POLICY` unconditionally on every
  `ExecutionPlan` it builds (`policy-engine.ts`) — `maxRetries` and
  `backoff` are never read from any `GatewayConfig` instance anywhere in
  this call path, or anywhere else in the repository.
- No package — `reliability`, `policy-engine`, `orchestrator`,
  `middleware`, or (until this milestone) `apps/gateway-server` — reads
  `circuitBreakerThreshold` at all.
- `reliability`'s own `CircuitBreaker` interface has a structurally
  different tunable: `CircuitBreakerOptions.failureRateThreshold`, a
  `0..1` rolling failure _rate_ over a `rollingWindowSize` (default `20`),
  defaulting to `0.5`. `circuitBreakerThreshold`'s declared type
  (`z.number().int().positive()`, default `5`) reads like an absolute
  failure _count_, not a rate — but neither `@ai-gateway/config`'s schema
  comments nor architecture §10.6/§18.2 states the intended relationship
  between the two, and no test anywhere in the repository exercises one
  being derived from the other.

This was not caught by the EM-1 (config), EM-2 (reliability), EM-3
(policy-engine), or EM-4 (orchestrator/middleware) reviews individually,
because each of those packages is fully correct and fully tested _in
isolation_ against its own frozen interface — `policy-engine` correctly
implements `PolicyEngine.selectExecutionPlan`'s contract using
`DEFAULT_RETRY_POLICY` as a documented default, and `reliability`
correctly implements `CircuitBreaker` against its own
`CircuitBreakerOptions`. The gap only exists in the space between them:
nothing was ever built whose job is to read `GatewayConfig.reliability`
and turn it into the options either of those two packages actually
accepts. `apps/gateway-server`'s composition root is the first and only
place such wiring could occur — and is the reason this gap becomes
visible now rather than at any earlier milestone.

## Decision

For EM-5's v1.0 MVP, `apps/gateway-server/src/bootstrap.ts` does **not**
attempt to derive `InMemoryCircuitBreaker`'s or `DefaultRetryEngine`'s
options from `GatewayConfig.reliability`. Both are constructed with their
own shipped defaults (`DEFAULT_CIRCUIT_BREAKER_OPTIONS`,
`DEFAULT_RETRY_POLICY`), applied automatically when no override is
passed to either constructor. `GatewayConfig.reliability.maxRetries`,
`.backoff`, and `.circuitBreakerThreshold` continue to be loaded,
schema-validated, and exposed on the running `GatewayApp.gatewayConfig`
bundle — a future operator/config value is not silently discarded, it is
simply not yet connected to anything — but no numeric guess is smuggled
into a real deployment's retry/circuit-breaker behavior on this
milestone's authority.

## Consequences

- A `GatewayConfig.reliability` value an operator sets today (e.g. a
  higher `maxRetries` for a latency-tolerant deployment) has **no
  effect** on the running v1.0 MVP. This should be called out plainly in
  release notes / operator-facing documentation for v1.0, not left to be
  discovered in production.
- `policy-engine`'s `DEFAULT_RETRY_POLICY` and `reliability`'s
  `DEFAULT_CIRCUIT_BREAKER_OPTIONS` are the _de facto_ production values
  for v1.0, regardless of what an operator's `GatewayConfig` file says.
- Resolving this ADR (whichever direction the Board picks, see below)
  will very likely require touching `policy-engine` (to accept a
  `RetryPolicy` derived from config rather than hardcoding
  `DEFAULT_RETRY_POLICY`) and/or `@ai-gateway/config`'s schema (to
  either clarify or restructure `circuitBreakerThreshold`) — both frozen
  packages. That work is out of EM-5's scope by this milestone's own
  rules ("never modify... EM-1... EM-3") and is flagged here precisely so
  it is not attempted piecemeal inside this milestone's composition root.
- This is the third open, config-adjacent ADR (after ADR-0006's
  `policy-engine`/`routing.perTaskOverrides` scoring-weights gap and
  ADR-0009's `middleware` auth/rate-limit/cache gap) that traces back to
  the same underlying question: how does `GatewayConfig` grow a section
  that a package downstream actually reads and acts on, once that
  package is frozen? The EM-4 Architecture & Engineering Review already
  recommended (Optional Improvements) consolidating ADR-0006/0007/0009
  into one Board decision; this ADR should be folded into that same
  consolidated decision rather than resolved independently.

## Alternatives considered

- **Guess a mapping (e.g. `failureRateThreshold = circuitBreakerThreshold / rollingWindowSize`) and wire it anyway.** Rejected: nothing in the architecture spec, the Engineering Blueprint, or `@ai-gateway/config`'s own schema comments confirms this is the intended relationship. Shipping a guessed formula as if it were a specified one would misconfigure the circuit breaker in a real deployment with no way for an operator to detect the mismatch from `GatewayConfig` alone — the exact "silent configuration failure" this milestone's own instructions rule out, only one layer further from the HTTP boundary than the `server-config.ts` cases those instructions were written for.
- **Extend `policy-engine` to read `maxRetries`/`backoff` from an injected `GatewayConfig`.** Rejected for EM-5: `policy-engine` is a frozen EM-3 package; changing its constructor/behavior is exactly the kind of frozen-artifact modification this milestone's rules forbid, however small the change.
- **Remove `GatewayConfig.reliability` entirely, since nothing reads it.** Rejected for the same reason — `@ai-gateway/config` is a frozen EM-1 package, and removing a field is still a schema change requiring the same ADR discipline architecture §28/§39/§46 already requires for any change to a document named in Blueprint §6.1's "must be frozen before implementation" list.
- **Leave the gap completely undocumented and let `bootstrap.ts` quietly wire only the pieces that have an obvious source.** Rejected: this is precisely the kind of gap this milestone's own instructions ask to be surfaced as an ADR candidate rather than silently absorbed.
