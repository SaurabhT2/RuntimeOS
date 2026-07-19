import type { Telemetry } from "@ai-gateway/telemetry";
import { vi } from "vitest";
import type { BudgetPolicy, BudgetTenantRef } from "../src/types.js";

export function tenant(overrides: Partial<BudgetTenantRef> = {}): BudgetTenantRef {
  return { organizationId: "org-1", ...overrides };
}

export function fakeTelemetry(): Telemetry {
  return {
    startSpan: vi.fn(() => ({ setStatus: vi.fn(), end: vi.fn() }) as never),
    recordMetric: vi.fn(),
    log: vi.fn(),
  };
}

export function basePolicy(overrides: Partial<BudgetPolicy> = {}): BudgetPolicy {
  return {
    tenant: tenant(),
    dailyBudgetUsd: 100,
    monthlyBudgetUsd: 2000,
    thresholds: [
      { atPercentOfBudget: 80, action: "alert" },
      { atPercentOfBudget: 100, action: "block" },
    ],
    ...overrides,
  };
}
