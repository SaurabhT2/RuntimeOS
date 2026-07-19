/**
 * @ai-gateway/runtime-profiles
 *
 * Deployment/tenant-wide behavior overlay — provider preference, reliability
 * aggressiveness, cost ceilings, telemetry verbosity, caching aggressiveness
 * (architecture §37). Orthogonal to Execution Profiles (§31): a Runtime
 * Profile describes how the *entire deployment/tenant* should behave,
 * overlaying adjustments on top of whatever Execution Profile is resolved
 * for a given task.
 *
 * STATUS: implemented (Engineering Milestone EM-6, Blueprint §7, §8.16).
 * Not yet wired into any of the four read sites architecture §37.4 names
 * (Execution Profile Registry, Cost Optimizer, Policy Engine's Candidate
 * Query, Retry Engine/Circuit Breaker) — that wiring is `strategy-layer`'s
 * job (Wave 8, EM-8) plus targeted follow-up changes to `policy-engine`/
 * `reliability` at that time.
 *
 * Architecture reference: §37
 */

export {
  type RuntimeProfile,
  type RuntimeProfileId,
  type ModelLifecycleState,
  MODEL_LIFECYCLE_STATES,
  KNOWN_RUNTIME_PROFILE_IDS,
  runtimeProfileSchema,
} from "./runtime-profile.js";

export { type TenantRef, tenantKey } from "./tenant.js";

export {
  type RuntimeProfileStore,
  InMemoryRuntimeProfileStore,
  type TenantAssignmentStore,
  InMemoryTenantAssignmentStore,
} from "./store/runtime-profile-store.js";

export {
  type RuntimeProfileRegistry,
  DefaultRuntimeProfileRegistry,
  type DefaultRuntimeProfileRegistryOptions,
  createSeededRuntimeProfileRegistry,
} from "./registry.js";

export { RuntimeProfileResolutionError } from "./errors.js";

export { SEED_RUNTIME_PROFILES, DEFAULT_RUNTIME_PROFILE_ID } from "./seed-data.js";

export { TtlCache, type TtlCacheOptions } from "./cache.js";
