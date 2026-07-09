/**
 * @ai-gateway/reliability
 *
 * Retry Engine, Circuit Breaker, Timeout Manager, Health Monitor
 * (architecture §18).
 *
 * STATUS: implemented (Engineering Milestone EM-2, Blueprint §7, §8.5).
 *
 * Architecture reference: §18
 */

export {
  BACKOFF_STRATEGIES,
  type BackoffStrategy,
  type RetryPolicy,
  DEFAULT_RETRY_POLICY,
  type ProviderHealthSnapshot,
  type FailureReason,
  CIRCUIT_STATES,
  type CircuitState,
  type CircuitBreakerOptions,
  DEFAULT_CIRCUIT_BREAKER_OPTIONS,
  providerModelClassKey,
} from "./types.js";

export { computeBackoffMs, defaultJitterSource, type JitterSource } from "./backoff-policies.js";

export { type RetryEngine, DefaultRetryEngine, type RetryEngineOptions } from "./retry-engine.js";

export { type CircuitBreaker, InMemoryCircuitBreaker } from "./circuit-breaker.js";

export { type TimeoutManager, DefaultTimeoutManager } from "./timeout-manager.js";

export {
  type HealthMonitor,
  type HealthStateStore,
  InMemoryHealthStateStore,
  DefaultHealthMonitor,
  type DefaultHealthMonitorOptions,
} from "./health-monitor.js";
