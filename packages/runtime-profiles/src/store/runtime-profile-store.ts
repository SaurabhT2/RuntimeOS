import type { RuntimeProfile, RuntimeProfileId } from "../runtime-profile.js";

/** The registry's storage seam for preset `RuntimeProfile` records, keyed by id. */
export interface RuntimeProfileStore {
  get(profileId: RuntimeProfileId): Promise<RuntimeProfile | null>;
  upsert(profile: RuntimeProfile): Promise<void>;
  list(): Promise<RuntimeProfile[]>;
}

/** In-process implementation. Default store when none is configured. */
export class InMemoryRuntimeProfileStore implements RuntimeProfileStore {
  private readonly profiles = new Map<RuntimeProfileId, RuntimeProfile>();

  constructor(seed: RuntimeProfile[] = []) {
    for (const profile of seed) {
      this.profiles.set(profile.id, profile);
    }
  }

  get(profileId: RuntimeProfileId): Promise<RuntimeProfile | null> {
    return Promise.resolve(this.profiles.get(profileId) ?? null);
  }

  upsert(profile: RuntimeProfile): Promise<void> {
    this.profiles.set(profile.id, profile);
    return Promise.resolve();
  }

  list(): Promise<RuntimeProfile[]> {
    return Promise.resolve([...this.profiles.values()]);
  }
}

/**
 * Storage seam for the admin-API-writable per-tenant assignment (architecture
 * §37.4: "selected per tenant ... via `GatewayConfig` ... extended with an
 * optional `runtimeProfileId` field"). A real implementation would persist
 * this the same way `GatewayConfig` itself is persisted/hot-reloaded
 * (`@ai-gateway/config`'s `ConfigSource`/`watchConfig`, architecture §10.6);
 * this package ships the interface plus an in-memory implementation now,
 * exactly as `model-registry`/`capability-registry`/`execution-profile-registry`
 * ship in-memory stores rather than a config/DB-backed one.
 */
export interface TenantAssignmentStore {
  get(tenantKey: string): Promise<RuntimeProfileId | null>;
  set(tenantKey: string, profileId: RuntimeProfileId): Promise<void>;
}

export class InMemoryTenantAssignmentStore implements TenantAssignmentStore {
  private readonly assignments = new Map<string, RuntimeProfileId>();

  get(tenantKey: string): Promise<RuntimeProfileId | null> {
    return Promise.resolve(this.assignments.get(tenantKey) ?? null);
  }

  set(tenantKey: string, profileId: RuntimeProfileId): Promise<void> {
    this.assignments.set(tenantKey, profileId);
    return Promise.resolve();
  }
}
