/**
 * @ai-gateway/execution-profile-registry
 *
 * Resolves a task type (or an explicit override profile ID) to a full
 * `ExecutionProfile`: inference parameters, retry policy, streaming/
 * structured-output/caching defaults (architecture §31).
 *
 * STATUS: implemented (Engineering Milestone EM-6, Blueprint §7, §8.15).
 * Not yet wired into `orchestrator`/`policy-engine` — that wiring, and the
 * merge with Runtime Profile adjustments into a `ResolvedExecutionProfile`,
 * is `strategy-layer`'s job (Wave 8, EM-8, architecture §31.4).
 *
 * Architecture reference: §31
 */

export {
  type ExecutionProfile,
  type ExecutionProfileId,
  type ResolvedExecutionProfile,
  KNOWN_EXECUTION_PROFILE_IDS,
  executionProfileSchema,
  retryPolicySchema,
} from "./execution-profile.js";

export {
  type RetryPolicy,
  type BackoffStrategy,
  BACKOFF_STRATEGIES,
  DEFAULT_RETRY_POLICY,
} from "./retry-policy.js";

export { type ProfileStore, InMemoryProfileStore } from "./store/profile-store.js";

export {
  type ExecutionProfileRegistry,
  DefaultExecutionProfileRegistry,
  type DefaultExecutionProfileRegistryOptions,
  createSeededExecutionProfileRegistry,
} from "./registry.js";

export { ExecutionProfileResolutionError } from "./errors.js";

export { SEED_EXECUTION_PROFILES, TASK_TO_EXECUTION_PROFILE_ID } from "./seed-data.js";

export { TtlCache, type TtlCacheOptions } from "./cache.js";
