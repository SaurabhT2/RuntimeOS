import { describe, expect, it } from "vitest";
import { NoopAdaptiveRankingStrategy } from "../src/adaptive-ranking-strategy.js";
import { baseWeights } from "./fixtures.js";

describe("NoopAdaptiveRankingStrategy", () => {
  it("returns weights equal in value to the base weights, given no history", () => {
    const strategy = new NoopAdaptiveRankingStrategy();
    expect(strategy.adjustWeights(baseWeights, [])).toEqual(baseWeights);
  });

  it("returns weights equal in value to the base weights, regardless of history content", () => {
    const strategy = new NoopAdaptiveRankingStrategy();
    const history = [
      {
        requestId: "r1",
        providerId: "groq",
        modelId: "m1",
        modelClass: "fast-extraction",
        task: "summarization",
        latencyMs: 100,
        success: true,
        costUsd: 0.01,
      },
    ];
    expect(strategy.adjustWeights(baseWeights, history)).toEqual(baseWeights);
  });

  it("does not return the same object reference as base (defensive copy)", () => {
    const strategy = new NoopAdaptiveRankingStrategy();
    const result = strategy.adjustWeights(baseWeights, []);
    expect(result).not.toBe(baseWeights);
  });

  it("does not mutate the base weights object", () => {
    const strategy = new NoopAdaptiveRankingStrategy();
    const snapshot = { ...baseWeights };
    strategy.adjustWeights(baseWeights, []);
    expect(baseWeights).toEqual(snapshot);
  });
});
