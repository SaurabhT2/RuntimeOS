import { describe, expect, it } from "vitest";
import { RuntimeProfileResolutionStage } from "../../src/stages/runtime-profile-resolution-stage.js";
import { baseRequest, seededOptions, tenant } from "../fixtures.js";

describe("RuntimeProfileResolutionStage", () => {
  it("resolves the active runtimeProfile for the tenant", async () => {
    const options = seededOptions();
    const stage = new RuntimeProfileResolutionStage(options.runtimeProfileRegistry);
    const result = await stage.run({ request: baseRequest(), tenant: tenant() });
    expect(result.runtimeProfile).toBeDefined();
  });

  it("passes only organizationId/workspaceId through as the TenantRef, not the full tenant object", async () => {
    const seen: unknown[] = [];
    const stub = {
      getActiveRuntimeProfile: async (t: unknown) => {
        seen.push(t);
        return { id: "production" as const } as never;
      },
      setTenantRuntimeProfile: async () => undefined,
      upsertProfile: async () => undefined,
    };
    const stage = new RuntimeProfileResolutionStage(stub);
    await stage.run({
      request: baseRequest(),
      tenant: tenant({ workspaceId: "ws-1" }),
    });
    expect(seen).toEqual([{ organizationId: "org-1", workspaceId: "ws-1" }]);
  });

  it("is independently replaceable — any RuntimeProfileRegistry-shaped object works", async () => {
    const stub = {
      getActiveRuntimeProfile: async () => ({ id: "free_tier" as const }) as never,
      setTenantRuntimeProfile: async () => undefined,
      upsertProfile: async () => undefined,
    };
    const stage = new RuntimeProfileResolutionStage(stub);
    const result = await stage.run({ request: baseRequest(), tenant: tenant() });
    expect(result.runtimeProfile?.id).toBe("free_tier");
  });
});
