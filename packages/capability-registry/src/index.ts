/**
 * @ai-gateway/capability-registry
 *
 * Maps a task type to the abstract capabilities it requires, independent of
 * any model or provider (architecture §32).
 *
 * STATUS: implemented (Engineering Milestone EM-6, Blueprint §7, §8.14).
 * Not yet wired into `orchestrator`/`policy-engine` — that wiring is
 * `strategy-layer`'s job (Wave 8, EM-8).
 *
 * Architecture reference: §32
 */

export { type CapabilitySet, capabilitySetSchema } from "./capability-set.js";

export { type CapabilityStore, InMemoryCapabilityStore } from "./store/capability-store.js";

export {
  type CapabilityRegistry,
  DefaultCapabilityRegistry,
  type DefaultCapabilityRegistryOptions,
} from "./registry.js";

export { CapabilityResolutionError } from "./errors.js";

export { SEED_CAPABILITIES } from "./seed-data.js";
