/**
 * TTL-cached read layer with invalidation-event fan-out — field-for-field
 * identical to `@ai-gateway/model-registry`'s `TtlCache` (architecture
 * §31.2: "same cache/invalidation infrastructure reused a third time").
 *
 * Duplicated here rather than imported: this package's frozen dependency
 * edge (Blueprint §4.1) is `config`, `core-contracts` only — it must never
 * depend on `model-registry` (a genuine, if incidental, cycle risk: nothing
 * upstream of `model-registry` should depend on it just to borrow a
 * generic cache primitive). This is the same "duplicate rather than
 * introduce a disallowed edge" precedent already established in this
 * codebase — see `@ai-gateway/reliability`'s `ProviderHealthSnapshot`,
 * which duplicates a shape from `provider-sdk` for the identical reason
 * (see that package's `src/types.ts` file docs). `@ai-gateway/capability-registry`,
 * by contrast, *does* declare a dependency edge onto `model-registry`
 * (architecture §32's own table), so it imports the real `TtlCache` class
 * directly instead of duplicating it — see that package's `src/registry.ts`.
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
