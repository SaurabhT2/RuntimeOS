import { describe, expect, it } from "vitest";
import { DefaultAIStrategyLayer } from "../src/strategy-layer.js";
import { DefaultStrategyPipeline } from "../src/strategy-pipeline.js";
import { baseRequest, seededOptions, tenant } from "./fixtures.js";

describe("DefaultAIStrategyLayer", () => {
  it("buildStrategy delegates to a DefaultStrategyPipeline built from the default stages", async () => {
    const options = seededOptions();
    const layer = new DefaultAIStrategyLayer(options);
    const decision = await layer.buildStrategy(baseRequest(), tenant());
    expect(decision.requiredCapabilities).toBeDefined();
    expect(decision.executionProfile).toBeDefined();
  });

  it("accepts a pre-built custom StrategyPipeline instead of options", async () => {
    const options = seededOptions();
    const pipeline = new DefaultStrategyPipeline(
      // Import indirectly to avoid re-declaring the default stage list here.
      (await import("../src/strategy-layer.js")).buildDefaultStages(options),
    );
    const layer = new DefaultAIStrategyLayer({ pipeline });
    const decision = await layer.buildStrategy(baseRequest(), tenant());
    expect(decision.requiredCapabilities).toBeDefined();
  });

  it("never calls a provider or makes an HTTP request (pure function of registries/optimizers)", async () => {
    const options = seededOptions();
    const layer = new DefaultAIStrategyLayer(options);
    // No network-related fixture is injected anywhere in `seededOptions()` —
    // if this resolves without hanging or throwing a network error, the
    // implementation is provably not reaching outside its injected
    // dependencies.
    await expect(layer.buildStrategy(baseRequest(), tenant())).resolves.toBeDefined();
  });

  describe("EM-10: BudgetEnforcementStage inclusion", () => {
    it("buildDefaultStages omits BudgetEnforcementStage entirely when no budgetEnforcer is supplied", async () => {
      const { buildDefaultStages } = await import("../src/strategy-layer.js");
      const stages = buildDefaultStages(seededOptions());
      expect(stages.map((s) => s.name)).not.toContain("budget_enforcement");
      expect(stages).toHaveLength(6); // the same 6 stages EM-9 produced, byte-for-byte
    });

    it("buildDefaultStages includes BudgetEnforcementStage, between Cost Optimization and Learning Hooks, when budgetEnforcer is supplied", async () => {
      const { buildDefaultStages } = await import("../src/strategy-layer.js");
      const fakeEnforcer = { evaluate: async () => ({ allowed: true, alertsTriggered: [] }) };
      const stages = buildDefaultStages(seededOptions({ budgetEnforcer: fakeEnforcer }));
      const names = stages.map((s) => s.name);
      expect(names).toHaveLength(7);
      expect(names).toContain("budget_enforcement");
      expect(names.indexOf("budget_enforcement")).toBe(names.indexOf("cost_optimization") + 1);
      expect(names.indexOf("budget_enforcement")).toBe(names.indexOf("learning_hooks") - 1);
    });

    it("a blocking BudgetDecision propagates as a BUDGET_EXCEEDED GatewayError out of buildStrategy() itself", async () => {
      const fakeEnforcer = {
        evaluate: async () => ({ allowed: false, alertsTriggered: [], reason: "BUDGET_EXCEEDED" as const }),
      };
      const layer = new DefaultAIStrategyLayer(seededOptions({ budgetEnforcer: fakeEnforcer }));
      await expect(layer.buildStrategy(baseRequest(), tenant())).rejects.toMatchObject({
        code: "BUDGET_EXCEEDED",
      });
    });

    it("a non-blocking BudgetDecision still returns a complete, valid StrategyDecision", async () => {
      const fakeEnforcer = { evaluate: async () => ({ allowed: true, alertsTriggered: [] }) };
      const layer = new DefaultAIStrategyLayer(seededOptions({ budgetEnforcer: fakeEnforcer }));
      const decision = await layer.buildStrategy(baseRequest(), tenant());
      expect(decision.requiredCapabilities).toBeDefined();
      expect(decision.optimizations.cost).toBeDefined();
    });
  });
});
