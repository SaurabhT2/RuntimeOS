import { NoopAdaptiveRankingStrategy, NoopLearningSignalCollector } from "@ai-gateway/learning";
import { describe, expect, it, vi } from "vitest";
import { LearningHookStage } from "../../src/stages/learning-hook-stage.js";
import { baseRequest, seededOptions, tenant } from "../fixtures.js";

describe("LearningHookStage", () => {
  it("is a no-op — returns the context unchanged", async () => {
    const options = seededOptions();
    const stage = new LearningHookStage(options.learningRegistry);
    const ctx = { request: baseRequest(), tenant: tenant() };
    const result = await stage.run(ctx);
    expect(result).toEqual(ctx);
  });

  it("does not call collector.record() (no ExecutionOutcome exists at this pipeline stage)", async () => {
    const collector = new NoopLearningSignalCollector();
    const recordSpy = vi.spyOn(collector, "record");
    const options = seededOptions();
    options.learningRegistry.setSignalCollector(collector);
    const stage = new LearningHookStage(options.learningRegistry);
    await stage.run({ request: baseRequest(), tenant: tenant() });
    expect(recordSpy).not.toHaveBeenCalled();
  });

  it("touches getSignalCollector() and getRankingStrategy() to confirm the registry resolves", async () => {
    const options = seededOptions();
    const getCollectorSpy = vi.spyOn(options.learningRegistry, "getSignalCollector");
    const getStrategySpy = vi.spyOn(options.learningRegistry, "getRankingStrategy");
    const stage = new LearningHookStage(options.learningRegistry);
    await stage.run({ request: baseRequest(), tenant: tenant() });
    expect(getCollectorSpy).toHaveBeenCalled();
    expect(getStrategySpy).toHaveBeenCalled();
  });

  it("works with the shipped no-op defaults with zero configuration", async () => {
    const options = seededOptions();
    expect(options.learningRegistry.getSignalCollector()).toBeInstanceOf(
      NoopLearningSignalCollector,
    );
    expect(options.learningRegistry.getRankingStrategy()).toBeInstanceOf(
      NoopAdaptiveRankingStrategy,
    );
    const stage = new LearningHookStage(options.learningRegistry);
    await expect(stage.run({ request: baseRequest(), tenant: tenant() })).resolves.toBeDefined();
  });
});
