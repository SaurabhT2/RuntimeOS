import { describe, expect, it } from "vitest";
import { modelDescriptorSchema } from "../src/model-descriptor.js";
import { SEED_MODELS } from "../src/seed-data.js";

describe("modelDescriptorSchema", () => {
  it("validates every seed model", () => {
    for (const model of SEED_MODELS) {
      expect(() => modelDescriptorSchema.parse(model)).not.toThrow();
    }
  });

  it("rejects a descriptor with an out-of-range creativityScore", () => {
    const invalid = {
      ...SEED_MODELS[0],
      capabilities: { ...SEED_MODELS[0]!.capabilities, creativityScore: 1.5 },
    };
    expect(() => modelDescriptorSchema.parse(invalid)).toThrow();
  });

  it("rejects a descriptor with a negative cost", () => {
    const invalid = {
      ...SEED_MODELS[0],
      cost: { ...SEED_MODELS[0]!.cost, inputPer1kTokensUsd: -1 },
    };
    expect(() => modelDescriptorSchema.parse(invalid)).toThrow();
  });

  it("rejects a descriptor missing a required field", () => {
    const withoutProviderId: Record<string, unknown> = { ...SEED_MODELS[0]! };
    delete withoutProviderId.providerId;
    expect(() => modelDescriptorSchema.parse(withoutProviderId)).toThrow();
  });

  it("accepts a descriptor without optional availability.regions", () => {
    const withoutRegions = { ...SEED_MODELS[0] };
    expect(() => modelDescriptorSchema.parse(withoutRegions)).not.toThrow();
  });
});
