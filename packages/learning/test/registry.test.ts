import { describe, expect, it } from "vitest";
import { NoopAdaptiveRankingStrategy } from "../src/adaptive-ranking-strategy.js";
import { NoopLearningSignalCollector } from "../src/learning-signal-collector.js";
import { DefaultLearningRegistry } from "../src/registry.js";

describe("DefaultLearningRegistry", () => {
  it("defaults to the no-op signal collector", () => {
    const registry = new DefaultLearningRegistry();
    expect(registry.getSignalCollector()).toBeInstanceOf(NoopLearningSignalCollector);
  });

  it("defaults to the no-op ranking strategy", () => {
    const registry = new DefaultLearningRegistry();
    expect(registry.getRankingStrategy()).toBeInstanceOf(NoopAdaptiveRankingStrategy);
  });

  it("allows registering a custom signal collector", () => {
    const registry = new DefaultLearningRegistry();
    const calls: unknown[] = [];
    const custom = { record: (outcome: unknown) => calls.push(outcome) };
    registry.setSignalCollector(custom);
    registry.getSignalCollector().record({} as never);
    expect(calls).toHaveLength(1);
  });

  it("allows registering a custom ranking strategy", () => {
    const registry = new DefaultLearningRegistry();
    const custom = {
      adjustWeights: () => ({ quality: 1, latency: 0, cost: 0, health: 0 }),
    };
    registry.setRankingStrategy(custom);
    expect(
      registry
        .getRankingStrategy()
        .adjustWeights({ quality: 0.4, latency: 0.25, cost: 0.2, health: 0.15 }, []),
    ).toEqual({ quality: 1, latency: 0, cost: 0, health: 0 });
  });

  it("reset() restores both sockets to their shipped no-op defaults", () => {
    const registry = new DefaultLearningRegistry();
    registry.setSignalCollector({ record: () => undefined });
    registry.setRankingStrategy({ adjustWeights: (base) => base });
    registry.reset();
    expect(registry.getSignalCollector()).toBeInstanceOf(NoopLearningSignalCollector);
    expect(registry.getRankingStrategy()).toBeInstanceOf(NoopAdaptiveRankingStrategy);
  });
});

describe("DefaultLearningRegistry — hasCustom*() answers architecture §36.3's gating question directly", () => {
  it("hasCustomRankingStrategy() is false by default", () => {
    const registry = new DefaultLearningRegistry();
    expect(registry.hasCustomRankingStrategy()).toBe(false);
  });

  it("hasCustomSignalCollector() is false by default", () => {
    const registry = new DefaultLearningRegistry();
    expect(registry.hasCustomSignalCollector()).toBe(false);
  });

  it("hasCustomRankingStrategy() becomes true after setRankingStrategy()", () => {
    const registry = new DefaultLearningRegistry();
    registry.setRankingStrategy({ adjustWeights: (base) => base });
    expect(registry.hasCustomRankingStrategy()).toBe(true);
  });

  it("hasCustomSignalCollector() becomes true after setSignalCollector()", () => {
    const registry = new DefaultLearningRegistry();
    registry.setSignalCollector({ record: () => undefined });
    expect(registry.hasCustomSignalCollector()).toBe(true);
  });

  it("reset() clears both hasCustom*() flags back to false", () => {
    const registry = new DefaultLearningRegistry();
    registry.setSignalCollector({ record: () => undefined });
    registry.setRankingStrategy({ adjustWeights: (base) => base });
    registry.reset();
    expect(registry.hasCustomSignalCollector()).toBe(false);
    expect(registry.hasCustomRankingStrategy()).toBe(false);
  });
});
