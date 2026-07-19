import type { ExecutionProfile, ExecutionProfileId } from "../execution-profile.js";

/**
 * The registry's storage seam, mirroring `model-registry`'s `ModelStore`
 * and `capability-registry`'s `CapabilityStore` (architecture §31.2's
 * "seed profile table with the same cache/invalidation infrastructure
 * reused a third time").
 */
export interface ProfileStore {
  get(profileId: ExecutionProfileId): Promise<ExecutionProfile | null>;
  upsert(profile: ExecutionProfile): Promise<void>;
  list(): Promise<ExecutionProfile[]>;
  delete(profileId: ExecutionProfileId): Promise<boolean>;
}

/** In-process implementation, keyed by `id`. Default store when none is configured. */
export class InMemoryProfileStore implements ProfileStore {
  private readonly profiles = new Map<ExecutionProfileId, ExecutionProfile>();

  constructor(seed: ExecutionProfile[] = []) {
    for (const profile of seed) {
      this.profiles.set(profile.id, profile);
    }
  }

  get(profileId: ExecutionProfileId): Promise<ExecutionProfile | null> {
    return Promise.resolve(this.profiles.get(profileId) ?? null);
  }

  upsert(profile: ExecutionProfile): Promise<void> {
    this.profiles.set(profile.id, profile);
    return Promise.resolve();
  }

  list(): Promise<ExecutionProfile[]> {
    return Promise.resolve([...this.profiles.values()]);
  }

  delete(profileId: ExecutionProfileId): Promise<boolean> {
    return Promise.resolve(this.profiles.delete(profileId));
  }
}
