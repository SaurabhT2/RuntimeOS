import type { Telemetry } from "@ai-gateway/telemetry";
import type {
  BudgetDecision,
  BudgetEnforcementMode,
  BudgetEnforcer,
  BudgetLedger,
  BudgetPolicy,
  BudgetPolicyProvider,
  BudgetTenantRef,
  BudgetThresholdAction,
} from "./types.js";

/**
 * architecture §43.2's `providerId` parameter has no natural value at this
 * pipeline position (§43.3: Budget Enforcer runs *before* the Policy Engine
 * has selected any candidate — there is no "the provider" yet). This
 * sentinel documents that `evaluate` was called without a specific provider
 * to scope a `perProviderSpendCapUsd` check against — the tenant-wide
 * `dailyBudgetUsd`/`monthlyBudgetUsd` checks still run in full; only the
 * per-provider cap check is skipped. See this package's README, "The
 * `providerId` parameter, before a provider is chosen," for the full
 * reasoning and the Draft ADR this milestone files about it.
 */
export const NO_PROVIDER_SELECTED_YET = "*";

export interface DefaultBudgetEnforcerOptions {
  ledger: BudgetLedger;
  policyProvider: BudgetPolicyProvider;
  telemetry: Telemetry;
  /** architecture Blueprint §7 EM-10: defaults to `"shadow"` — a fresh deployment enforces nothing until explicitly promoted. */
  mode?: BudgetEnforcementMode;
}

function percentOfBudget(spend: number, limit: number | undefined): number | undefined {
  if (limit === undefined || limit <= 0) {
    return undefined;
  }
  return (spend / limit) * 100;
}

/** Ordered low-to-high per architecture §43.2's own field doc; the highest-percent threshold that's actually been crossed determines the strongest action, but every crossed threshold is still recorded in `alertsTriggered`. */
function evaluateThresholds(
  thresholds: BudgetThresholdAction[],
  percentReached: number,
): { triggered: BudgetThresholdAction[]; strongestAction: BudgetThresholdAction | undefined } {
  const sorted = [...thresholds].sort((a, b) => a.atPercentOfBudget - b.atPercentOfBudget);
  const triggered = sorted.filter((t) => percentReached >= t.atPercentOfBudget);
  return { triggered, strongestAction: triggered.at(-1) };
}

/**
 * architecture §43: authoritative, cumulative spend enforcement — distinct
 * from the Cost Optimizer's (§33) advisory, single-request savings. See
 * this package's README for the full field-by-field mapping from a
 * `BudgetPolicy` breach to a `BudgetDecision`.
 *
 * **Shadow mode (Blueprint §7 EM-10):** `evaluate()` always computes the
 * real decision internally (so shadow-mode telemetry reflects the actual,
 * would-be-enforced outcome, not a stub) — in `"shadow"` mode (the
 * default), the *returned* decision has `allowed` forced to `true` and
 * `forcedModelClassDowngrade`/`forcedProviderExclusion` stripped, so a
 * shadow-mode deployment truly enforces nothing, while `gateway_budget_alert_total`/
 * a shadow-specific log line still records what *would* have happened.
 */
export class DefaultBudgetEnforcer implements BudgetEnforcer {
  private readonly ledger: BudgetLedger;
  private readonly policyProvider: BudgetPolicyProvider;
  private readonly telemetry: Telemetry;
  private readonly mode: BudgetEnforcementMode;

  constructor(options: DefaultBudgetEnforcerOptions) {
    this.ledger = options.ledger;
    this.policyProvider = options.policyProvider;
    this.telemetry = options.telemetry;
    this.mode = options.mode ?? "shadow";
  }

  async evaluate(
    tenant: BudgetTenantRef,
    plannedCostUsd: number,
    providerId: string,
  ): Promise<BudgetDecision> {
    const policy = await this.policyProvider.getPolicy(tenant);
    if (!policy) {
      // No configured policy: architecture §43.5's contract is that an
      // application never experiences Budget Governance unless a policy
      // was actually configured for it — the same "opt-in, orthogonal to
      // the simple path" principle architecture §45.5 states explicitly
      // for every v1.2 addition.
      return { allowed: true, alertsTriggered: [] };
    }

    const { decision: realDecision, drivingWindow } = await this.computeRealDecision(
      policy,
      plannedCostUsd,
      providerId,
    );

    if (this.mode === "shadow") {
      this.telemetry.log("info", "budget_governance.shadow_mode_decision", {
        tenant: tenant.organizationId,
        workspaceId: tenant.workspaceId,
        wouldHaveAllowed: realDecision.allowed,
        wouldHaveForcedModelClassDowngrade: realDecision.forcedModelClassDowngrade,
        wouldHaveForcedProviderExclusion: realDecision.forcedProviderExclusion,
      });
      for (const alert of realDecision.alertsTriggered) {
        this.emitAlertMetric(tenant, alert, drivingWindow);
      }
      // Shadow mode: "log what would have been blocked, block nothing"
      // (Blueprint §7 EM-10, verbatim) — nothing is enforced, regardless
      // of what the real decision computed.
      return { allowed: true, alertsTriggered: realDecision.alertsTriggered };
    }

    for (const alert of realDecision.alertsTriggered) {
      this.emitAlertMetric(tenant, alert, drivingWindow);
    }
    if (!realDecision.allowed) {
      this.telemetry.recordMetric("gateway_budget_block_total", 1, {
        tenant: tenant.organizationId,
      });
    }
    return realDecision;
  }

