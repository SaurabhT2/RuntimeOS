import { describe, expect, it } from "vitest";
import { SEED_RUNTIME_PROFILES, DEFAULT_RUNTIME_PROFILE_ID } from "../src/seed-data.js";
import { KNOWN_RUNTIME_PROFILE_IDS } from "../src/runtime-profile.js";

describe("SEED_RUNTIME_PROFILES", () => {
  it("has exactly the six architecture §37.3 illustrative presets", () => {
    const ids = SEED_RUNTIME_PROFILES.map((p) => p.id).sort();
    expect(ids).toEqual([...KNOWN_RUNTIME_PROFILE_IDS].sort());
  });

  it("has no duplicate ids", () => {
    const ids = SEED_RUNTIME_PROFILES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("DEFAULT_RUNTIME_PROFILE_ID is one of the seed profiles", () => {
    expect(SEED_RUNTIME_PROFILES.some((p) => p.id === DEFAULT_RUNTIME_PROFILE_ID)).toBe(true);
  });

  it("enterprise excludes experimental models, matching its 'stable only' description", () => {
    const enterprise = SEED_RUNTIME_PROFILES.find((p) => p.id === "enterprise")!;
    expect(enterprise.provider.allowedLifecycleStates).toEqual(["stable"]);
  });

  it("development allows experimental models, matching its 'all, including experimental' description", () => {
    const development = SEED_RUNTIME_PROFILES.find((p) => p.id === "development")!;
    expect(development.provider.allowedLifecycleStates).toContain("experimental");
  });
});
