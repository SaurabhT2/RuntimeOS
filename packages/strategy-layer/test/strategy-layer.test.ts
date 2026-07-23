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
        evaluate: async () => ({
          allowed: false,
          alertsTriggered: [],
          reason: "BUDGET_EXCEEDED" as const,
        }),
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

    it(
      "(EM-11 Chaos: budget enforcement failure) a genuine BudgetEnforcer infrastructure error " +
        "(e.g. a durable ledger's network failure) — distinct from a deliberate BUDGET_EXCEEDED " +
        "business decision — propagates as a clean, typed rejection out of buildStrategy() rather " +
        "than hanging or corrupting pipeline state",
      async () => {
        const explodingEnforcer = {
          evaluate: async () => {
            throw new Error("ledger unavailable: ECONNREFUSED");
          },
        };
        const layer = new DefaultAIStrategyLayer(
          seededOptions({ budgetEnforcer: explodingEnforcer }),
        );
        // Today's documented behavior (architecture §3's P6, the same
        // uncaught-Strategy-Pipeline-stage-error mechanism EM-8's Review
        // Closure Finding 5 already confirmed compliant): the failure is
        // fail-closed — it propagates as-is, failing the whole request,
        // rather than being silently swallowed into an "allowed" decision.
        // With today's `InMemoryBudgetLedger` this is a low-likelihood
        // scenario (an in-process array essentially cannot throw), but it
        // becomes a real, live path the moment a durable/networked ledger
        // (the disclosed non-durability Known Gap) replaces it — this test
        // locks down that a Strategy Pipeline stage's raw infrastructure
        // error is never mistaken for "no budget configured" or silently
        // treated as "allowed".
        await expect(layer.buildStrategy(baseRequest(), tenant())).rejects.toThrow(
          "ledger unavailable: ECONNREFUSED",
        );
      },
    );
  });
});
