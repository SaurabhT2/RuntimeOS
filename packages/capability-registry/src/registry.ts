import type { ExecuteRequest, TaskType } from "@ai-gateway/core-contracts";
import { TtlCache } from "@ai-gateway/model-registry";
import type { CapabilitySet } from "./capability-set.js";
import type { CapabilityStore } from "./store/capability-store.js";
import { InMemoryCapabilityStore } from "./store/capability-store.js";
import { CapabilityResolutionError } from "./errors.js";

/** architecture §32.2, verbatim. */
export interface CapabilityRegistry {
  resolveCapabilities(task: TaskType, req?: ExecuteRequest): Promise<CapabilitySet>;
  /** config-driven, no redeploy (architecture §32.2's own comment on this method). */
  registerMapping(task: TaskType, capabilities: CapabilitySet): Promise<void>;
}

export interface DefaultCapabilityRegistryOptions {
  store?: CapabilityStore;
  /** Same short-TTL rationale as `model-registry`'s `DefaultModelRegistry` — defaults to 30s. */
  cacheTtlMs?: number;
  seed?: Record<string, CapabilitySet>;
}

/**
 * Applies `ExecuteRequest`-level constraints on top of a task's default
 * `CapabilitySet` (architecture §32.2: "`resolveCapabilities` also folds in
 * explicit request-level constraints ... so the Capability Registry is the
 * single place 'what does this exact request need' gets decided"). Only
 * the constraint fields `core-contracts`'s `ExecuteRequest.constraints`
 * actually defines are consulted; nothing here infers capability needs from
 * message content — that inference is explicitly out of scope for this
 * package (Blueprint §8.14 names only config-driven mapping and
 * request-level override folding, never content-based classification).
 */
function applyRequestOverrides(base: CapabilitySet, req?: ExecuteRequest): CapabilitySet {
  if (!req?.constraints) {
    return base;
  }
  const { requiredSchema, minContextTokens, streaming } = req.constraints;
  return {
    ...base,
    structuredOutput: requiredSchema !== undefined ? true : base.structuredOutput,
    minContextTokens:
      minContextTokens !== undefined
        ? Math.max(base.minContextTokens, minContextTokens)
        : base.minContextTokens,
    streamingPreferred: streaming !== undefined ? streaming : base.streamingPreferred,
  };
}

/**
 * Default `CapabilityRegistry`: reads go through a TTL cache in front of a
 * `CapabilityStore`, exactly as `DefaultModelRegistry` does in front of a
 * `ModelStore` (architecture §32.2's "same cache/invalidation pattern as
 * `model-registry`, reused" — literally the same `TtlCache` class,
 * imported from `@ai-gateway/model-registry` rather than reimplemented,
 * since that dependency edge is already declared (Blueprint §4.1)).
 */
export class DefaultCapabilityRegistry implements CapabilityRegistry {
  private readonly store: CapabilityStore;
  private readonly cache: TtlCache<CapabilitySet | null>;

  constructor(options: DefaultCapabilityRegistryOptions = {}) {
    this.store = options.store ?? new InMemoryCapabilityStore(options.seed ?? {});
    this.cache = new TtlCache({ ttlMs: options.cacheTtlMs ?? 30_000 });
  }

  async resolveCapabilities(task: TaskType, req?: ExecuteRequest): Promise<CapabilitySet> {
    let base = this.cache.get(task);
    if (base === undefined) {
      base = await this.store.get(task);
      this.cache.set(task, base);
    }
    if (base === null) {
      throw new CapabilityResolutionError(task);
    }
    return applyRequestOverrides(base, req);
  }

  async registerMapping(task: TaskType, capabilities: CapabilitySet): Promise<void> {
    await this.store.upsert(task, capabilities);
    this.cache.invalidate(task);
  }

  /** Test/observability hook, same rationale as `DefaultModelRegistry.onCacheInvalidated`. */
  onCacheInvalidated(listener: (key: string | null) => void): () => void {
    return this.cache.onInvalidate(listener);
  }
}
