import { describe, expect, it } from "vitest";
import { computeModelClassDowngrade, computeReasoningRequired } from "../src/downgrade.js";
import { capabilities, extractionProfile, reasoningProfile } from "./fixtures.js";

describe("computeReasoningRequired", () => {
  it("is always true for deep reasoning depth, regardless of input size", () => {
    expect(computeReasoningRequired(capabilities({ reasoningDepth: "deep" }), 1)).toBe(true);
    expect(computeReasoningRequired(capabilities({ reasoningDepth: "deep" }), 100_000)).toBe(true);
  });

  it("is always false for shallow reasoning depth, regardless of input size", () => {
    expect(computeReasoningRequired(capabilities({ reasoningDepth: "shallow" }), 1)).toBe(false);
    expect(computeReasoningRequired(capabilities({ reasoningDepth: "shallow" }), 100_000)).toBe(
      false,
    );
  });

  it("moderate reasoning depth is not required for a short (factual-extraction-shaped) input", () => {
    expect(computeReasoningRequired(capabilities({ reasoningDepth: "moderate" }), 10)).toBe(false);
  });

  it("moderate reasoning depth is required once the input is long enough", () => {
    expect(computeReasoningRequired(capabilities({ reasoningDepth: "moderate" }), 5_000)).toBe(
      true,
    );
  });
});

describe("computeModelClassDowngrade — downgrade recommendation tests", () => {
  it("recommends fast-extraction when a complex-reasoning profile doesn't actually need reasoning", () => {
    const result = computeModelClassDowngrade(
      reasoningProfile(),
      capabilities({ reasoningDepth: "moderate" }),
      false,
    );
    expect(result).toBe("fast-extraction");
  });

  it("recommends nothing when the profile's top preferred class is already fast-extraction", () => {
    const result = computeModelClassDowngrade(
      extractionProfile(),
      capabilities({ reasoningDepth: "shallow" }),
      false,
    );
    expect(result).toBeUndefined();
  });
});

describe("computeModelClassDowngrade — capability preservation tests", () => {
  it("never downgrades when the resolved capability need is deep, even if the heuristic disagreed", () => {
    const result = computeModelClassDowngrade(
      reasoningProfile(),
      capabilities({ reasoningDepth: "deep" }),
      false, // deliberately inconsistent input: a caller-computed reasoningRequired=false
    );
    expect(result).toBeUndefined();
  });

  it("never downgrades a shallow/moderate task when reasoningRequired is true", () => {
    expect(
      computeModelClassDowngrade(
        reasoningProfile(),
        capabilities({ reasoningDepth: "moderate" }),
        true,
      ),
    ).toBeUndefined();
    expect(
      computeModelClassDowngrade(
        reasoningProfile(),
        capabilities({ reasoningDepth: "shallow" }),
        true,
      ),
    ).toBeUndefined();
  });
  it("never downgrades away from a model that supports structured output (architecture §33.3's own named example)", () => {
    const result = computeModelClassDowngrade(
      reasoningProfile(),
      capabilities({ reasoningDepth: "shallow", structuredOutput: true }),
      false,
    );
    expect(result).toBeUndefined();
  });

  it("never downgrades away from a model that requires tool calling", () => {
    const result = computeModelClassDowngrade(
      reasoningProfile(),
      capabilities({ reasoningDepth: "shallow", toolCalling: true }),
      false,
    );
    expect(result).toBeUndefined();
  });

  it("never downgrades when both structuredOutput and toolCalling are hard-required", () => {
    const result = computeModelClassDowngrade(
      reasoningProfile(),
      capabilities({ reasoningDepth: "shallow", structuredOutput: true, toolCalling: true }),
      false,
    );
    expect(result).toBeUndefined();
  });

  it("still downgrades a shallow-reasoning task that needs neither structured output nor tool calling", () => {
    const result = computeModelClassDowngrade(
      reasoningProfile(),
      capabilities({ reasoningDepth: "shallow", structuredOutput: false, toolCalling: false }),
      false,
    );
    expect(result).toBe("fast-extraction");
  });
});

describe("computeModelClassDowngrade — no invalid downgrade tests", () => {
  it("never recommends a downgrade to anything other than fast-extraction", () => {
    const result = computeModelClassDowngrade(
      reasoningProfile(),
      capabilities({ reasoningDepth: "shallow" }),
      false,
    );
    expect(result === undefined || result === "fast-extraction").toBe(true);
  });

  it("never recommends a downgrade for a profile whose top class isn't complex-reasoning", () => {
    const oddProfile = extractionProfile({ preferredModelClasses: ["creative"] });
    const result = computeModelClassDowngrade(
      oddProfile,
      capabilities({ reasoningDepth: "shallow" }),
      false,
    );
    expect(result).toBeUndefined();
  });

  it("never recommends a downgrade when reasoningRequired is true, even for shallow capabilities (defensive: caller-supplied inputs may disagree)", () => {
    const result = computeModelClassDowngrade(
      reasoningProfile(),
      capabilities({ reasoningDepth: "shallow" }),
      true,
    );
    expect(result).toBeUndefined();
  });

  it("never recommends a downgrade when structuredOutput is required, regardless of reasoning depth", () => {
    for (const reasoningDepth of ["shallow", "moderate", "deep"] as const) {
      const result = computeModelClassDowngrade(
        reasoningProfile(),
        capabilities({ reasoningDepth, structuredOutput: true }),
        reasoningDepth === "deep",
      );
      expect(result).toBeUndefined();
    }
  });

  it("never recommends a downgrade when toolCalling is required, regardless of reasoning depth", () => {
    for (const reasoningDepth of ["shallow", "moderate", "deep"] as const) {
      const result = computeModelClassDowngrade(
        reasoningProfile(),
        capabilities({ reasoningDepth, toolCalling: true }),
        reasoningDepth === "deep",
      );
      expect(result).toBeUndefined();
    }
  });
});