  private async computeRealDecision(
    policy: BudgetPolicy,
    plannedCostUsd: number,
    providerId: string,
  ): Promise<{ decision: BudgetDecision; drivingWindow: "day" | "month" }> {
    const dailySpend = await this.ledger.getSpend(policy.tenant, "day");
    const monthlySpend = await this.ledger.getSpend(policy.tenant, "month");
    const projectedDaily = dailySpend + plannedCostUsd;
    const projectedMonthly = monthlySpend + plannedCostUsd;

    const dailyPercent = percentOfBudget(projectedDaily, policy.dailyBudgetUsd);
    const monthlyPercent = percentOfBudget(projectedMonthly, policy.monthlyBudgetUsd);
    // The more constraining of the two windows wins — a tenant that's fine
    // on their monthly budget but about to blow their daily one should
    // still see the daily threshold's action.
    const percentReached = Math.max(dailyPercent ?? 0, monthlyPercent ?? 0);
    // (EM-10 Review Finding 2) Which window actually drove `percentReached`
    // — used only to tag `gateway_budget_alert_total`'s `window` label
    // correctly (architecture §43.6/ADR-015). A strict `>` (not `>=`)
    // means a tie, or a daily-only/monthly-only policy (the other side's
    // `percentOfBudget` is `undefined`, folded to `0` by `Math.max` above),
    // is attributed to "day" — the pre-existing, always-correct default
    // for the common single-window-configured case.
    const drivingWindow: "day" | "month" = (monthlyPercent ?? 0) > (dailyPercent ?? 0) ? "month" : "day";

    const { triggered, strongestAction } = evaluateThresholds(policy.thresholds, percentReached);

    let perProviderExceeded = false;
    if (providerId !== NO_PROVIDER_SELECTED_YET && policy.perProviderSpendCapUsd) {
      const cap = policy.perProviderSpendCapUsd[providerId];
      if (cap !== undefined) {
        const providerSpend = await this.ledger.getSpend(policy.tenant, "day", providerId);
        perProviderExceeded = providerSpend + plannedCostUsd > cap;
      }
    }

    // A per-provider cap breach with `switch_provider` configured *anywhere*
    // in this policy's thresholds excludes just that provider and lets the
    // request proceed — that is the entire point of "switch," as distinct
    // from "block." This is checked independently of the tenant-wide
    // percentage-based threshold ladder above: a provider-specific cap
    // breach is its own signal, not contingent on also, coincidentally,
    // crossing a tenant-wide percentage at the same moment. Any other
    // combination that breaches a cap (no `switch_provider` action
    // configured anywhere in this policy, or the tenant-wide `block`
    // threshold was also reached) is a hard block.
    const hasSwitchProviderAction = policy.thresholds.some((t) => t.action === "switch_provider");
    if (perProviderExceeded && hasSwitchProviderAction) {
      return {
        decision: {
          allowed: true,
          alertsTriggered: triggered,
          forcedProviderExclusion: [providerId],
          reason: "APPROACHING_LIMIT",
        },
        drivingWindow,
      };
    }
    if (perProviderExceeded || strongestAction?.action === "block") {
      return {
        decision: { allowed: false, alertsTriggered: triggered, reason: "BUDGET_EXCEEDED" },
        drivingWindow,
      };
    }

    const decision: BudgetDecision = { allowed: true, alertsTriggered: triggered };
    if (triggered.length > 0 && percentReached < 100) {
      decision.reason = "APPROACHING_LIMIT";
    }
    if (strongestAction?.action === "downgrade_model") {
      // No specific target class is derivable from a threshold action
      // alone (architecture §43.2's `BudgetThresholdAction` doesn't carry
      // one) — the deliberately conservative, always-safe choice is the
      // cheapest class this platform defines. See this package's README
      // for why this is a documented, reviewable default rather than a
      // per-policy configurable in this milestone.
      decision.forcedModelClassDowngrade = "fast-extraction";
    }
    return { decision, drivingWindow };
  }

  /**
   * architecture §43.6 / ADR-015: `gateway_budget_alert_total`, tagged
   * `tenant`, `percentOfBudget`, `window` — a distinct metric name and
   * label set from every provider-health/failover metric
   * (`gateway_failovers_total`, circuit-breaker gauges), verified by this
   * package's own dedicated test rather than assumed.
   *
   * (EM-10 Review Finding 2 fix) `window` must be the window that actually
   * drove this evaluation's `percentReached` (`computeRealDecision`'s
   * `drivingWindow`) — previously hardcoded to `"day"` regardless of
   * whether a monthly threshold was the one crossed, mislabeling every
   * monthly-driven alert.
   */
  private emitAlertMetric(
    tenant: BudgetTenantRef,
    alert: BudgetThresholdAction,
    window: "day" | "month",
  ): void {
    if (alert.action !== "alert") {
      // Non-"alert" actions (downgrade/switch/block) are still recorded
      // in `alertsTriggered` for observability, but §43.6 specifically
      // names `alert`-type actions as the metric's trigger — a downgrade
      // or block is its own, differently-named signal (recordMetric calls
      // above in `evaluate`), not double-counted here too.
      return;
    }
    this.telemetry.recordMetric("gateway_budget_alert_total", 1, {
      tenant: tenant.organizationId,
      percentOfBudget: String(alert.atPercentOfBudget),
      window,
    });
  }
}
