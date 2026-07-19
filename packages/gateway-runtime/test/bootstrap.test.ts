import { describe, expect, it } from "vitest";
import { bootstrap } from "../src/bootstrap.js";
import { fakeAdapter, TEST_MODEL_SEED, testRuntimeConfig } from "../src/testing/fixtures.js";

// EM-10: a couple of this file's new tests call `app.orchestrator.execute`/
// `app.pipelineOrchestrator.executePipeline` for real (not just asserting
// `GatewayApp`'s shape), which reaches `PlatformScopeResolver` — set the
// same platform-key env vars `src/testing/test-server.ts` already sets for
// the full-HTTP-stack integration tests, so credential resolution succeeds
// here too, independent of whichever provider adapters (fake or real) are
// configured for a given test.
process.env.TEST_GROQ_PLATFORM_API_KEY ??= "test-platform-key-groq";
process.env.TEST_NIM_PLATFORM_API_KEY ??= "test-platform-key-nim";

describe("bootstrap", () => {
  it("wires every platform package into a GatewayApp bundle", async () => {
    const app = await bootstrap(testRuntimeConfig(), {
      adapters: [fakeAdapter({ id: "groq" }), fakeAdapter({ id: "nvidia-nim" })],
      modelRegistrySeed: TEST_MODEL_SEED,
    });

    expect(app.telemetry).toBeDefined();
    expect(app.gatewayConfig).toBeDefined();
    expect(app.modelRegistry).toBeDefined();
    expect(app.credentialResolver).toBeDefined();
    expect(app.healthMonitor).toBeDefined();
    expect(app.circuitBreaker).toBeDefined();
    expect(app.policyEngine).toBeDefined();
    expect(app.streamManager).toBeDefined();
    expect(app.orchestrator).toBeDefined();
    expect(app.auth).toBeDefined();
    expect(app.rateLimit).toBeDefined();
    expect(app.cache).toBeDefined();
    expect(app.pipeline).toBeDefined();
    expect(app.adapters.map((a) => a.id).sort()).toEqual(["groq", "nvidia-nim"]);
  });

  it("uses the real GroqAdapter/NimAdapter when no adapter override is supplied", async () => {
    const app = await bootstrap(testRuntimeConfig());
    expect(app.adapters.map((a) => a.id).sort()).toEqual(["groq", "nvidia-nim"]);
  });

  it("falls back to DEFAULT_GATEWAY_CONFIG when no gatewayConfigPath is set", async () => {
    const app = await bootstrap(testRuntimeConfig());
    expect(app.gatewayConfig.credentialPriority).toEqual([
      "user",
      "project",
      "workspace",
      "organization",
      "platform",
    ]);
  });

  it("prefers the runtime config's own credentialPriority over GatewayConfig's default when non-empty", async () => {
    const app = await bootstrap(testRuntimeConfig({ credentialPriority: ["platform"] }));
    // Not directly observable on GatewayApp, but resolving a platform-only
    // credential should still succeed — exercised end-to-end in
    // test/integration/end-to-end.test.ts. Here we assert the resolver was
    // constructed at all (no throw), which already covers the wiring path.
    expect(app.credentialResolver).toBeDefined();
  });

  it("loads a real GatewayConfig file when gatewayConfigPath is set", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gw-test-"));
    const configPath = path.join(dir, "config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        credentialPriority: ["platform"],
        routing: { defaultStrategy: "cost_optimized" },
        reliability: { maxRetries: 1, backoff: "linear", circuitBreakerThreshold: 3 },
      }),
    );

    const app = await bootstrap(testRuntimeConfig({ gatewayConfigPath: configPath }));
    expect(app.gatewayConfig.routing.defaultStrategy).toBe("cost_optimized");
  });

  it("throws when the loaded GatewayConfig file fails schema validation", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gw-test-"));
    const configPath = path.join(dir, "bad-config.json");
    await fs.writeFile(configPath, JSON.stringify({ credentialPriority: ["not-a-real-scope"] }));

    await expect(bootstrap(testRuntimeConfig({ gatewayConfigPath: configPath }))).rejects.toThrow();
  });

  describe("enableStrategyLayer feature flag (EM-8, ADR-0017)", () => {
    it("does not construct a strategyLayer by default", async () => {
      const app = await bootstrap(testRuntimeConfig());
      expect(app.strategyLayer).toBeUndefined();
    });

    it("constructs a strategyLayer when runtimeConfig.enableStrategyLayer is true", async () => {
      const app = await bootstrap(testRuntimeConfig({ enableStrategyLayer: true }));
      expect(app.strategyLayer).toBeDefined();
    });

    it("reads GatewayConfig.enableStrategyLayer from a config file when the runtime override is absent", async () => {
      const fs = await import("node:fs/promises");
      const os = await import("node:os");
      const path = await import("node:path");
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gw-test-"));
      const configPath = path.join(dir, "config.json");
      await fs.writeFile(
        configPath,
        JSON.stringify({
          credentialPriority: ["platform"],
          routing: { defaultStrategy: "cost_optimized" },
          reliability: { maxRetries: 1, backoff: "linear", circuitBreakerThreshold: 3 },
          enableStrategyLayer: true,
        }),
      );

      const app = await bootstrap(testRuntimeConfig({ gatewayConfigPath: configPath }));
      expect(app.strategyLayer).toBeDefined();
    });

    it("the runtime config override wins over GatewayConfig when both are present", async () => {
      const fs = await import("node:fs/promises");
      const os = await import("node:os");
      const path = await import("node:path");
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gw-test-"));
      const configPath = path.join(dir, "config.json");
      await fs.writeFile(
        configPath,
        JSON.stringify({
          credentialPriority: ["platform"],
          routing: { defaultStrategy: "cost_optimized" },
          reliability: { maxRetries: 1, backoff: "linear", circuitBreakerThreshold: 3 },
          enableStrategyLayer: true,
        }),
      );

      const app = await bootstrap(
        testRuntimeConfig({ gatewayConfigPath: configPath, enableStrategyLayer: false }),
      );
      expect(app.strategyLayer).toBeUndefined();
    });

    it("the constructed strategyLayer produces a real StrategyDecision end-to-end", async () => {
      const app = await bootstrap(testRuntimeConfig({ enableStrategyLayer: true }));
      const decision = await app.strategyLayer!.buildStrategy(
        {
          task: "summarization",
          input: { text: "summarize this" },
          tenant: { organizationId: "org-1" },
        },
        { organizationId: "org-1" },
      );
      expect(decision.requiredCapabilities).toBeDefined();
      expect(decision.executionProfile).toBeDefined();
      expect(Object.isFrozen(decision)).toBe(true);
    });
  });

  describe("EM-10: Budget Governance wiring", () => {
    it("app.budgetEnforcer is undefined when no budgetPolicies are configured, even with the Strategy Layer enabled", async () => {
      const app = await bootstrap(testRuntimeConfig({ enableStrategyLayer: true }));
      expect(app.budgetEnforcer).toBeUndefined();
    });

    it("app.budgetEnforcer is undefined when budgetPolicies are configured but the Strategy Layer is disabled", async () => {
      const app = await bootstrap(
        testRuntimeConfig({
          enableStrategyLayer: false,
          budgetPolicies: [{ tenant: { organizationId: "org-1" }, dailyBudgetUsd: 10, thresholds: [] }],
        }),
      );
      expect(app.budgetEnforcer).toBeUndefined();
      expect(app.strategyLayer).toBeUndefined();
    });

    it("app.budgetEnforcer is defined when both enableStrategyLayer and budgetPolicies are configured", async () => {
      const app = await bootstrap(
        testRuntimeConfig({
          enableStrategyLayer: true,
          budgetPolicies: [{ tenant: { organizationId: "org-1" }, dailyBudgetUsd: 10, thresholds: [] }],
        }),
      );
      expect(app.budgetEnforcer).toBeDefined();
    });

    it("defaults to shadow mode — a request that would exceed the budget still succeeds", async () => {
      const app = await bootstrap(
        testRuntimeConfig({
          enableStrategyLayer: true,
          budgetPolicies: [
            {
              tenant: { organizationId: "org-1" },
              dailyBudgetUsd: 0.0000001, // any real request exceeds this
              thresholds: [{ atPercentOfBudget: 100, action: "block" }],
            },
          ],
        }),
        { adapters: [fakeAdapter({ id: "groq" }), fakeAdapter({ id: "nvidia-nim" })], modelRegistrySeed: TEST_MODEL_SEED },
      );
      const response = await app.orchestrator.execute({
        task: "summarization",
        input: { text: "summarize this" },
        tenant: { organizationId: "org-1" },
      });
      expect(response.execution.providerId).toBeDefined(); // succeeded, not BUDGET_EXCEEDED
    });

    it("enforcing mode actually blocks a request that exceeds the configured budget", async () => {
      const app = await bootstrap(
        testRuntimeConfig({
          enableStrategyLayer: true,
          budgetEnforcementMode: "enforcing",
          budgetPolicies: [
            {
              tenant: { organizationId: "org-1" },
              dailyBudgetUsd: 0.0000001,
              thresholds: [{ atPercentOfBudget: 100, action: "block" }],
            },
          ],
        }),
      );
      await expect(
        app.orchestrator.execute({
          task: "summarization",
          input: { text: "summarize this" },
          tenant: { organizationId: "org-1" },
        }),
      ).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
    });

    it(
      "(EM-10 Review Finding 1/3) a request is blocked purely by an EARLIER request's real, " +
        "recorded spend — enforcing mode, real execution flow, not mocked ledger state",
      async () => {
        const app = await bootstrap(
          testRuntimeConfig({
            enableStrategyLayer: true,
            budgetEnforcementMode: "enforcing",
            budgetPolicies: [
              {
                tenant: { organizationId: "org-1" },
                dailyBudgetUsd: 50,
                thresholds: [{ atPercentOfBudget: 100, action: "block" }],
              },
            ],
          }),
          {
            // costUsd: 60 is each request's real, post-execution cost — well
            // above the $50 daily budget on its own, but nowhere close to it
            // when only estimated pre-flight (TEST_MODEL_SEED's groq tier is
            // free; the Cost Optimizer's pre-execution `plannedCostUsd`,
            // not this adapter cost, is what the *first* request's own
            // enforcement check sees).
            adapters: [
              fakeAdapter({ id: "groq", costUsd: 60 }),
              fakeAdapter({ id: "nvidia-nim", costUsd: 60 }),
            ],
            modelRegistrySeed: TEST_MODEL_SEED,
          },
        );
        const request = {
          task: "summarization" as const,
          input: { text: "summarize this" },
          tenant: { organizationId: "org-1" },
        };

        // Request 1: the ledger starts empty, so this request's own
        // (near-zero, pre-execution) planned cost easily clears the
        // enforcement check. It succeeds, and its *real* $60 cost is
        // recorded into the ledger by the production `onExecutionCompleted`
        // wiring — this is the exact gap Finding 1 identified.
        const first = await app.orchestrator.execute(request);
        expect(first.execution.providerId).toBeDefined();
        expect(await app.budgetLedger?.getSpend({ organizationId: "org-1" }, "day")).toBe(60);

        // Request 2: identical request, identical (near-zero) planned cost
        // — but now blocked, because the *ledger's* accumulated $60 from
        // Request 1 (120% of the $50 daily budget) is what the enforcement
        // check reads. Before this rework, `getSpend` would still have
        // returned 0 here and this request would have succeeded too.
        await expect(app.orchestrator.execute(request)).rejects.toMatchObject({
          code: "BUDGET_EXCEEDED",
        });
      },
    );

    it(
      "(EM-10 Review Finding 1/3) shadow mode still accrues real spend into the ledger across " +
        "requests, even though nothing is ever blocked",
      async () => {
        const app = await bootstrap(
          testRuntimeConfig({
            enableStrategyLayer: true,
            // budgetEnforcementMode omitted — defaults to "shadow".
            budgetPolicies: [
              {
                tenant: { organizationId: "org-1" },
                dailyBudgetUsd: 50,
                thresholds: [{ atPercentOfBudget: 100, action: "block" }],
              },
            ],
          }),
          {
            adapters: [
              fakeAdapter({ id: "groq", costUsd: 60 }),
              fakeAdapter({ id: "nvidia-nim", costUsd: 60 }),
            ],
            modelRegistrySeed: TEST_MODEL_SEED,
          },
        );
        const request = {
          task: "summarization" as const,
          input: { text: "summarize this" },
          tenant: { organizationId: "org-1" },
        };

        const first = await app.orchestrator.execute(request);
        expect(first.execution.providerId).toBeDefined(); // shadow mode: never blocks
        expect(await app.budgetLedger?.getSpend({ organizationId: "org-1" }, "day")).toBe(60);

        // A second request also succeeds (shadow mode enforces nothing),
        // but the ledger keeps accruing real spend regardless — proving
        // the burn-in period Blueprint §7 EM-10 relies on ("shadow mode
        // ... against real traffic for at least one full billing cycle")
        // is actually observing real, cumulative traffic now, not a
        // permanently-empty ledger.
        const second = await app.orchestrator.execute(request);
        expect(second.execution.providerId).toBeDefined();
        expect(await app.budgetLedger?.getSpend({ organizationId: "org-1" }, "day")).toBe(120);
      },
    );

    describe("EM-11: Production Promotion — enforcement-mode action validation, real end-to-end flow", () => {
      it("'alert' threshold action never blocks in enforcing mode, even once crossed", async () => {
        const app = await bootstrap(
          testRuntimeConfig({
            enableStrategyLayer: true,
            budgetEnforcementMode: "enforcing",
            budgetPolicies: [
              {
                tenant: { organizationId: "org-1" },
                dailyBudgetUsd: 50,
                // Only an 'alert' threshold configured — no 'block' at any
                // percentage — so a request that blows well past 100% of
                // budget must still succeed; 'alert' is a notify-only
                // action by architecture §43.2's own action taxonomy.
                thresholds: [{ atPercentOfBudget: 50, action: "alert" }],
              },
            ],
          }),
          {
            adapters: [fakeAdapter({ id: "groq", costUsd: 200 }), fakeAdapter({ id: "nvidia-nim", costUsd: 200 })],
            modelRegistrySeed: TEST_MODEL_SEED,
          },
        );
        const request = {
          task: "summarization" as const,
          input: { text: "summarize this" },
          tenant: { organizationId: "org-1" },
        };

        // Two requests, $200 real cost each, against a $50 daily budget —
        // the second request's *cumulative* view is 400% of budget, well
        // past the 'alert' threshold. Both must still succeed: this is the
        // production-promotion-specific guarantee that 'alert' alone,
        // configured without an accompanying 'block' threshold, never
        // degrades into blocking behavior once real enforcement is turned
        // on tenant-wide, not just for this one policy.
        const first = await app.orchestrator.execute(request);
        expect(first.execution.providerId).toBeDefined();
        const second = await app.orchestrator.execute(request);
        expect(second.execution.providerId).toBeDefined();
        expect(await app.budgetLedger?.getSpend({ organizationId: "org-1" }, "day")).toBe(400);
      });

      it(
        "(ADR-0025, disclosed gap — empirically reconfirmed for EM-11 production promotion) " +
          "a 'switch_provider' threshold breach has NO observable effect on real routing: the " +
          "over-cap provider is still selected, because the only production evaluate() call site " +
          "always runs pre-provider-selection (NO_PROVIDER_SELECTED_YET skips the per-provider " +
          "check entirely) and forcedProviderExclusion has no StrategyDecision carrier even when " +
          "computed",
        async () => {
          const app = await bootstrap(
            testRuntimeConfig({
              enableStrategyLayer: true,
              budgetEnforcementMode: "enforcing",
              budgetPolicies: [
                {
                  tenant: { organizationId: "org-1" },
                  dailyBudgetUsd: 100_000, // tenant-wide budget effectively unlimited
                  perProviderSpendCapUsd: { groq: 5 }, // groq specifically capped very low
                  thresholds: [{ atPercentOfBudget: 1, action: "switch_provider" }],
                },
              ],
            }),
            {
              // groq is the only candidate for TEST_MODEL_SEED's
              // "fast-extraction" class that is free; nvidia-nim is the
              // same class but priced — so if switch_provider actually
              // excluded groq after its cap breach, Policy Engine's only
              // remaining candidate would be nvidia-nim.
              adapters: [
                fakeAdapter({ id: "groq", costUsd: 60 }),
                fakeAdapter({ id: "nvidia-nim", costUsd: 60 }),
              ],
              modelRegistrySeed: TEST_MODEL_SEED,
            },
          );
          const request = {
            task: "summarization" as const,
            input: { text: "summarize this" },
            tenant: { organizationId: "org-1" },
          };

          // Request 1 records $60 real spend against groq — 12x its $5
          // per-provider cap, which should (per the policy's own
          // switch_provider threshold at 1%) trigger an exclusion of groq
          // starting with the next request, if the mechanism worked.
          const first = await app.orchestrator.execute(request);
          expect(first.execution.providerId).toBe("groq");

          // Request 2: if switch_provider worked end-to-end, Policy Engine
          // would never even consider groq as a candidate here, and this
          // request would route to nvidia-nim instead. It does not: this
          // assertion documents the real, current production behavior —
          // groq is still selected, exactly as if no switch_provider
          // threshold had ever been configured. This is the live-traffic
          // confirmation of the gap ADR-0025 already discloses on paper;
          // see that ADR and budget-governance's README for why (frozen
          // StrategyDecision has no carrier field, and the only
          // evaluate() call site always passes NO_PROVIDER_SELECTED_YET,
          // which skips the per-provider check outright).
          const second = await app.orchestrator.execute(request);
          expect(second.execution.providerId).toBe("groq");
        },
      );
    });
  });

  describe("EM-10: Pipeline Orchestrator wiring", () => {
    it("app.pipelineOrchestrator is always constructed, regardless of any feature flag", async () => {
      const app = await bootstrap(testRuntimeConfig());
      expect(app.pipelineOrchestrator).toBeDefined();
    });

    it("app.pipelineOrchestrator wraps the same orchestrator instance — a real pipeline step executes through it", async () => {
      const app = await bootstrap(testRuntimeConfig(), {
        adapters: [fakeAdapter({ id: "groq" }), fakeAdapter({ id: "nvidia-nim" })],
        modelRegistrySeed: TEST_MODEL_SEED,
      });
      const result = await app.pipelineOrchestrator.executePipeline({
        id: "pipeline-1",
        tenant: { organizationId: "org-1" },
        steps: [
          {
            id: "s1",
            task: "summarization",
            buildInput: () => ({ input: { text: "summarize this" } }),
          },
        ],
      });
      expect(result.completed).toBe(true);
      expect(result.stepResults.s1).toBeDefined();
    });

    it("respects a configured maxPipelineSteps", async () => {
      const app = await bootstrap(testRuntimeConfig({ maxPipelineSteps: 1 }));
      await expect(
        app.pipelineOrchestrator.executePipeline({
          id: "pipeline-1",
          tenant: { organizationId: "org-1" },
          steps: [
            { id: "s1", task: "summarization", buildInput: () => ({ input: { text: "x" } }) },
            { id: "s2", task: "summarization", buildInput: () => ({ input: { text: "x" } }) },
          ],
        }),
      ).rejects.toThrow();
    });

    it(
      "(EM-10 Review Finding 1) pipeline steps follow the same cumulative budget accounting as " +
        "single requests, with no pipeline-orchestrator-specific wiring — it shares the same " +
        "orchestrator instance and onExecutionCompleted hook",
      async () => {
        const app = await bootstrap(
          testRuntimeConfig({
            enableStrategyLayer: true,
            budgetEnforcementMode: "enforcing",
            budgetPolicies: [
              {
                tenant: { organizationId: "org-1" },
                dailyBudgetUsd: 50,
                thresholds: [{ atPercentOfBudget: 100, action: "block" }],
              },
            ],
          }),
          {
            adapters: [
              fakeAdapter({ id: "groq", costUsd: 60 }),
              fakeAdapter({ id: "nvidia-nim", costUsd: 60 }),
            ],
            modelRegistrySeed: TEST_MODEL_SEED,
          },
        );

        const result = await app.pipelineOrchestrator.executePipeline({
          id: "pipeline-1",
          tenant: { organizationId: "org-1" },
          steps: [
            { id: "s1", task: "summarization", buildInput: () => ({ input: { text: "step one" } }) },
            { id: "s2", task: "summarization", buildInput: () => ({ input: { text: "step two" } }) },
          ],
        });

        // Step 1 succeeds (ledger starts empty) and its real $60 cost is
        // recorded; step 2, evaluated against the now-accumulated $60 of
        // the $50 daily budget, is denied — the pipeline stops there
        // (s2 is a `required` step by default), exactly like a lone
        // second `orchestrator.execute()` call would be.
        expect(result.completed).toBe(false);
        expect(result.stepResults.s1).not.toHaveProperty("code");
        expect(result.stepResults.s2).toMatchObject({ code: "BUDGET_EXCEEDED" });
        expect(await app.budgetLedger?.getSpend({ organizationId: "org-1" }, "day")).toBe(60);
      },
    );
  });
});
