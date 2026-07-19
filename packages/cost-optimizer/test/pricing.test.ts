import { describe, expect, it } from "vitest";
import { costPer1kTokensUsd, estimateCostUsd } from "../src/pricing.js";

describe("costPer1kTokensUsd", () => {
  it("orders the three seed-aligned model classes fast-extraction < creative < complex-reasoning", () => {
    const fast = costPer1kTokensUsd("fast-extraction");
    const creative = costPer1kTokensUsd("creative");
    const reasoning = costPer1kTokensUsd("complex-reasoning");
    expect(fast).toBeLessThan(creative);
    expect(creative).toBeLessThan(reasoning);
  });

  it("falls back to a default rate for an unknown model class", () => {
    expect(costPer1kTokensUsd("some-future-class")).toBeGreaterThan(0);
  });
});

describe("estimateCostUsd", () => {
  it("scales linearly with token estimate", () => {
    const at1k = estimateCostUsd("fast-extraction", 1_000);
    const at2k = estimateCostUsd("fast-extraction", 2_000);
    expect(at2k).toBeCloseTo(at1k * 2, 10);
  });

  it("is zero for zero tokens", () => {
    expect(estimateCostUsd("complex-reasoning", 0)).toBe(0);
  });
});
