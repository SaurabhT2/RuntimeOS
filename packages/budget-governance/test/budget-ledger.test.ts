import { describe, expect, it } from "vitest";
import { InMemoryBudgetLedger } from "../src/budget-ledger.js";
import { tenant } from "./fixtures.js";

describe("InMemoryBudgetLedger", () => {
  it("accumulates spend for the same tenant/window", async () => {
    const ledger = new InMemoryBudgetLedger();
    const t = tenant();
    await ledger.recordSpend(t, "groq", 1.5);
    await ledger.recordSpend(t, "nvidia-nim", 2.5);
    expect(await ledger.getSpend(t, "day")).toBeCloseTo(4.0);
    expect(await ledger.getSpend(t, "month")).toBeCloseTo(4.0);
  });

  it("filters by providerId when given", async () => {
    const ledger = new InMemoryBudgetLedger();
    const t = tenant();
    await ledger.recordSpend(t, "groq", 1.5);
    await ledger.recordSpend(t, "nvidia-nim", 2.5);
    expect(await ledger.getSpend(t, "day", "groq")).toBeCloseTo(1.5);
    expect(await ledger.getSpend(t, "day", "nvidia-nim")).toBeCloseTo(2.5);
  });

  it("never shares spend between different tenants", async () => {
    const ledger = new InMemoryBudgetLedger();
    await ledger.recordSpend(tenant({ organizationId: "org-a" }), "groq", 10);
    await ledger.recordSpend(tenant({ organizationId: "org-b" }), "groq", 20);
    expect(await ledger.getSpend(tenant({ organizationId: "org-a" }), "day")).toBeCloseTo(10);
    expect(await ledger.getSpend(tenant({ organizationId: "org-b" }), "day")).toBeCloseTo(20);
  });

  it("never shares spend between the same organization's different workspaces", async () => {
    const ledger = new InMemoryBudgetLedger();
    await ledger.recordSpend(tenant({ workspaceId: "ws-1" }), "groq", 10);
    await ledger.recordSpend(tenant({ workspaceId: "ws-2" }), "groq", 20);
    expect(await ledger.getSpend(tenant({ workspaceId: "ws-1" }), "day")).toBeCloseTo(10);
    expect(await ledger.getSpend(tenant({ workspaceId: "ws-2" }), "day")).toBeCloseTo(20);
  });

  it("excludes spend recorded outside the current day window", async () => {
    let currentTime = new Date("2026-07-15T12:00:00.000Z");
    const ledger = new InMemoryBudgetLedger(() => currentTime);
    const t = tenant();
    await ledger.recordSpend(t, "groq", 5);
    currentTime = new Date("2026-07-16T12:00:00.000Z"); // next day
    await ledger.recordSpend(t, "groq", 7);
    expect(await ledger.getSpend(t, "day")).toBeCloseTo(7); // only the new day's spend
    expect(await ledger.getSpend(t, "month")).toBeCloseTo(12); // both, same month
  });

  it("excludes spend recorded outside the current month window", async () => {
    let currentTime = new Date("2026-06-30T12:00:00.000Z");
    const ledger = new InMemoryBudgetLedger(() => currentTime);
    const t = tenant();
    await ledger.recordSpend(t, "groq", 5);
    currentTime = new Date("2026-07-01T12:00:00.000Z"); // next month
    await ledger.recordSpend(t, "groq", 7);
    expect(await ledger.getSpend(t, "month")).toBeCloseTo(7);
  });

  it("returns 0 for a tenant with no recorded spend", async () => {
    const ledger = new InMemoryBudgetLedger();
    expect(await ledger.getSpend(tenant({ organizationId: "never-recorded" }), "day")).toBe(0);
  });
});
