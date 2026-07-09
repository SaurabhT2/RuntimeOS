import type { ModelDescriptor, ModelQuery } from "./model-descriptor.js";
import type { ModelStore } from "./store/model-store.js";
import { InMemoryModelStore } from "./store/model-store.js";
import { TtlCache } from "./cache.js";

/** architecture §11, verbatim. */
export interface ModelRegistry {
  queryModels(filter: ModelQuery): Promise<ModelDescriptor[]>;
  getModel(providerId: string, modelId: string): Promise<ModelDescriptor | null>;
  /** config-driven, no redeploy (architecture §11's own comment on this method). */
  upsertModel(descriptor: ModelDescriptor): Promise<void>;
}

export interface DefaultModelRegistryOptions {
  store?: ModelStore;
  /** architecture §14.2's "short TTL" — defaults to 30s, short enough that a stale read self-heals quickly even if an invalidation event is ever missed. */
  cacheTtlMs?: number;
  seed?: ModelDescriptor[];
}

function matchesQuery(descriptor: ModelDescriptor, filter: ModelQuery): boolean {
  if (filter.providerId !== undefined && descriptor.providerId !== filter.providerId) {
    return false;
  }
  if (filter.modelClass !== undefined && descriptor.modelClass !== filter.modelClass) {
    return false;
  }
  const enabledOnly = filter.enabledOnly ?? true;
  if (enabledOnly && !descriptor.availability.enabled) {
    return false;
  }
  if (
    filter.minContextWindow !== undefined &&
    descriptor.capabilities.contextWindow < filter.minContextWindow
  ) {
    return false;
  }
  if (filter.requiresStructuredOutput && !descriptor.capabilities.structuredOutput) {
    return false;
  }
  if (filter.requiresToolCalling && !descriptor.capabilities.toolCalling) {
    return false;
  }
  if (filter.costTier !== undefined && descriptor.cost.tier !== filter.costTier) {
    return false;
  }
  return true;
}

/** Stable cache key for one `queryModels` call — same filter, same key, every time. */
function queryCacheKey(filter: ModelQuery): string {
  return JSON.stringify(filter, Object.keys(filter).sort());
}

/**
 * Default `ModelRegistry`: reads go through a TTL cache in front of
 * `ModelStore`; writes (`upsertModel`) go straight to the store and then
 * invalidate the whole query cache (architecture §14.2's "an operator
 * updates a row/record, and every gateway instance picks it up within
 * seconds"). `getModel` is cached per-key, independently of `queryModels`'
 * cache, since a get-by-key doesn't need to scan/filter the full list.
 */
export class DefaultModelRegistry implements ModelRegistry {
  private readonly store: ModelStore;
  private readonly queryCache: TtlCache<ModelDescriptor[]>;
  private readonly getCache: TtlCache<ModelDescriptor | null>;

  constructor(options: DefaultModelRegistryOptions = {}) {
    this.store = options.store ?? new InMemoryModelStore(options.seed ?? []);
    const ttlMs = options.cacheTtlMs ?? 30_000;
    this.queryCache = new TtlCache({ ttlMs });
    this.getCache = new TtlCache({ ttlMs });
  }

  async queryModels(filter: ModelQuery): Promise<ModelDescriptor[]> {
    const cacheKey = queryCacheKey(filter);
    const cached = this.queryCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const all = await this.store.list();
    const results = all.filter((descriptor) => matchesQuery(descriptor, filter));
    this.queryCache.set(cacheKey, results);
    return results;
  }

  async getModel(providerId: string, modelId: string): Promise<ModelDescriptor | null> {
    const cacheKey = `${providerId}::${modelId}`;
    const cached = this.getCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const result = await this.store.get({ providerId, modelId });
    this.getCache.set(cacheKey, result);
    return result;
  }

  async upsertModel(descriptor: ModelDescriptor): Promise<void> {
    await this.store.upsert(descriptor);
    // A write can change the result of *any* previously-cached query (a
    // model becoming enabled/disabled, changing modelClass, etc.), so the
    // whole query cache is invalidated rather than attempting to compute
    // which cached query keys are affected. The single-key get-by-id cache
    // is narrowed to just the affected key, since that one is precise.
    this.queryCache.invalidate();
    this.getCache.invalidate(`${descriptor.providerId}::${descriptor.modelId}`);
  }

  /**
   * Test/observability hook: subscribes to cache invalidation events
   * (architecture §14.2's Redis pub/sub, in-process half — see `cache.ts`
   * file docs). Exposed on the class (not the `ModelRegistry` interface,
   * which stays minimal per Blueprint §12) since only a caller that already
   * has a concrete `DefaultModelRegistry` — e.g. a future Redis-publisher
   * wire-up in `apps/gateway-server`'s bootstrap — would need it.
   */
  onCacheInvalidated(listener: (key: string | null) => void): () => void {
    const unsubQuery = this.queryCache.onInvalidate(listener);
    const unsubGet = this.getCache.onInvalidate(listener);
    return () => {
      unsubQuery();
      unsubGet();
    };
  }
}
