/**
 * @ai-gateway/model-registry
 *
 * Queryable, config-driven model registry (DB-backed + in-memory cache).
 *
 * STATUS: implemented (Engineering Milestone EM-2, Blueprint §7, §8.6).
 *
 * Architecture reference: §14
 */

export {
  type ModelDescriptor,
  modelDescriptorSchema,
  REASONING_DEPTHS,
  COST_TIERS,
  type ModelKey,
  type ModelQuery,
} from "./model-descriptor.js";

export { type ModelStore, InMemoryModelStore, modelKeysEqual } from "./store/model-store.js";

export { TtlCache, type TtlCacheOptions } from "./cache.js";

export {
  type ModelRegistry,
  DefaultModelRegistry,
  type DefaultModelRegistryOptions,
} from "./registry.js";

export { SEED_MODELS } from "./seed-data.js";
