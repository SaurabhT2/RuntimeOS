import { describe, expect, it } from "vitest";
import { executionProfileSchema } from "../src/execution-profile.js";
import { SEED_EXECUTION_PROFILES } from "../src/seed-data.js";

describe("executionProfileSchema", () => {
  it("accepts every seed execution profile", () => {
    for (const profile of SEED_EXECUTION_PROFILES) {
      const result = executionProfileSchema.safeParse(profile);
      expect(result.success, `${profile.id} should be a valid ExecutionProfile`).toBe(true);
    }
  });

  it("rejects an out-of-range temperature", () => {
    const invalid = {
      ...SEED_EXECUTION_PROFILES[0]!,
      inference: { ...SEED_EXECUTION_PROFILES[0]!.inference, temperature: 5 },
    };
    expect(executionProfileSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects an invalid retry backoff strategy", () => {
    const invalid = {
      ...SEED_EXECUTION_PROFILES[0]!,
      retryPolicy: { ...SEED_EXECUTION_PROFILES[0]!.retryPolicy, backoff: "quadratic" },
    };
    expect(executionProfileSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects an invalid retryableErrorCodes entry", () => {
    const invalid = {
      ...SEED_EXECUTION_PROFILES[0]!,
      retryPolicy: {
        ...SEED_EXECUTION_PROFILES[0]!.retryPolicy,
        retryableErrorCodes: ["NOT_A_REAL_CODE"],
      },
    };
    expect(executionProfileSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects an invalid caching.keyStrategy", () => {
    const invalid = {
      ...SEED_EXECUTION_PROFILES[0]!,
      caching: { ...SEED_EXECUTION_PROFILES[0]!.caching, keyStrategy: "fuzzy" },
    };
    expect(executionProfileSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const { id: _id, ...rest } = SEED_EXECUTION_PROFILES[0]!;
    expect(executionProfileSchema.safeParse(rest).success).toBe(false);
  });
});
