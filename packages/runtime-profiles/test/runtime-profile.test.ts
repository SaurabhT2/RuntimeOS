import { describe, expect, it } from "vitest";
import { runtimeProfileSchema } from "../src/runtime-profile.js";
import { SEED_RUNTIME_PROFILES } from "../src/seed-data.js";

describe("runtimeProfileSchema", () => {
  it("accepts every seed runtime profile", () => {
    for (const profile of SEED_RUNTIME_PROFILES) {
      const result = runtimeProfileSchema.safeParse(profile);
      expect(result.success, `${profile.id} should be a valid RuntimeProfile`).toBe(true);
    }
  });

  it("accepts a profile whose cost object is empty (both fields optional)", () => {
    const result = runtimeProfileSchema.safeParse({
      ...SEED_RUNTIME_PROFILES[0],
      cost: {},
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid lifecycle state in allowedLifecycleStates", () => {
    const invalid = {
      ...SEED_RUNTIME_PROFILES[0]!,
      provider: {
        ...SEED_RUNTIME_PROFILES[0]!.provider,
        allowedLifecycleStates: ["not_a_real_state"],
      },
    };
    expect(runtimeProfileSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects an invalid retryAggressiveness", () => {
    const invalid = {
      ...SEED_RUNTIME_PROFILES[0]!,
      reliability: { ...SEED_RUNTIME_PROFILES[0]!.reliability, retryAggressiveness: "reckless" },
    };
    expect(runtimeProfileSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a non-positive maxProvidersInFailoverChain", () => {
    const invalid = {
      ...SEED_RUNTIME_PROFILES[0]!,
      provider: { ...SEED_RUNTIME_PROFILES[0]!.provider, maxProvidersInFailoverChain: 0 },
    };
    expect(runtimeProfileSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects an invalid caching.aggressiveness", () => {
    const invalid = { ...SEED_RUNTIME_PROFILES[0]!, caching: { aggressiveness: "extreme" } };
    expect(runtimeProfileSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const { telemetry: _telemetry, ...rest } = SEED_RUNTIME_PROFILES[0]!;
    expect(runtimeProfileSchema.safeParse(rest).success).toBe(false);
  });
});
