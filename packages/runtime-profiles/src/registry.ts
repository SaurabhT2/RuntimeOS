import { TtlCache } from "./cache.js";
import type { RuntimeProfile, RuntimeProfileId } from "./runtime-profile.js";
import { type TenantRef, tenantKey } from "./tenant.js";
import type { RuntimeProfileStore, TenantAssignmentStore } from "./store/runtime-profile-store.js";
import {
  InMemoryRuntimeProfileStore,
  InMemoryTenantAssignmentStore,
} from "./store/runtime-profile-store.js";
import { RuntimeProfileResolutionError } from "./errors.js";
import { DEFAULT_RUNTIME_PROFILE_ID, SEED_RUNTIME_PROFILES } from "./seed-data.js";

/**
 * architecture §37.4. `getActiveRuntimeProfile` is read by the four sites
 * §37.4 names (Execution Profile Registry, Cost Optimizer, Policy Engine's
 * Candidate Query, Retry Engine/Circuit Breaker) — none of that wiring is
 * part of this milestone (EM-6); this package ships the registry those
 * future call sites will use. `setTenantRuntimeProfile` is the
 * "admin-API-writable" override architecture §37.4 describes; a real admin
 * API (out of scope here) would call it.
 */
export interface RuntimeProfileRegistry {
  getActiveRuntimeProfile(tenant: TenantRef): Promise<RuntimeProfile>;
  setTenantRuntimeProfile(tenant: TenantRef, profileId: RuntimeProfileId): Promise<void>;
  upsertProfile(profile: RuntimeProfile): Promise<void>;
}

export interface DefaultRuntimeProfileRegistryOptions {
  store?: RuntimeProfileStore;
  tenantAssignments?: TenantAssignmentStore;
  /** Same short-TTL rationale as the other Wave 6 registries — defaults to 30s. */
  cacheTtlMs?: number;
  seedProfiles?: RuntimeProfile[];
  /**
   * The deployment-wide default (architecture §37.4: `GatewayConfig`'s
   * optional `runtimeProfileId` field, ADR-0013) — read by the composition
   * root and passed in here, never read directly by this package (this
   * package's dependency on `@ai-gateway/config` is the schema/type only;
   * see the package README).
   */
  deploymentDefaultProfileId?: RuntimeProfileId;
}

/**
 * Default `RuntimeProfileRegistry`: resolves, in order —
 * 1. an explicit per-tenant assignment (`setTenantRuntimeProfile`,
 *    admin-API-writable, architecture §37.4),
 * 2. the deployment-wide default (`deploymentDefaultProfileId`, sourced
 *    from `GatewayConfig.runtimeProfileId`),
 * 3. `DEFAULT_RUNTIME_PROFILE_ID` (`"production"`) —
 *
 * then looks the resolved id up in the profile store, TTL-cached exactly
 * like `model-registry`/`capability-registry`/`execution-profile-registry`.
 */
export class DefaultRuntimeProfileRegistry implements RuntimeProfileRegistry {
  private readonly store: RuntimeProfileStore;
  private readonly tenantAssignments: TenantAssignmentStore;
  private readonly cache: TtlCache<RuntimeProfile | null>;
  private readonly deploymentDefaultProfileId: RuntimeProfileId;

  constructor(options: DefaultRuntimeProfileRegistryOptions = {}) {
    this.store = options.store ?? new InMemoryRuntimeProfileStore(options.seedProfiles ?? []);
    this.tenantAssignments = options.tenantAssignments ?? new InMemoryTenantAssignmentStore();
    this.cache = new TtlCache({ ttlMs: options.cacheTtlMs ?? 30_000 });
    this.deploymentDefaultProfileId =
      options.deploymentDefaultProfileId ?? DEFAULT_RUNTIME_PROFILE_ID;
  }

  async getActiveRuntimeProfile(tenant: TenantRef): Promise<RuntimeProfile> {
    const assigned = await this.tenantAssignments.get(tenantKey(tenant));
    const profileId = assigned ?? this.deploymentDefaultProfileId;

    let profile = this.cache.get(profileId);
    if (profile === undefined) {
      profile = await this.store.get(profileId);
      this.cache.set(profileId, profile);
    }
    if (profile === null) {
      throw new RuntimeProfileResolutionError(profileId);
    }
    return profile;
  }

  async setTenantRuntimeProfile(tenant: TenantRef, profileId: RuntimeProfileId): Promise<void> {
    const registered = await this.store.get(profileId);
    if (registered === null) {
      throw new RuntimeProfileResolutionError(profileId);
    }
    await this.tenantAssignments.set(tenantKey(tenant), profileId);
  }

  async upsertProfile(profile: RuntimeProfile): Promise<void> {
    await this.store.upsert(profile);
    this.cache.invalidate(profile.id);
  }

  /** Test/observability hook, same rationale as the sibling Wave 6 registries. */
  onCacheInvalidated(listener: (key: string | null) => void): () => void {
    return this.cache.onInvalidate(listener);
  }
}

/**
 * Convenience factory pre-loaded with architecture §37.3's illustrative
 * seed presets — the shape a future composition root is expected to
 * construct, and what EM-6's own CLI-script acceptance demo uses.
 */
export function createSeededRuntimeProfileRegistry(
  options: Omit<DefaultRuntimeProfileRegistryOptions, "seedProfiles"> = {},
): DefaultRuntimeProfileRegistry {
  return new DefaultRuntimeProfileRegistry({ ...options, seedProfiles: SEED_RUNTIME_PROFILES });
}
