import { describe, expect, it, type Mock } from "vitest";
import { InMemoryBudgetLedger } from "../src/budget-ledger.js";
import { DefaultBudgetEnforcer, NO_PROVIDER_SELECTED_YET } from "../src/budget-enforcer.js";
import { StaticBudgetPolicyProvider } from "../src/budget-policy-provider.js";
import { basePolicy, fakeTelemetry, tenant } from "./fixtures.js";

function buildEnforcer(
  policy = basePolicy(),
  mode: "shadow" | "enforcing" = "enforcing",
  telemetry = fakeTelemetry(),
) {
  const ledger = new InMemoryBudgetLedger();
  const policyProvider = new StaticBudgetPolicyProvider([policy]);
  const enforcer = new DefaultBudgetEnforcer({ ledger, policyProvider, telemetry, mode });
  return { enforcer, ledger, telemetry };
}

describe("DefaultBudgetEnforcer — no policy configured", () => {
  it("allows everything when the tenant has no configured BudgetPolicy", async () => {
    const { enforcer } = buildEnforcer(
      basePolicy({ tenant: tenant({ organizationId: "no-policy" }) }),
    );
    const decision = await enforcer.evaluate(
      tenant({ organizationId: "unconfigured" }),
      10,
      "groq",
    );
    expect(decision).toEqual({ allowed: true, alertsTriggered: [] });
  });
});

describe("DefaultBudgetEnforcer — enforcing mode", () => {
  it("allows a request well under every threshold", async () => {
    const { enforcer } = buildEnforcer();
    const decision = await enforcer.evaluate(tenant(), 1, "groq"); // 1% of a $100 daily budget
    expect(decision.allowed).toBe(true);
    expect(decision.alertsTriggered).toEqual([]);
  });

  it("triggers an 'alert' action without blocking", async () => {
    const { enforcer } = buildEnforcer(
      basePolicy({ thresholds: [{ atPercentOfBudget: 50, action: "alert" }] }),
    );
    const decision = await enforcer.evaluate(tenant(), 60, "groq"); // 60% of $100
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("APPROACHING_LIMIT");
    expect(decision.alertsTriggered).toEqual([{ atPercentOfBudget: 50, action: "alert" }]);
  });

  it("blocks once a 'block' threshold is reached, with BUDGET_EXCEEDED", async () => {
    const { enforcer } = buildEnforcer(); // block at 100%
    const decision = await enforcer.evaluate(tenant(), 100, "groq"); // exactly 100% of $100
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("BUDGET_EXCEEDED");
  });

  it("forces a model class downgrade on a 'downgrade_model' threshold", async () => {
    const { enforcer } = buildEnforcer(
      basePolicy({ thresholds: [{ atPercentOfBudget: 70, action: "downgrade_model" }] }),
    );
    const decision = await enforcer.evaluate(tenant(), 80, "groq");
    expect(decision.allowed).toBe(true);
    expect(decision.forcedModelClassDowngrade).toBe("fast-extraction");
  });

  it("the more constraining of daily vs monthly wins", async () => {
    const { enforcer } = buildEnforcer(
      basePolicy({
        dailyBudgetUsd: 10, // this request alone is already 100% of the daily budget
        monthlyBudgetUsd: 10_000, // but a tiny fraction of the monthly budget
        thresholds: [{ atPercentOfBudget: 100, action: "block" }],
      }),
    );
    const decision = await enforcer.evaluate(tenant(), 10, "groq");
    expect(decision.allowed).toBe(false); // daily blows past 100%, monthly doesn't — daily wins
  });

  it("perProviderSpendCapUsd blocks even when the tenant-wide budget is untouched", async () => {
    const { enforcer } = buildEnforcer(
      basePolicy({
        dailyBudgetUsd: 100_000, // effectively unlimited tenant-wide
        perProviderSpendCapUsd: { groq: 5 },
        thresholds: [],
      }),
    );
    const decision = await enforcer.evaluate(tenant(), 10, "groq"); // exceeds groq's own $5 cap
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("BUDGET_EXCEEDED");
  });

  it("perProviderSpendCapUsd is skipped (not violated) when providerId is NO_PROVIDER_SELECTED_YET", async () => {
    const { enforcer } = buildEnforcer(
      basePolicy({
        dailyBudgetUsd: 100_000,
        perProviderSpendCapUsd: { groq: 5 },
        thresholds: [],
      }),
    );
    const decision = await enforcer.evaluate(tenant(), 10, NO_PROVIDER_SELECTED_YET);
    expect(decision.allowed).toBe(true);
  });

  it("switch_provider excludes just the over-cap provider and lets the request proceed (not a hard block)", async () => {
    const { enforcer } = buildEnforcer(
      basePolicy({
        dailyBudgetUsd: 100_000, // effectively unlimited tenant-wide
        perProviderSpendCapUsd: { groq: 5 },
        thresholds: [{ atPercentOfBudget: 1, action: "switch_provider" }],
      }),
    );
    const decision = await enforcer.evaluate(tenant(), 10, "groq"); // exceeds groq's own $5 cap
    expect(decision.allowed).toBe(true);
    expect(decision.forcedProviderExclusion).toEqual(["groq"]);
  });

  it("a per-provider cap breach with no switch_provider threshold configured is a hard block, not an exclusion", async () => {
    const { enforcer } = buildEnforcer(
      basePolicy({
        dailyBudgetUsd: 100_000,
        perProviderSpendCapUsd: { groq: 5 },
        thresholds: [], // no switch_provider action configured
      }),
    );
    const decision = await enforcer.evaluate(tenant(), 10, "groq");
    expect(decision.allowed).toBe(false);
    expect(decision.forcedProviderExclusion).toBeUndefined();
  });

  it("accumulates spend already recorded in the ledger before evaluating a new request", async () => {
    const { enforcer, ledger } = buildEnforcer(
      basePolicy({
        dailyBudgetUsd: 100,
        thresholds: [{ atPercentOfBudget: 100, action: "block" }],
      }),
    );
    await ledger.recordSpend(tenant(), "groq", 90);
    const decision = await enforcer.evaluate(tenant(), 20, "groq"); // 90 + 20 = 110% of $100
    expect(decision.allowed).toBe(false);
  });
});

