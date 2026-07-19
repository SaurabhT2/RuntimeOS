import { describe, expect, it } from "vitest";
import { retryPolicySchema } from "../src/execution-profile.js";
import { DEFAULT_RETRY_POLICY } from "../src/retry-policy.js";

describe("DEFAULT_RETRY_POLICY", () => {
  it("is a valid RetryPolicy", () => {
    expect(retryPolicySchema.safeParse(DEFAULT_RETRY_POLICY).success).toBe(true);
  });
});
