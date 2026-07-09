/**
 * Circuit Breaker (architecture §18.2): per `(providerId, modelClass)` key,
 * tracks a rolling failure rate and opens the circuit once it crosses a
 * threshold, so a struggling provider stops receiving wasted calls until it
 * has had time to recover.
 *
 * State machine (architecture §18.2):
 *
 * ```
 * Closed --[failure_rate > threshold]--> Open
 * Open --[cooldown elapsed]--> HalfOpen
 * HalfOpen --[probe succeeds]--> Closed
 * HalfOpen --[probe fails]--> Open
 * ```
 */

import {
  type CircuitBreakerOptions,
  type CircuitState,
  DEFAULT_CIRCUIT_BREAKER_OPTIONS,
} from "./types.js";

/**
 * architecture §11 names `RetryEngine` and `HealthMonitor` explicitly but
 * does not spell out a `CircuitBreaker` interface shape — Blueprint §8.5
 * names the *file* (`circuit-breaker.ts`) and behavior (§18.2's state
 * diagram) without a method signature. This interface is therefore
 * designed, not specified, following the same minimal-surface convention as
 * every other interface in this codebase (Blueprint §12: "a new interface
 * with more than 3-4 methods is a signal to reconsider its scope").
 */
export interface CircuitBreaker {
  /** Records a successful call against `key` (e.g. `providerModelClassKey(...)`). */
  recordSuccess(key: string): void;
  /** Records a failed call against `key`. */
  recordFailure(key: string): void;
  /** Current state for `key`. A key never seen before is `"closed"` (fail-open by default). */
  getState(key: string): CircuitState;
  /**
   * Whether a new call against `key` should be attempted right now.
   * `false` for `"open"`; `true` for `"closed"`; `true` for exactly one
   * caller's worth of `"half_open"` probing (architecture §18.2's single
   * probe request) — see class docs for the single-probe admission rule.
   */
  canProceed(key: string): boolean;
}

interface KeyState {
  state: CircuitState;
  /** Rolling window of recent outcomes, oldest first, capped at `rollingWindowSize`. */
  outcomes: boolean[]; // true = success, false = failure
  /** Timestamp (ms since epoch) the breaker opened, used to compute cooldown elapsed. */
  openedAt?: number;
  /** Whether a `half_open` probe has already been admitted and not yet resolved. */
  probeInFlight: boolean;
}

function newKeyState(): KeyState {
  return { state: "closed", outcomes: [], probeInFlight: false };
}

/**
 * In-process implementation. architecture §23.1 notes cross-instance health
 * state is expected to live behind a shared Redis store in a multi-instance
 * deployment; this implementation is intentionally an in-process
 * `Map`-backed store rather than a hidden ad-hoc cache (Blueprint §13.7)
 * because no real Redis client/connection exists anywhere in this repo yet
 * — `apps/gateway-server`'s composition root (Blueprint §6.4), where such a
 * client would be constructed and injected, is EM-5 scope. A future
 * Redis-backed `CircuitBreaker` is a second implementation of this same
 * interface, not a redesign of it (Blueprint §13.5's over-abstraction test
 * is satisfied: a second real implementation is a named future goal, not a
 * hypothetical one).
 */
export class InMemoryCircuitBreaker implements CircuitBreaker {
  private readonly keys = new Map<string, KeyState>();
  private readonly options: CircuitBreakerOptions;
  private readonly now: () => number;

  constructor(options: Partial<CircuitBreakerOptions> = {}, now: () => number = Date.now) {
    this.options = { ...DEFAULT_CIRCUIT_BREAKER_OPTIONS, ...options };
    this.now = now;
  }

  recordSuccess(key: string): void {
    const ks = this.getOrCreate(key);
    this.pushOutcome(ks, true);

    if (ks.state === "half_open") {
      // Probe succeeded: HalfOpen -> Closed (architecture §18.2).
      ks.state = "closed";
      ks.probeInFlight = false;
      ks.outcomes = [];
      delete ks.openedAt;
      return;
    }

    if (ks.state === "closed" && this.shouldTrip(ks)) {
      ks.state = "open";
      ks.openedAt = this.now();
    }
  }

  recordFailure(key: string): void {
    const ks = this.getOrCreate(key);
    this.pushOutcome(ks, false);

    if (ks.state === "half_open") {
      // Probe failed: HalfOpen -> Open (architecture §18.2), fresh cooldown.
      ks.state = "open";
      ks.probeInFlight = false;
      ks.openedAt = this.now();
      return;
    }

    if (ks.state === "closed" && this.shouldTrip(ks)) {
      ks.state = "open";
      ks.openedAt = this.now();
    }
  }

  getState(key: string): CircuitState {
    return this.resolveTransition(this.getOrCreate(key));
  }

  canProceed(key: string): boolean {
    const ks = this.getOrCreate(key);
    const state = this.resolveTransition(ks);

    if (state === "closed") {
      return true;
    }
    if (state === "open") {
      return false;
    }
    // half_open: admit exactly one probe at a time (architecture §18.2 "a
    // probe request" — singular). Concurrent callers after the first are
    // treated as if the breaker were still open, so a recovering provider
    // isn't immediately hit with a burst the moment cooldown elapses.
    if (ks.probeInFlight) {
      return false;
    }
    ks.probeInFlight = true;
    return true;
  }

  private getOrCreate(key: string): KeyState {
    let ks = this.keys.get(key);
    if (!ks) {
      ks = newKeyState();
      this.keys.set(key, ks);
    }
    return ks;
  }

  /** Applies the time-based `Open -> HalfOpen` transition, if due, and returns the current state. */
  private resolveTransition(ks: KeyState): CircuitState {
    if (ks.state === "open" && ks.openedAt !== undefined) {
      const elapsed = this.now() - ks.openedAt;
      if (elapsed >= this.options.cooldownMs) {
        ks.state = "half_open";
        ks.probeInFlight = false;
      }
    }
    return ks.state;
  }

  private pushOutcome(ks: KeyState, success: boolean): void {
    ks.outcomes.push(success);
    if (ks.outcomes.length > this.options.rollingWindowSize) {
      ks.outcomes.shift();
    }
  }

  private shouldTrip(ks: KeyState): boolean {
    if (ks.outcomes.length < this.options.minimumRequests) {
      return false;
    }
    const failures = ks.outcomes.filter((ok) => !ok).length;
    const failureRate = failures / ks.outcomes.length;
    return failureRate > this.options.failureRateThreshold;
  }
}
