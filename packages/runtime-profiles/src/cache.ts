/**
 * TTL-cached read layer with invalidation-event fan-out — field-for-field
 * identical to `@ai-gateway/model-registry`'s `TtlCache` and
 * `@ai-gateway/execution-profile-registry`'s local copy of the same
 * (architecture §37.2's design intent, extending §31.2's "same
 * cache/invalidation infrastructure reused" pattern to a fourth package).
 *
 * Duplicated here rather than imported: this package's frozen dependency
 * edge (Blueprint §4.1) is `config` only — it must never depend on
 * `model-registry` or `execution-profile-registry` just to borrow a
 * generic cache primitive. This is the same "duplicate rather than
 * introduce a disallowed edge" precedent already established in this
 * codebase — see `@ai-gateway/reliability`'s `ProviderHealthSnapshot` and
 * `@ai-gateway/execution-profile-registry`'s own `cache.ts` doc comment.
 */

export interface TtlCacheOptions {
  ttlMs: number;
  now?: () => number;
}

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

  onInvalidate(listener: (key: string | null) => void): () => void {
    this.invalidationListeners.add(listener);
    return () => this.invalidationListeners.delete(listener);
  }
}
