import { describe, expect, it } from "vitest";
import { capabilitySetSchema } from "../src/capability-set.js";
import { SEED_CAPABILITIES } from "../src/seed-data.js";

describe("capabilitySetSchema", () => {
  it("accepts every seed capability set", () => {
    for (const [task, capabilities] of Object.entries(SEED_CAPABILITIES)) {
      const result = capabilitySetSchema.safeParse(capabilities);
      expect(result.success, `${task} should be a valid CapabilitySet`).toBe(true);
    }
  });

  it("accepts the optional vision/audio fields when present", () => {
    const result = capabilitySetSchema.safeParse({
      structuredOutput: false,
      toolCalling: false,
      reasoningDepth: "shallow",
      streamingPreferred: false,
      minContextTokens: 1000,
      visionInput: true,
      audioInput: false,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid reasoningDepth", () => {
    const result = capabilitySetSchema.safeParse({
      structuredOutput: false,
      toolCalling: false,
      reasoningDepth: "extreme",
      streamingPreferred: false,
      minContextTokens: 1000,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative minContextTokens", () => {
    const result = capabilitySetSchema.safeParse({
      structuredOutput: false,
      toolCalling: false,
      reasoningDepth: "shallow",
      streamingPreferred: false,
      minContextTokens: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const result = capabilitySetSchema.safeParse({
      toolCalling: false,
      reasoningDepth: "shallow",
      streamingPreferred: false,
      minContextTokens: 1000,
    });
    expect(result.success).toBe(false);
  });
});
