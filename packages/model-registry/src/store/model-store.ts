import type { ModelDescriptor, ModelKey } from "../model-descriptor.js";

/**
 * The registry's storage seam (architecture §14.2: "backed by a database
 * table (or config file for small deployments)"). `ModelRegistry` (in
 * `registry.ts`) never touches storage directly — it always goes through
 * this interface plus the TTL-cache/invalidation layer in `cache.ts` — so a
 * real DB-backed implementation is a second implementation of this same
 * interface, not a redesign (Blueprint §13.5's over-abstraction test: a
 * second implementation is a named future goal, architecture §14.2, not a
 * hypothetical one).
 *
 * `apps/gateway-server`'s composition root (Blueprint §6.4, EM-5 scope) is
 * where a real database connection would be constructed and a DB-backed
 * `ModelStore` wired in; no DB driver dependency exists anywhere in this
 * repo yet, matching `@ai-gateway/config`'s own EM-1 precedent (env/file/
 * in-memory sources shipped first; a DB-backed `ConfigSource` is explicitly
 * documented there as additive future work, not built ahead of need).
 */
export interface ModelStore {
  get(key: ModelKey): Promise<ModelDescriptor | null>;
  upsert(descriptor: ModelDescriptor): Promise<void>;
  /** Returns every stored descriptor. Filtering happens one layer up, in `ModelRegistry` (`registry.ts`). */
  list(): Promise<ModelDescriptor[]>;
  delete(key: ModelKey): Promise<boolean>;
}

function sameKey(a: ModelKey, b: ModelKey): boolean {
  return a.providerId === b.providerId && a.modelId === b.modelId;
}

function storeKey(key: ModelKey): string {
  return `${key.providerId}::${key.modelId}`;
}

/**
 * In-process implementation, keyed by `(providerId, modelId)`. Used
 * directly in tests and as the default store when no DB-backed
 * implementation is configured (e.g. local development, matching
 * architecture §14.2's "config file for small deployments" launch option).
 */
export class InMemoryModelStore implements ModelStore {
  private readonly descriptors = new Map<string, ModelDescriptor>();

  constructor(seed: ModelDescriptor[] = []) {
    for (const descriptor of seed) {
      this.descriptors.set(storeKey(descriptor), descriptor);
    }
  }

  get(key: ModelKey): Promise<ModelDescriptor | null> {
    return Promise.resolve(this.descriptors.get(storeKey(key)) ?? null);
  }

  upsert(descriptor: ModelDescriptor): Promise<void> {
    this.descriptors.set(storeKey(descriptor), descriptor);
    return Promise.resolve();
  }

  list(): Promise<ModelDescriptor[]> {
    return Promise.resolve([...this.descriptors.values()]);
  }

  delete(key: ModelKey): Promise<boolean> {
    return Promise.resolve(this.descriptors.delete(storeKey(key)));
  }
}

/** Re-exported so callers outside this file can compare keys without duplicating the equality rule. */
export { sameKey as modelKeysEqual };
