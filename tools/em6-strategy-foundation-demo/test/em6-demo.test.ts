import { describe, expect, it } from "vitest";
import { KNOWN_TASK_TYPES, type TaskType } from "@ai-gateway/core-contracts";
import { DefaultCapabilityRegistry, SEED_CAPABILITIES } from "@ai-gateway/capability-registry";
import { createSeededExecutionProfileRegistry } from "@ai-gateway/execution-profile-registry";
import { createSeededRuntimeProfileRegistry } from "@ai-gateway/runtime-profiles";

/**
 * Blueprint §7's EM-6 "Demonstrable outcome": "A CLI script resolving
 * `task: 'summarization'` to a capability set and an execution profile,
 * printed side by side — no live traffic affected yet." This suite is that
 * demonstration, committed as a permanent, CI-run regression test rather
 * than a throwaway hand-run script — the same choice
 * `tools/orchestrator-integration-tests` and
 * `tools/adapter-conformance-tests` already made for their own milestones'
 * demonstrable outcomes. It additionally resolves the active
 * `RuntimeProfile` alongside the other two, since EM-6 also delivers
 * `runtime-profiles` and the three are meant to be read together (
 * architecture §37.1).
 *
 * This suite lives in `tools/`, not inside any one of the three packages'
 * own `test/`, because no single package is allowed to depend on all
 * three at once (`capability-registry` depends on `model-registry` +
 * `core-contracts`; `execution-profile-registry` and `runtime-profiles`
 * depend on `config` [+ `core-contracts` for the former] — Blueprint
 * §4.1's `DEPENDENCY_TABLE`). `tools/*` is this codebase's established,
 * `dependency-cruiser`-exempt home for cross-package demonstrations — see
 * `tools/orchestrator-integration-tests/README.md`.
 *
 * Crucially, none of `orchestrator`, `policy-engine`, or any live
 * request path is touched anywhere in this file — exactly the "no live
 * traffic affected yet" acceptance criterion.
 */

const capabilityRegistry = new DefaultCapabilityRegistry({ seed: SEED_CAPABILITIES });
const executionProfileRegistry = createSeededExecutionProfileRegistry();
const runtimeProfileRegistry = createSeededRuntimeProfileRegistry();
const tenant = { organizationId: "acme-demo" };

describe("EM-6 demonstrable outcome: task -> capabilities + execution profile + runtime profile", () => {
  it('resolves task: "summarization" to a capability set and an execution profile, side by side', async () => {
    const task: TaskType = "summarization";

    const [capabilities, profile, runtimeProfile] = await Promise.all([
      capabilityRegistry.resolveCapabilities(task),
      executionProfileRegistry.resolveProfile(task),
      runtimeProfileRegistry.getActiveRuntimeProfile(tenant),
    ]);

    // Printed side by side, matching the acceptance criterion's own wording.
    console.log(
      JSON.stringify(
        { task, capabilities, executionProfile: profile, activeRuntimeProfile: runtimeProfile.id },
        null,
        2,
      ),
    );

    expect(capabilities).toEqual(SEED_CAPABILITIES.summarization);
    expect(profile.id).toBe("summarization");
    expect(runtimeProfile.id).toBe("production");

    // The three packages compose (architecture §37.1) without contradicting
    // each other: a task that prefers streaming (capabilities) is backed by
    // an execution profile that also defaults streaming on.
    expect(capabilities.streamingPreferred).toBe(true);
    expect(profile.streaming.defaultEnabled).toBe(true);
  });

  it("resolves every core-contracts KNOWN_TASK_TYPES entry end to end, with no orchestrator/policy-engine involvement", async () => {
    for (const task of KNOWN_TASK_TYPES) {
      const capabilities = await capabilityRegistry.resolveCapabilities(task);
      const profile = await executionProfileRegistry.resolveProfile(task);

      expect(capabilities).toBeDefined();
      expect(profile).toBeDefined();
    }
  });

  it("the same task resolves a different ExecutionProfile-adjustable posture under a different RuntimeProfile, without any application change", async () => {
    await runtimeProfileRegistry.setTenantRuntimeProfile(tenant, "enterprise");
    const enterprise = await runtimeProfileRegistry.getActiveRuntimeProfile(tenant);

    const freeTierTenant = { organizationId: "startup-demo" };
    await runtimeProfileRegistry.setTenantRuntimeProfile(freeTierTenant, "free_tier");
    const freeTier = await runtimeProfileRegistry.getActiveRuntimeProfile(freeTierTenant);

    // Same request (`task: "summarization"`), same resolved ExecutionProfile...
    const profile = await executionProfileRegistry.resolveProfile("summarization");
    expect(profile.id).toBe("summarization");

    // ...but two tenants' RuntimeProfiles disagree on posture exactly as
    // architecture §37.1 describes ("the same task ... request behaves
    // differently under a free_tier Runtime Profile than under an
    // enterprise one") — the raw material `strategy-layer` (EM-8) will
    // later merge into a ResolvedExecutionProfile.
    expect(enterprise.provider.preferFreeTier).toBe(false);
    expect(freeTier.provider.preferFreeTier).toBe(true);
    expect(enterprise.reliability.retryAggressiveness).toBe("aggressive");
    expect(freeTier.reliability.retryAggressiveness).toBe("conservative");
  });
});
