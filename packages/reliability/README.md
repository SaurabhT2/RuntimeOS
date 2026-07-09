# @ai-gateway/reliability

**Status:** implemented (EM-2). Retry Engine, Circuit Breaker, Timeout
Manager, Health Monitor (architecture §18; Blueprint §8.5).

## Public API

- `RetryEngine.execute(fn, policy)` — retries `fn` up to `policy.maxAttempts`
  times, waiting `computeBackoffMs(...)` between attempts, only for errors
  whose `GatewayErrorCode` is in `policy.retryableErrorCodes` (architecture
  §11, §18.1, verbatim). `DefaultRetryEngine` is the shipped implementation.
- `computeBackoffMs(attempt, policy, jitterSource?)` — pure backoff
  calculation for `"exponential" | "linear" | "none"` (architecture §18.1),
  with optional full-jitter.
- `CircuitBreaker` — `recordSuccess`/`recordFailure`/`getState`/`canProceed`,
  keyed by `providerModelClassKey(providerId, modelClass)` (architecture
  §18.2's `(providerId, modelClass)` keying). `InMemoryCircuitBreaker` is the
  shipped implementation of the `Closed -> Open -> HalfOpen -> Closed/Open`
  state machine, including single-probe admission during `HalfOpen`.
- `TimeoutManager.withTimeout(work, timeoutMs)` — races `work` against a
  deadline, rejecting with `GatewayError("TIMEOUT", ...)` if it fires first.
  See the in-code cancellation caveat: this stops _waiting_, not the
  underlying work — that gap is tracked by
  [ADR-0004](../../docs/adr/0004-provider-adapter-cancellation-draft.md).
- `HealthMonitor` — `reportSuccess`/`reportFailure`/`getHealth`/
  `getHealthiestAlternative` (architecture §11, verbatim). `DefaultHealthMonitor`
  is the shipped implementation, backed by a swappable `HealthStateStore`
  (`InMemoryHealthStateStore` ships now; a Redis-backed store for
  cross-instance visibility, architecture §23.1, is future work — see
  Engineering Decisions in the EM-2 summary).

## Design notes

- `ProviderHealthSnapshot` is duplicated here rather than imported from
  `@ai-gateway/provider-sdk`, matching that package's own precedent for
  `CredentialScope`/`ScopedCredential`: `reliability`'s frozen dependency
  edge (Blueprint §4.1) does not include `providers/provider-sdk`.
- `BackoffStrategy` here is the full architecture §18.1 set
  (`"exponential" | "linear" | "none"`), which is _not_ the same set as
  `@ai-gateway/config`'s `BackoffStrategy` (`"exponential" | "linear"` only).
  This mismatch pre-dates EM-2 and is not resolved by it — see
  [ADR-0005](../../docs/adr/0005-backoff-strategy-config-mismatch.md).
- `CircuitBreaker` and `TimeoutManager` are not named as interfaces in
  architecture §11 (only `RetryEngine`/`HealthMonitor` are) — their shapes
  are designed here, following the same minimal-surface convention as every
  other interface in this codebase.

## Usage example

```ts
import {
  DefaultRetryEngine,
  DEFAULT_RETRY_POLICY,
  InMemoryCircuitBreaker,
  providerModelClassKey,
  DefaultHealthMonitor,
} from "@ai-gateway/reliability";

const retryEngine = new DefaultRetryEngine();
const breaker = new InMemoryCircuitBreaker();
const health = new DefaultHealthMonitor();

const key = providerModelClassKey("groq", "fast-extraction");

if (breaker.canProceed(key)) {
  try {
    const result = await retryEngine.execute(() => callProvider(), DEFAULT_RETRY_POLICY);
    breaker.recordSuccess(key);
    health.reportSuccess("groq", { latencyMs: 120 });
  } catch (error) {
    breaker.recordFailure(key);
    health.reportFailure("groq", { code: "TIMEOUT" });
    throw error;
  }
}
```

## Dependencies

- `@ai-gateway/core-contracts`
- `@ai-gateway/config`
- `@ai-gateway/telemetry`

## Architecture reference

§18

## Testing strategy

Property-based tests (`fast-check`) generate failure/success sequences and
policy parameter combinations, asserting `DefaultRetryEngine` produces
exactly the retry count and backoff timing the policy dictates
(architecture §24's "Reliability (Retry/CB/Timeout)" row). Circuit breaker
state-transition tests exercise every edge in the §18.2 state diagram,
including the single-probe admission rule during `HalfOpen`. Health monitor
tests cover consecutive-failure-driven health flips and
`getHealthiestAlternative`'s exclusion/ranking behavior.
