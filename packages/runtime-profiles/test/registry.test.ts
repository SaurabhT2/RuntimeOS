import { describe, expect, it, vi } from "vitest";
import {
  DefaultRuntimeProfileRegistry,
  createSeededRuntimeProfileRegistry,
} from "../src/registry.js";
import { RuntimeProfileResolutionError } from "../src/errors.js";
import { SEED_RUNTIME_PROFILES } from "../src/seed-data.js";
import { InMemoryRuntimeProfileStore } from "../src/store/runtime-profile-store.js";

const TENANT = { organizationId: "org-1" };

describe("DefaultRuntimeProfileRegistry", () => {
  it("falls back to the deployment default (production) when the tenant has no assignment", async () => {
    const registry = createSeededRuntimeProfileRegistry();
    const profile = await registry.getActiveRuntimeProfile(TENANT);
    expect(profile.id).toBe("production");
  });

  it("honors an explicitly configured deploymentDefaultProfileId", async () => {
    const registry = createSeededRuntimeProfileRegistry({
      deploymentDefaultProfileId: "enterprise",
    });
    const profile = await registry.getActiveRuntimeProfile(TENANT);
    expect(profile.id).toBe("enterprise");
  });

  it("throws RuntimeProfileResolutionError if the resolved id has no registered profile", async () => {
    const registry = new DefaultRuntimeProfileRegistry();
    await expect(registry.getActiveRuntimeProfile(TENANT)).rejects.toThrow(
      RuntimeProfileResolutionError,
    );
  });

  it("setTenantRuntimeProfile assigns a per-tenant override that getActiveRuntimeProfile then honors", async () => {
    const registry = createSeededRuntimeProfileRegistry();
    await registry.setTenantRuntimeProfile(TENANT, "free_tier");
    const profile = await registry.getActiveRuntimeProfile(TENANT);
    expect(profile.id).toBe("free_tier");
  });

  it("a tenant override takes priority over the deployment default", async () => {
    const registry = createSeededRuntimeProfileRegistry({
      deploymentDefaultProfileId: "enterprise",
    });
    await registry.setTenantRuntimeProfile(TENANT, "high_availability");
    const profile = await registry.getActiveRuntimeProfile(TENANT);
    expect(profile.id).toBe("high_availability");
  });

  it("a workspace-scoped tenant is independent of its org-level tenant", async () => {
    const registry = createSeededRuntimeProfileRegistry();
    await registry.setTenantRuntimeProfile(
      { organizationId: "org-1", workspaceId: "ws-a" },
      "offline",
    );
    const wsProfile = await registry.getActiveRuntimeProfile({
      organizationId: "org-1",
      workspaceId: "ws-a",
    });
    const orgProfile = await registry.getActiveRuntimeProfile({ organizationId: "org-1" });
    expect(wsProfile.id).toBe("offline");
    expect(orgProfile.id).toBe("production");
  });

  it("setTenantRuntimeProfile rejects an unregistered profile id", async () => {
    const registry = createSeededRuntimeProfileRegistry();
    await expect(registry.setTenantRuntimeProfile(TENANT, "not_a_real_profile")).rejects.toThrow(
      RuntimeProfileResolutionError,
    );
  });

  it("upsertProfile registers a new profile and invalidates its cache entry", async () => {
    const registry = new DefaultRuntimeProfileRegistry();
    const custom = { ...SEED_RUNTIME_PROFILES[0]!, id: "custom_profile" };
    await registry.upsertProfile(custom);
    await registry.setTenantRuntimeProfile(TENANT, "custom_profile");
    const profile = await registry.getActiveRuntimeProfile(TENANT);
    expect(profile.id).toBe("custom_profile");
  });

  it("upsertProfile overwrites an existing profile", async () => {
    const registry = createSeededRuntimeProfileRegistry();
    const updated = {
      ...SEED_RUNTIME_PROFILES.find((p) => p.id === "production")!,
      telemetry: { verbosity: "verbose" as const },
    };
    await registry.upsertProfile(updated);
    const profile = await registry.getActiveRuntimeProfile(TENANT);
    expect(profile.telemetry.verbosity).toBe("verbose");
  });

  it("caches profile reads (store.get called once across repeated resolves for the same tenant)", async () => {
    const store = new InMemoryRuntimeProfileStore(SEED_RUNTIME_PROFILES);
    const getSpy = vi.spyOn(store, "get");
    const registry = new DefaultRuntimeProfileRegistry({ store });

    await registry.getActiveRuntimeProfile(TENANT);
    await registry.getActiveRuntimeProfile(TENANT);
    await registry.getActiveRuntimeProfile(TENANT);

    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it("expires cached profile entries after the configured TTL", async () => {
    const store = new InMemoryRuntimeProfileStore(SEED_RUNTIME_PROFILES);
    const getSpy = vi.spyOn(store, "get");
    const registry = new DefaultRuntimeProfileRegistry({ store, cacheTtlMs: 1 });

    await registry.getActiveRuntimeProfile(TENANT);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await registry.getActiveRuntimeProfile(TENANT);

    expect(getSpy).toHaveBeenCalledTimes(2);
  });

  it("onCacheInvalidated notifies subscribers on upsertProfile", async () => {
    const registry = createSeededRuntimeProfileRegistry();
    const listener = vi.fn();
    const unsubscribe = registry.onCacheInvalidated(listener);

    const profile = SEED_RUNTIME_PROFILES.find((p) => p.id === "production")!;
    await registry.upsertProfile(profile);
    expect(listener).toHaveBeenCalledWith("production");

    unsubscribe();
    await registry.upsertProfile(profile);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
