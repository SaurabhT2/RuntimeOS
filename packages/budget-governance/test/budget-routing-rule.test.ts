import { describe, expect, it } from "vitest";
import { budgetProviderExclusionRule } from "../src/budget-routing-rule.js";
import type { PolicyContextWithBudgetDecision } from "../src/budget-routing-rule.js";
import type { ScoredCandidate } from "@ai-gateway/policy-engine";

function candidate(providerId: string): ScoredCandidate {
  return {
    providerId,
    modelId: `${providerId}-model`,
    modelClass: "fast-extraction",
    score: 0.5,
    breakdown: { quality: 0.5, latency: 0.5, cost: 0.5, health: 0.5, rateLimitPenalty: 0 },
    contextWindow: 32_000,
    structuredOutput: true,
    toolCalling: false,
    streaming: true,
  };
}

describe("budgetProviderExclusionRule", () => {
  it("does not apply when ctx.budgetDecision is absent", () => {
    expect(budgetProviderExclusionRule.applies({})).toBe(false);
  });

  it("does not apply when forcedProviderExclusion is absent or empty", () => {
    const ctx: PolicyContextWithBudgetDecision = {
      budgetDecision: { allowed: true, alertsTriggered: [] },
    };
    expect(budgetProviderExclusionRule.applies(ctx)).toBe(false);

    const ctxEmpty: PolicyContextWithBudgetDecision = {
      budgetDecision: { allowed: true, alertsTriggered: [], forcedProviderExclusion: [] },
    };
    expect(budgetProviderExclusionRule.applies(ctxEmpty)).toBe(false);
  });

  it("applies when forcedProviderExclusion is non-empty", () => {
    const ctx: PolicyContextWithBudgetDecision = {
      budgetDecision: { allowed: true, alertsTriggered: [], forcedProviderExclusion: ["groq"] },
    };
    expect(budgetProviderExclusionRule.applies(ctx)).toBe(true);
  });

  it("filters out the excluded provider's candidates", () => {
    const ctx: PolicyContextWithBudgetDecision = {
      budgetDecision: { allowed: true, alertsTriggered: [], forcedProviderExclusion: ["groq"] },
    };
    const candidates = [candidate("groq"), candidate("nvidia-nim")];
    const result = budgetProviderExclusionRule.apply(candidates, ctx);
    expect(result.map((c) => c.providerId)).toEqual(["nvidia-nim"]);
  });

  it("never empties the candidate list entirely — falls back to the unfiltered set", () => {
    const ctx: PolicyContextWithBudgetDecision = {
      budgetDecision: {
        allowed: true,
        alertsTriggered: [],
        forcedProviderExclusion: ["groq", "nvidia-nim"],
      },
    };
    const candidates = [candidate("groq"), candidate("nvidia-nim")];
    const result = budgetProviderExclusionRule.apply(candidates, ctx);
    expect(result).toEqual(candidates);
  });

  it("is a no-op passthrough when no exclusion is set", () => {
    const candidates = [candidate("groq"), candidate("nvidia-nim")];
    const result = budgetProviderExclusionRule.apply(candidates, {});
    expect(result).toEqual(candidates);
  });
});
