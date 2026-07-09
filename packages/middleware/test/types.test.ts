import { describe, expect, it } from "vitest";
import { ROLES } from "../src/types.js";

describe("ROLES", () => {
  it("matches architecture §20.5's RBAC role list exactly", () => {
    expect(ROLES).toEqual(["org_admin", "workspace_admin", "member"]);
  });
});
