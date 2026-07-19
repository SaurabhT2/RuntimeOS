import type { TaskType } from "@ai-gateway/core-contracts";
import { TtlCache } from "./cache.js";
import type { ExecutionProfile, ExecutionProfileId } from "./execution-profile.js";
import type { ProfileStore } from "./store/profile-store.js";
import { InMemoryProfileStore } from "./store/profile-store.js";
import { ExecutionProfileResolutionError } from "./errors.js";
import { SEED_EXECUTION_PROFILES, TASK_TO_EXECUTION_PROFILE_ID } from "./seed-data.js";

/**
 * architecture §31.2/§31.4. `resolveProfile` is the task-driven entry point
 * `strategy-layer` (EM-8) will call; `getProfileById` is the direct lookup
 * Blueprint §8.15 names as the mechanism behind
 * `preferences.executionProfileOverride` (architecture §31.1) — an advanced
 * caller names a profile ID directly instead of going through the task
 * mapping. `upsertProfile`/`registerTaskMapping` are the config-driven
 * write paths (architecture §31.2/§31.3: "an operator can add a new profile
 * or retune an existing one via config").
 */
export interface ExecutionProfileRegistry {
  resolveProfile(task: TaskType, overrideProfileId?: string): Promise<ExecutionProfile>;
  getProfileById(profileId: ExecutionProfileId): Promise<ExecutionProfile | null>;
  upsertProfile(profile: ExecutionProfile): Promise<void>;
  registerTaskMapping(task: TaskType, profileId: ExecutionProfileId): Promise<void>;
}

export interface DefaultExecutionProfileRegistryOptions {
  store?: ProfileStore;
  /** Same short-TTL rationale as `model-registry`'s `DefaultModelRegistry` — defaults to 30s. */
  cacheTtlMs?: number;
  seedProfiles?: ExecutionProfile[];
  seedTaskMapping?: Record<string, string>;
}

/**
 * Default `ExecutionProfileRegistry`: reads go through a TTL cache in front
 * of a `ProfileStore`, mirroring `DefaultModelRegistry`/
 * `DefaultCapabilityRegistry` exactly (architecture §31.2's "same
 * cache/invalidation infrastructure reused a third time" — via this
 * package's own local `TtlCache` copy, see `cache.ts` for why it's a copy
 * rather than an import). The task->profile mapping is cached and
 * invalidated independently of the profile-by-id cache, matching
 * `DefaultModelRegistry`'s query-cache/get-cache split.
 */
export class DefaultExecutionProfileRegistry implements ExecutionProfileRegistry {
  private readonly store: ProfileStore;
  private readonly profileCache: TtlCache<ExecutionProfile | null>;
  private readonly taskMapping: Map<string, string>;

  constructor(options: DefaultExecutionProfileRegistryOptions = {}) {
    this.store = options.store ?? new InMemoryProfileStore(options.seedProfiles ?? []);
    this.profileCache = new TtlCache({ ttlMs: options.cacheTtlMs ?? 30_000 });
    this.taskMapping = new Map(Object.entries(options.seedTaskMapping ?? {}));
  }

  async getProfileById(profileId: ExecutionProfileId): Promise<ExecutionProfile | null> {
    let cached = this.profileCache.get(profileId);
    if (cached === undefined) {
      cached = await this.store.get(profileId);
      this.profileCache.set(profileId, cached);
    }
    return cached;
  }

  async resolveProfile(task: TaskType, overrideProfileId?: string): Promise<ExecutionProfile> {
    // architecture §31.1: `preferences.executionProfileOverride` selects a
    // profile ID directly, bypassing task-driven resolution entirely, but
    // it is still resolved through the same registered-profiles store —
    // never a raw parameter passthrough (ADR-010).
    if (overrideProfileId !== undefined) {
      const overridden = await this.getProfileById(overrideProfileId);
      if (overridden === null) {
        throw new ExecutionProfileResolutionError(overrideProfileId, "unknown_profile_id");
      }
      return overridden;
    }

    const profileId = this.taskMapping.get(task);
    if (profileId === undefined) {
      throw new ExecutionProfileResolutionError(task, "unmapped_task");
    }
    const profile = await this.getProfileById(profileId);
    if (profile === null) {
      throw new ExecutionProfileResolutionError(profileId, "unknown_profile_id");
    }
    return profile;
  }

  async upsertProfile(profile: ExecutionProfile): Promise<void> {
    await this.store.upsert(profile);
    this.profileCache.invalidate(profile.id);
  }

  registerTaskMapping(task: TaskType, profileId: ExecutionProfileId): Promise<void> {
    this.taskMapping.set(task, profileId);
    return Promise.resolve();
  }

  /** Test/observability hook, same rationale as `DefaultModelRegistry.onCacheInvalidated`. */
  onCacheInvalidated(listener: (key: string | null) => void): () => void {
    return this.profileCache.onInvalidate(listener);
  }
}

/**
 * Convenience factory pre-loaded with architecture §31.3's illustrative
 * seed profiles and the task->profile mapping (`seed-data.ts`) — the
 * shape `apps/gateway-server`'s future composition root (EM-8) is expected
 * to construct, and what EM-6's own CLI-script acceptance demo uses.
 */
export function createSeededExecutionProfileRegistry(
  options: Omit<DefaultExecutionProfileRegistryOptions, "seedProfiles" | "seedTaskMapping"> = {},
): DefaultExecutionProfileRegistry {
  return new DefaultExecutionProfileRegistry({
    ...options,
    seedProfiles: SEED_EXECUTION_PROFILES,
    seedTaskMapping: TASK_TO_EXECUTION_PROFILE_ID,
  });
}
