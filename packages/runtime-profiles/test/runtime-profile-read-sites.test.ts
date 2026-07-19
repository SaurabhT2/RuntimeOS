import { describe, expect, it } from "vitest";
import { createSeededRuntimeProfileRegistry } from "../src/registry.js";
import type { RuntimeProfileId } from "../src/runtime-profile.js";

const TENANT = { organizationId: "read-sites-org" };

/**
 * Blueprint §8.16's testing-strategy line: "Unit tests per preset
 * confirming each of the four documented read sites (architecture §37.4)
 * receives the correct adjusted value."
 *
 * The four read sites, verbatim from §37.4, and the `RuntimeProfile`
 * field(s) each one reads:
 *   1. Execution Profile Registry (§31.4) — `caching.aggressiveness`
 *      (the `streaming`/`timeoutMs` defaults it also adjusts live on the
 *      `ExecutionProfile` side, not on `RuntimeProfile` itself, so there is
 *      nothing further of this package's own output to assert for them).
 *   2. Cost Optimizer (§33.2) — `provider.preferFreeTier`,
 *      `cost.tokenUsageCeilingPerRequest`, `cost.dailyBudgetUsd`.
 *   3. Policy Engine's Candidate Query (§13.2) — `provider.allowedLifecycleStates`.
 *   4. Retry Engine / Circuit Breaker (§18) —
 *      `reliability.retryAggressiveness`, `reliability.failoverAggressiveness`.
 *
 * None of those four call sites are wired up yet (EM-6 ships only this
 * package; see `registry.ts`'s `RuntimeProfileRegistry` doc comment), so
 * "receives the correct adjusted value" is verified the way it can be at
 * this milestone: by resolving each preset through the same
 * `getActiveRuntimeProfile()` API a future read site would call, and
 * asserting the exact field(s) that read site is documented to consume.
 * This is the systematic preset × read-site matrix the single-field
 * `enterprise`/`development` spot checks in `seed-data.test.ts` did not
 * cover (Independent Architecture Review, Issue #1).
 *
 * Expected values are architecture §37.3's illustrative preset table,
 * concretized by `SEED_RUNTIME_PROFILES` (see that file's own doc comment
 * for how the qualitative table entries were made concrete).
 */
interface ExpectedRuntimeProfile {
  id: RuntimeProfileId;
  executionProfileRegistry: {
    cachingAggressiveness: "off" | "standard" | "aggressive";
  };
  costOptimizer: {
    preferFreeTier: boolean;
    tokenUsageCeilingPerRequest: number | undefined;
    dailyBudgetUsd: number | undefined;
  };
  policyEngineCandidateQuery: {
    allowedLifecycleStates: string[];
  };
  retryEngineCircuitBreaker: {
    retryAggressiveness: "conservative" | "standard" | "aggressive";
    failoverAggressiveness: "conservative" | "standard" | "aggressive";
  };
}

