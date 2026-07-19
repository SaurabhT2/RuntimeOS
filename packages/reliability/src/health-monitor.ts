/**
 * Health Monitor (architecture §11, verbatim interface; §18.2/§18.3 for how
 * it's consulted during failover-plan assembly).
 */

import type { TaskType } from "@ai-gateway/core-contracts";
import type { FailureReason, ProviderHealthSnapshot } from "./types.js";

/** architecture §11, verbatim. */
export interface HealthMonitor {
  reportSuccess(providerId: string, meta: { latencyMs: number }): void;
  reportFailure(providerId: string, reason: FailureReason): void;
  getHealth(providerId: string): ProviderHealthSnapshot;
  getHealthiestAlternative(task: TaskType, exclude: string[]): Promise<string | null>;
}

/**
 * Backing store for per-provider health state. Split out as its own
 * interface (rather than folding storage into `HealthMonitor` itself) for
 * the same reason `CircuitBreaker`'s state lives behind a swappable
 * implementation: architecture §23.1 expects this state behind a shared
 * Redis store in a multi-instance deployment, and no real Redis client
 * exists anywhere in this repo yet (that wiring is `apps/gateway-server`'s
 * composition-root job, Blueprint §6.4, EM-5 scope). Keeping state behind
 * this named, documented interface — rather than a module-level `Map` — is
 * what satisfies Blueprint §13.7's "hidden state" guidance even though the
 * only implementation shipped in EM-2 is in-process.
 */
export interface HealthStateStore {
  get(providerId: string): ProviderHealthSnapshot | undefined;
  set(providerId: string, snapshot: ProviderHealthSnapshot): void;
  /** All provider IDs with any recorded state, for `getHealthiestAlternative`'s candidate scan. */
  keys(): string[];
}

export class InMemoryHealthStateStore implements HealthStateStore {
  private readonly snapshots = new Map<string, ProviderHealthSnapshot>();

  get(providerId: string): ProviderHealthSnapshot | undefined {
    return this.snapshots.get(providerId);
  }

  set(providerId: string, snapshot: ProviderHealthSnapshot): void {
    this.snapshots.set(providerId, snapshot);
  }

  keys(): string[] {
    return [...this.snapshots.keys()];
  }
}

function freshSnapshot(providerId: string): ProviderHealthSnapshot {
  return {
    providerId,
    healthy: true,
    lastCheckedAt: new Date().toISOString(),
    consecutiveFailures: 0,
  };
}

export interface DefaultHealthMonitorOptions {
  store?: HealthStateStore;
  now?: () => Date;
  /**
   * Consecutive failures at or above this count flip `healthy` to `false`
   * (architecture §18.2 doesn't specify this number for `HealthMonitor`
   * directly — that's the Circuit Breaker's own, separate rolling-rate
   * threshold — so a small, documented default is used here: three
   * consecutive failures is enough to distinguish "one blip" from "actually
   * struggling" without being as slow to react as the Circuit Breaker's
   * 20-request rolling window).
   */
  unhealthyAfterConsecutiveFailures?: number;
}

/**
 * Default `HealthMonitor`. Note this is a *separate* signal from
 * `CircuitBreaker` — a provider can be `healthy: false` here (this
 * provider's last few calls failed) while its circuit is still `"closed"`
 * (the rolling failure *rate* hasn't crossed the trip threshold yet), and
 * vice versa. `getHealthiestAlternative` only consults this monitor's own
 * state; combining it with Circuit Breaker state to exclude open-circuit
 * candidates is the Policy Engine's job (Wave 3, architecture §13.2), not
 * this package's.
 */
export class DefaultHealthMonitor implements HealthMonitor {
  private readonly store: HealthStateStore;
  private readonly now: () => Date;
  private readonly unhealthyAfterConsecutiveFailures: number;

  constructor(options: DefaultHealthMonitorOptions = {}) {
    this.store = options.store ?? new InMemoryHealthStateStore();
    this.now = options.now ?? (() => new Date());
    this.unhealthyAfterConsecutiveFailures = options.unhealthyAfterConsecutiveFailures ?? 3;
  }

  reportSuccess(providerId: string, meta: { latencyMs: number }): void {
    this.store.set(providerId, {
      providerId,
      healthy: true,
      latencyMs: meta.latencyMs,
      lastCheckedAt: this.now().toISOString(),
      consecutiveFailures: 0,
    });
  }

  reportFailure(providerId: string, reason: FailureReason): void {
    const previous = this.store.get(providerId) ?? freshSnapshot(providerId);
    const consecutiveFailures = previous.consecutiveFailures + 1;
    this.store.set(providerId, {
      providerId,
      healthy: consecutiveFailures < this.unhealthyAfterConsecutiveFailures,
      lastCheckedAt: this.now().toISOString(),
      consecutiveFailures,
      message: reason.message ?? reason.code,
    });
  }

  getHealth(providerId: string): ProviderHealthSnapshot {
    return this.store.get(providerId) ?? freshSnapshot(providerId);
  }

  async getHealthiestAlternative(_task: TaskType, exclude: string[]): Promise<string | null> {
    // architecture §11 takes a `task: TaskType` parameter, presumably so a
    // future implementation could weight "healthiest" per task-appropriate
    // model class (e.g. a provider might be struggling only for its
    // reasoning-tier models). No such per-task health data exists yet in
    // EM-2 — `HealthStateStore` is keyed by `providerId` alone — so `task`
    // is accepted (frozen-signature compatibility, per §11) but not yet
    // consulted. This is a forward question for whichever milestone adds
    // per-task-class health tracking, not a defect: nothing in
    // architecture §18 requires per-task granularity from `HealthMonitor`
    // specifically (that granularity is the Circuit Breaker's job, which
    // is already keyed by `(providerId, modelClass)`).
    const excluded = new Set(exclude);
    let best: { providerId: string; snapshot: ProviderHealthSnapshot } | null = null;

    for (const providerId of this.store.keys()) {
      if (excluded.has(providerId)) {
        continue;
      }
      const snapshot = this.store.get(providerId);
      if (!snapshot || !snapshot.healthy) {
        continue;
      }
      if (
        !best ||
        snapshot.consecutiveFailures < best.snapshot.consecutiveFailures ||
        (snapshot.consecutiveFailures === best.snapshot.consecutiveFailures &&
          (snapshot.latencyMs ?? Number.POSITIVE_INFINITY) <
            (best.snapshot.latencyMs ?? Number.POSITIVE_INFINITY))
      ) {
        best = { providerId, snapshot };
      }
    }

    return best?.providerId ?? null;
  }
}
