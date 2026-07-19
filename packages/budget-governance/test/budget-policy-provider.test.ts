import { InMemoryConfigSource } from "@ai-gateway/config";
import { describe, expect, it } from "vitest";
import {
  ConfigBackedBudgetPolicyProvider,
  StaticBudgetPolicyProvider,
  budgetPolicyListSchema,
} from "../src/budget-policy-provider.js";
import { basePolicy, tenant } from "./fixtures.js";

describe("StaticBudgetPolicyProvider", () => {
  it("returns the configured policy for a matching tenant", async () => {
    const policy = basePolicy();
    const provider = new StaticBudgetPolicyProvider([policy]);
    expect(await provider.getPolicy(tenant())).toEqual(policy);
  });

  it("returns undefined for a tenant with no configured policy", async () => {
    const provider = new StaticBudgetPolicyProvider([basePolicy()]);
    expect(await provider.getPolicy(tenant({ organizationId: "unconfigured" }))).toBeUndefined();
  });

  it("distinguishes an organization-level policy from a workspace-level one", async () => {
    const orgPolicy = basePolicy({ tenant: tenant() });
    const workspacePolicy = basePolicy({ tenant: tenant({ workspaceId: "ws-1" }), dailyBudgetUsd: 5 });
    const provider = new StaticBudgetPolicyProvider([orgPolicy, workspacePolicy]);
    expect(await provider.getPolicy(tenant())).toEqual(orgPolicy);
    expect(await provider.getPolicy(tenant({ workspaceId: "ws-1" }))).toEqual(workspacePolicy);
  });
});

describe("ConfigBackedBudgetPolicyProvider", () => {
  it("reads and validates a policy list from a ConfigSource", async () => {
    const policy = basePolicy();
    const source = new InMemoryConfigSource([policy]);
    const provider = new ConfigBackedBudgetPolicyProvider(source);
    expect(await provider.getPolicy(tenant())).toEqual(policy);
  });

  it("caches the parsed result across calls (does not re-read every time)", async () => {
    const policy = basePolicy();
    const source = new InMemoryConfigSource([policy]);
    const readSpy = source.read.bind(source);
    let readCount = 0;
    source.read = async () => {
      readCount += 1;
      return readSpy();
    };
    const provider = new ConfigBackedBudgetPolicyProvider(source);
    await provider.getPolicy(tenant());
    await provider.getPolicy(tenant());
    await provider.getPolicy(tenant());
    expect(readCount).toBe(1);
  });

  it("invalidates the cache when the ConfigSource reports a change", async () => {
    const source = new InMemoryConfigSource([basePolicy({ dailyBudgetUsd: 100 })]);
    const provider = new ConfigBackedBudgetPolicyProvider(source);
    expect((await provider.getPolicy(tenant()))?.dailyBudgetUsd).toBe(100);

    source.set([basePolicy({ dailyBudgetUsd: 250 })]);
    expect((await provider.getPolicy(tenant()))?.dailyBudgetUsd).toBe(250);
  });

  it("rejects a malformed policy list at read time", async () => {
    const source = new InMemoryConfigSource([{ tenant: { organizationId: "org-1" } }]); // missing `thresholds`
    const provider = new ConfigBackedBudgetPolicyProvider(source);
    await expect(provider.getPolicy(tenant())).rejects.toThrow();
  });
});

describe("budgetPolicyListSchema", () => {
  it("accepts a well-formed policy list", () => {
    expect(() => budgetPolicyListSchema.parse([basePolicy()])).not.toThrow();
  });

  it("rejects an unknown threshold action", () => {
    expect(() =>
      budgetPolicyListSchema.parse([
        basePolicy({ thresholds: [{ atPercentOfBudget: 50, action: "not-a-real-action" as never }] }),
      ]),
    ).toThrow();
  });
});