const EXPECTED: ExpectedRuntimeProfile[] = [
  {
    id: "development",
    executionProfileRegistry: { cachingAggressiveness: "aggressive" },
    costOptimizer: {
      preferFreeTier: true,
      tokenUsageCeilingPerRequest: 32_000,
      dailyBudgetUsd: undefined,
    },
    policyEngineCandidateQuery: {
      allowedLifecycleStates: ["experimental", "preview", "recommended", "stable"],
    },
    retryEngineCircuitBreaker: {
      retryAggressiveness: "conservative",
      failoverAggressiveness: "conservative",
    },
  },
  {
    id: "free_tier",
    executionProfileRegistry: { cachingAggressiveness: "aggressive" },
    costOptimizer: {
      preferFreeTier: true,
      tokenUsageCeilingPerRequest: 8_000,
      dailyBudgetUsd: 1,
    },
    policyEngineCandidateQuery: {
      allowedLifecycleStates: ["preview", "recommended", "stable"],
    },
    retryEngineCircuitBreaker: {
      retryAggressiveness: "conservative",
      failoverAggressiveness: "conservative",
    },
  },
  {
    id: "production",
    executionProfileRegistry: { cachingAggressiveness: "standard" },
    costOptimizer: {
      preferFreeTier: false,
      tokenUsageCeilingPerRequest: 32_000,
      dailyBudgetUsd: 250,
    },
    policyEngineCandidateQuery: {
      allowedLifecycleStates: ["recommended", "stable"],
    },
    retryEngineCircuitBreaker: {
      retryAggressiveness: "standard",
      failoverAggressiveness: "standard",
    },
  },
  {
    id: "enterprise",
    executionProfileRegistry: { cachingAggressiveness: "standard" },
    costOptimizer: {
      preferFreeTier: false,
      tokenUsageCeilingPerRequest: undefined,
      dailyBudgetUsd: 5_000,
    },
    policyEngineCandidateQuery: {
      allowedLifecycleStates: ["stable"],
    },
    retryEngineCircuitBreaker: {
      retryAggressiveness: "aggressive",
      failoverAggressiveness: "aggressive",
    },
  },
  {
    id: "offline",
    executionProfileRegistry: { cachingAggressiveness: "aggressive" },
    costOptimizer: {
      preferFreeTier: false,
      tokenUsageCeilingPerRequest: undefined,
      dailyBudgetUsd: undefined,
    },
    policyEngineCandidateQuery: {
      allowedLifecycleStates: ["stable"],
    },
    retryEngineCircuitBreaker: {
      // §37.3's "Disabled (no network-dependent failover)" has no matching
      // enum value in §37.2's schema; `conservative` is the stand-in (see
      // seed-data.ts's inline comment on `offline.reliability`).
      retryAggressiveness: "conservative",
      failoverAggressiveness: "conservative",
    },
  },
  {
    id: "high_availability",
    executionProfileRegistry: { cachingAggressiveness: "standard" },
    costOptimizer: {
      preferFreeTier: false,
      tokenUsageCeilingPerRequest: undefined,
      dailyBudgetUsd: 5_000,
    },
    policyEngineCandidateQuery: {
      allowedLifecycleStates: ["recommended", "stable"],
    },
    retryEngineCircuitBreaker: {
      retryAggressiveness: "aggressive",
      failoverAggressiveness: "aggressive",
    },
  },
];

describe("RuntimeProfile read sites (architecture §37.4, Blueprint §8.16)", () => {
  describe.each(EXPECTED)("$id", (expected) => {
    it("Execution Profile Registry read site receives the correct caching adjustment", async () => {
      const registry = createSeededRuntimeProfileRegistry();
      await registry.setTenantRuntimeProfile(TENANT, expected.id);
      const profile = await registry.getActiveRuntimeProfile(TENANT);

      expect(profile.caching.aggressiveness).toBe(
        expected.executionProfileRegistry.cachingAggressiveness,
      );
    });

    it("Cost Optimizer read site receives the correct free-tier preference and cost ceilings", async () => {
      const registry = createSeededRuntimeProfileRegistry();
      await registry.setTenantRuntimeProfile(TENANT, expected.id);
      const profile = await registry.getActiveRuntimeProfile(TENANT);

      expect(profile.provider.preferFreeTier).toBe(expected.costOptimizer.preferFreeTier);
      expect(profile.cost.tokenUsageCeilingPerRequest).toBe(
        expected.costOptimizer.tokenUsageCeilingPerRequest,
      );
      expect(profile.cost.dailyBudgetUsd).toBe(expected.costOptimizer.dailyBudgetUsd);
    });

    it("Policy Engine Candidate Query read site receives the correct allowed lifecycle states", async () => {
      const registry = createSeededRuntimeProfileRegistry();
      await registry.setTenantRuntimeProfile(TENANT, expected.id);
      const profile = await registry.getActiveRuntimeProfile(TENANT);

      expect(profile.provider.allowedLifecycleStates).toEqual(
        expected.policyEngineCandidateQuery.allowedLifecycleStates,
      );
    });

    it("Retry Engine / Circuit Breaker read site receives the correct reliability aggressiveness", async () => {
      const registry = createSeededRuntimeProfileRegistry();
      await registry.setTenantRuntimeProfile(TENANT, expected.id);
      const profile = await registry.getActiveRuntimeProfile(TENANT);

      expect(profile.reliability.retryAggressiveness).toBe(
        expected.retryEngineCircuitBreaker.retryAggressiveness,
      );
      expect(profile.reliability.failoverAggressiveness).toBe(
        expected.retryEngineCircuitBreaker.failoverAggressiveness,
      );
    });
  });

  it("covers every seed preset (matrix is exhaustive, not a subset)", async () => {
    const { SEED_RUNTIME_PROFILES } = await import("../src/seed-data.js");
    expect(EXPECTED.map((e) => e.id).sort()).toEqual(
      SEED_RUNTIME_PROFILES.map((p) => p.id).sort(),
    );
  });
});
