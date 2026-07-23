import { GatewayError } from "@ai-gateway/core-contracts";
import type {
  BudgetDecision,
  BudgetEnforcer,
  BudgetTenantRef,
} from "@ai-gateway/budget-governance";
import { NO_PROVIDER_SELECTED_YET } from "@ai-gateway/budget-governance";
import { describe, expect, it, vi } from "vitest";
import { BudgetEnforcementStage } from "../../src/stages/budget-enforcement-stage.js";
import type { StrategyContext } from "../../src/types.js";
import { baseRequest, tenant } from "../fixtures.js";

function fakeEnforcer(decision: BudgetDecision): BudgetEnforcer & {
  calls: Array<{ tenant: BudgetTenantRef; plannedCostUsd: number; providerId: string }>;
} {
  const calls: Array<{ tenant: BudgetTenantRef; plannedCostUsd: number; providerId: string }> = [];
  return {
    calls,
    evaluate: vi.fn(async (t, plannedCostUsd, providerId) => {
      calls.push({ tenant: t, plannedCostUsd, providerId });
      return decision;
    }),
  };
}

function baseCtx(overrides: Partial<StrategyContext> = {}): StrategyContext {
  return {
    request: baseRequest(),
    tenant: tenant(),
    costOptimization: {
      recommendedModelClassDowngrade: undefined,
      disableStreaming: false,
      preferFreeTierProviders: false,
      estimatedCostUsd: 0.05,
      estimatedSavingsUsd: 0,
    },
    ...overrides,
  };
}

describe("BudgetEnforcementStage", () => {
  it("passes the ctx tenant, the cost-optimized estimate, and NO_PROVIDER_SELECTED_YET to evaluate()", async () => {
    const enforcer = fakeEnforcer({ allowed: true, alertsTriggered: [] });
    const stage = new BudgetEnforcementStage(enforcer);
    await stage.run(baseCtx({ tenant: tenant({ organizationId: "org-9" }) }));
    expect(enforcer.calls).toEqual([
      {
        tenant: { organizationId: "org-9" },
        plannedCostUsd: 0.05,
        providerId: NO_PROVIDER_SELECTED_YET,
      },
    ]);
  });

  it("passes 0 as plannedCostUsd when ctx.costOptimization is absent", async () => {
    const enforcer = fakeEnforcer({ allowed: true, alertsTriggered: [] });
    const stage = new BudgetEnforcementStage(enforcer);
    await stage.run(baseCtx({ costOptimization: undefined }));
    expect(enforcer.calls[0]?.plannedCostUsd).toBe(0);
  });

  it("throws a BUDGET_EXCEEDED GatewayError when the decision is not allowed", async () => {
    const enforcer = fakeEnforcer({
      allowed: false,
      alertsTriggered: [],
      reason: "BUDGET_EXCEEDED",
    });
    const stage = new BudgetEnforcementStage(enforcer);
    await expect(stage.run(baseCtx())).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
    await expect(stage.run(baseCtx())).rejects.toBeInstanceOf(GatewayError);
  });

  it("the thrown GatewayError is non-retryable", async () => {
    const enforcer = fakeEnforcer({ allowed: false, alertsTriggered: [] });
    const stage = new BudgetEnforcementStage(enforcer);
    try {
      await stage.run(baseCtx());
      expect.unreachable();
    } catch (error) {
      expect((error as GatewayError).retryable).toBe(false);
    }
  });

  it("returns ctx unchanged when allowed and no forced downgrade", async () => {
    const enforcer = fakeEnforcer({ allowed: true, alertsTriggered: [] });
    const stage = new BudgetEnforcementStage(enforcer);
    const ctx = baseCtx();
    const result = await stage.run(ctx);
    expect(result).toEqual(ctx);
  });

  it("overrides ctx.costOptimization.recommendedModelClassDowngrade when the decision forces one", async () => {
    const enforcer = fakeEnforcer({
      allowed: true,
      alertsTriggered: [],
      forcedModelClassDowngrade: "fast-extraction",
    });
    const stage = new BudgetEnforcementStage(enforcer);
    const ctx = baseCtx({
      costOptimization: {
        recommendedModelClassDowngrade: "complex-reasoning", // Cost Optimizer's own advisory pick
        disableStreaming: false,
        preferFreeTierProviders: false,
        estimatedCostUsd: 0.05,
        estimatedSavingsUsd: 0,
      },
    });
    const result = await stage.run(ctx);
    // Budget Governance's forced downgrade overrides Cost Optimizer's own
    // advisory recommendation outright (architecture §43.1: authoritative).
    expect(result.costOptimization?.recommendedModelClassDowngrade).toBe("fast-extraction");
  });

  it("does not crash if a forced downgrade is present but ctx.costOptimization is absent", async () => {
    const enforcer = fakeEnforcer({
      allowed: true,
      alertsTriggered: [],
      forcedModelClassDowngrade: "fast-extraction",
    });
    const stage = new BudgetEnforcementStage(enforcer);
    const result = await stage.run(baseCtx({ costOptimization: undefined }));
    expect(result.costOptimization).toBeUndefined();
  });

  it("preserves every other field of costOptimization when overriding the downgrade", async () => {
    const enforcer = fakeEnforcer({
      allowed: true,
      alertsTriggered: [],
      forcedModelClassDowngrade: "fast-extraction",
    });
    const stage = new BudgetEnforcementStage(enforcer);
    const ctx = baseCtx({
      costOptimization: {
        recommendedModelClassDowngrade: undefined,
        disableStreaming: true,
        preferFreeTierProviders: true,
        estimatedCostUsd: 0.09,
        estimatedSavingsUsd: 0.02,
      },
    });
    const result = await stage.run(ctx);
    expect(result.costOptimization).toMatchObject({
      disableStreaming: true,
      preferFreeTierProviders: true,
      estimatedCostUsd: 0.09,
      estimatedSavingsUsd: 0.02,
      recommendedModelClassDowngrade: "fast-extraction",
    });
  });
});
