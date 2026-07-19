import type { CacheClient, CacheKeyStrategy, CachedResult } from "./types.js";

/**
 * A minimal in-memory `CacheClient` (architecture §33.2: "read-only lookup
 * handle"). Not a production cache backend — same rationale and Deferred
 * Work note as every other in-memory store in this codebase (e.g.
 * `middleware`'s `CacheMiddleware`, this package's own sibling packages'
 * `InMemory*Store`s): useful for tests, demos, and single-process
 * deployments; a real deployment injects a Redis-/DB-backed implementation
 * of the same `CacheClient` interface instead (Principle P4).
 *
 * `strategy` is accepted (per the `CacheClient` interface) but not used to
 * change lookup behavior here — this store keys purely by the exact string
 * passed in, since it has no semantic-similarity index to fall back to for
 * `"semantic"`. A real semantic-cache-backed implementation would use
 * `strategy` to choose between an exact key match and a similarity search.
 */
export class InMemoryCacheClient implements CacheClient {
  private readonly entries = new Map<string, CachedResult>();

  async lookup(key: string, _strategy: CacheKeyStrategy): Promise<CachedResult | undefined> {
    return this.entries.get(key);
  }

  /** Test/demo seam — not part of the `CacheClient` interface itself, which is read-only by design. */
  seed(key: string, result: CachedResult): void {
    this.entries.set(key, result);
  }
}