describe("DefaultBudgetEnforcer — shadow mode (Blueprint §7 EM-10 default)", () => {
  it("never blocks, even when the real decision would have", async () => {
    const { enforcer } = buildEnforcer(basePolicy(), "shadow");
    const decision = await enforcer.evaluate(tenant(), 100, "groq"); // would block in enforcing mode
    expect(decision.allowed).toBe(true);
  });

  it("never returns a forced constraint, even when the real decision would have", async () => {
    const { enforcer } = buildEnforcer(
      basePolicy({ thresholds: [{ atPercentOfBudget: 70, action: "downgrade_model" }] }),
      "shadow",
    );
    const decision = await enforcer.evaluate(tenant(), 80, "groq");
    expect(decision.forcedModelClassDowngrade).toBeUndefined();
  });

  it("still logs what would have happened", async () => {
    const { enforcer, telemetry } = buildEnforcer(basePolicy(), "shadow");
    await enforcer.evaluate(tenant(), 100, "groq");
    expect(telemetry.log).toHaveBeenCalledWith(
      "info",
      "budget_governance.shadow_mode_decision",
      expect.objectContaining({ wouldHaveAllowed: false }),
    );
  });

  it("still records alertsTriggered on the returned decision", async () => {
    const { enforcer } = buildEnforcer(
      basePolicy({ thresholds: [{ atPercentOfBudget: 50, action: "alert" }] }),
      "shadow",
    );
    const decision = await enforcer.evaluate(tenant(), 60, "groq");
    expect(decision.alertsTriggered).toEqual([{ atPercentOfBudget: 50, action: "alert" }]);
  });

  it("defaults to shadow mode when `mode` is omitted entirely", async () => {
    const ledger = new InMemoryBudgetLedger();
    const policyProvider = new StaticBudgetPolicyProvider([basePolicy()]);
    const enforcer = new DefaultBudgetEnforcer({
      ledger,
      policyProvider,
      telemetry: fakeTelemetry(),
    });
    const decision = await enforcer.evaluate(tenant(), 100, "groq");
    expect(decision.allowed).toBe(true); // would have blocked in enforcing mode
  });
});

