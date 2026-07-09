/**
 * TTL-cached read layer with invalidation-event fan-out (architecture
 * §14.2: "cached in-memory per gateway instance with a short TTL +
 * invalidation event (published over the same shared Redis used for
 * health/rate-limit state)").
 *
 * The Redis pub/sub transport itself is not implemented here: no Redis
 * client exists anywhere in this repo yet (that wiring belongs to
 * `apps/gateway-server`'s composition root, Blueprint §6.4, EM-5 scope —
 * the same deferral already established for `reliability`'s
 * `HealthStateStore` and this package's own `ModelStore`). What *is*
 * implemented is the in-process half of the mechanism — a TTL cache plus a
 * subscribable invalidation event — so that swapping in a real Redis
 * publisher/subscriber later is purely additive: whoever constructs the
 * real pub/sub client calls this cache's `invalidate()` when a remote
 * event arrives, and passes this cache's own `onInvalidate` a callback that
 * publishes to Redis when a local write happens. No change to
 * `ModelRegistry` or its callers would be required.
 */

export interface TtlCacheOptions {
  ttlMs: number;
  now?: () => number;
}

/**
 * A minimal single-entry-per-key TTL cache with a subscribable invalidation
 * event. Deliberately generic over `T` (used here for `ModelDescriptor[]`
 * query results) rather than baked into `ModelRegistry` directly, so the
 * TTL/invalidation behavior itself is unit-testable in isolation from
 * registry query semantics (see `test/cache.test.ts`).
 */
export class TtlCache<T> {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();
  private readonly invalidationListeners = new Set<(key: string | null) => void>();

  constructor(options: TtlCacheOptions) {
    this.ttlMs = options.ttlMs;
    this.now = options.now ?? Date.now;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (this.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  /**
   * Invalidates one key, or every key when called with no argument (used
   * after a write whose effect on cached query results can't be narrowed
   * to a single key — see `ModelRegistry.upsertModel`/`.deleteModel`).
   * Notifies subscribers either way, so a Redis-backed publisher (future
   * work, see file docs) can fan this out to other gateway instances.
   */
  invalidate(key?: string): void {
    if (key === undefined) {
      this.entries.clear();
    } else {
      this.entries.delete(key);
    }
    for (const listener of this.invalidationListeners) {
      listener(key ?? null);
    }
  }

  /** Subscribes to invalidation events. Returns an unsubscribe function. */
  onInvalidate(listener: (key: string | null) => void): () => void {
    this.invalidationListeners.add(listener);
    return () => this.invalidationListeners.delete(listener);
  }
}
