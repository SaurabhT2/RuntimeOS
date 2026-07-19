import { describe, expect, it } from "vitest";
import { tenantKey } from "../src/tenant.js";

describe("tenantKey", () => {
  it("returns the organizationId alone when there is no workspaceId", () => {
    expect(tenantKey({ organizationId: "org-1" })).toBe("org-1");
  });

  it("combines organizationId and workspaceId when both are present", () => {
    expect(tenantKey({ organizationId: "org-1", workspaceId: "ws-1" })).toBe("org-1::ws-1");
  });
});