describe("DefaultBudgetEnforcer — telemetry (architecture §43.6 / ADR-015)", () => {
  it("emits gateway_budget_alert_total for an 'alert' threshold, tagged tenant/percentOfBudget/window", async () => {
    const { enforcer, telemetry } = buildEnforcer(
      basePolicy({ thresholds: [{ atPercentOfBudget: 50, action: "alert" }] }),
    );
    await enforcer.evaluate(tenant(), 60, "groq");
    expect(telemetry.recordMetric).toHaveBeenCalledWith("gateway_budget_alert_total", 1, {
      tenant: "org-1",
      percentOfBudget: "50",
      window: "day",
    });
  });

  it("(EM-10 Review Finding 2) emits window: 'month' when the monthly threshold, not the daily one, drove the alert", async () => {
    const { enforcer, telemetry } = buildEnforcer(
      basePolicy({
        dailyBudgetUsd: 100_000, // effectively unlimited for this request
        monthlyBudgetUsd: 100,
        thresholds: [{ atPercentOfBudget: 50, action: "alert" }],
      }),
    );
    // 60% of the $100 monthly budget, ~0.06% of the $100,000 daily budget —
    // only the monthly window is anywhere near its threshold.
    await enforcer.evaluate(tenant(), 60, "groq");
    expect(telemetry.recordMetric).toHaveBeenCalledWith("gateway_budget_alert_total", 1, {
      tenant: "org-1",
      percentOfBudget: "50",
      window: "month",
    });
  });

  it("emits gateway_budget_block_total on a block, and never gateway_failovers_total or any circuit-breaker metric name", async () => {
    const { enforcer, telemetry } = buildEnforcer();
    await enforcer.evaluate(tenant(), 100, "groq");
    expect(telemetry.recordMetric).toHaveBeenCalledWith(
      "gateway_budget_block_total",
      1,
      expect.objectContaining({ tenant: "org-1" }),
    );
    const allMetricNames = (telemetry.recordMetric as Mock).mock.calls.map((c: unknown[]) => c[0]);
    expect(allMetricNames).not.toContain("gateway_failovers_total");
    expect(allMetricNames.every((n: string) => n.startsWith("gateway_budget_"))).toBe(true);
  });

  it("does not emit gateway_budget_alert_total for non-'alert' actions (downgrade/switch/block have their own signals)", async () => {
    const { enforcer, telemetry } = buildEnforcer(
      basePolicy({ thresholds: [{ atPercentOfBudget: 70, action: "downgrade_model" }] }),
    );
    await enforcer.evaluate(tenant(), 80, "groq");
    expect(telemetry.recordMetric).not.toHaveBeenCalledWith(
      "gateway_budget_alert_total",
      expect.anything(),
      expect.anything(),
    );
  });
});

describe("DefaultBudgetEnforcer — edge cases", () => {
  it("a policy with dailyBudgetUsd: 0 is treated as 'no limit configured', not 'always blocked'", async () => {
    const { enforcer } = buildEnforcer(
      basePolicy({
        dailyBudgetUsd: 0,
        monthlyBudgetUsd: 1000,
        thresholds: [{ atPercentOfBudget: 100, action: "block" }],
      }),
    );
    const decision = await enforcer.evaluate(tenant(), 5, "groq");
    expect(decision.allowed).toBe(true); // dailyBudgetUsd: 0 is skipped; only monthlyBudgetUsd (1000) is evaluated
  });
});
