/**
 * Enforces the package dependency graph from Engineering Blueprint Section
 * 4.1 exactly, plus the no-cycles guarantee — the automated gate referenced
 * by EM-0's acceptance criteria: CI fails if a cycle is ever introduced, or
 * if a package imports something outside its declared dependency edge.
 *
 * Rules are generated from DEPENDENCY_TABLE below rather than hand-written
 * per package, so this file cannot silently drift from Section 4.1 as new
 * packages are added in later waves — adding a package here is a one-line
 * change, not a new hand-written rule.
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */

// Mirrors Engineering Blueprint §4.1 exactly. Only Wave 1-4 packages are
// populated with real dependency edges for EM-0; later-wave packages are
// added here as their waves begin (Blueprint Implementation Rules: "never
// implement future milestone functionality early" applies to this config
// too — do not pre-populate edges for packages that don't exist yet).
const DEPENDENCY_TABLE = {
  "core-contracts": [],
  config: ["core-contracts"],
  telemetry: ["core-contracts"],
  "providers/provider-sdk": ["core-contracts"],
  reliability: ["core-contracts", "config", "telemetry"],
  "model-registry": ["core-contracts", "config"],
  "credential-resolver": ["core-contracts", "config", "telemetry"],
  "policy-engine": ["model-registry", "reliability", "core-contracts"],
  "providers/groq": ["providers/provider-sdk", "core-contracts"],
  "providers/nvidia-nim": ["providers/provider-sdk", "core-contracts"],
  streaming: ["providers/provider-sdk", "core-contracts"],
  // Wave 8 / EM-8: `orchestrator` gains a dependency on `strategy-layer`
  // (architecture §13.5/§30; Blueprint §6.1's interface-freeze table:
  // `AIStrategyLayer` is "Consumed by: orchestrator, Implemented by:
  // strategy-layer integration"). `policy-engine` itself gains NO new
  // edge — `PolicyContext.strategyDecision` (ADR-0018) is typed with a
  // local, structurally-compatible `StrategyDecisionLike`, not an import
  // of `strategy-layer`'s real `StrategyDecision`, specifically to avoid
  // a `policy-engine -> strategy-layer` edge that would cycle back against
  // `strategy-layer`'s own (corrected, ADR-0016) dependency list.
  orchestrator: [
    "policy-engine",
    "credential-resolver",
    "reliability",
    "streaming",
    "telemetry",
    "core-contracts",
    "strategy-layer",
  ],
  middleware: ["config", "telemetry", "core-contracts"],
  // Wave 5 / EM-5 begins: architecture §4.1's `apps/gateway-server` row
  // ("orchestrator, middleware, providers/groq, providers/nvidia-nim").
  // Added now per this file's own comment above ("later-wave packages are
  // added here as their waves begin") — every EM-0–EM-4 entry above is
  // byte-for-byte unchanged.
  //
  // EM-5.5 (revised): `apps/gateway-server` no longer depends on
  // `orchestrator`/`middleware`/the provider packages *directly* — that
  // composition now lives in `gateway-runtime` below, and both apps
  // depend on it instead. `apps/gateway-server` keeps a direct dependency
  // on `config` and `middleware` only for its own `server-config.ts` env
  // loader (which needs `CredentialScope`/`ROLES`/`ApiKeyRecord` for its
  // own zod validation, independent of `bootstrap()`).
  "gateway-runtime": [
    "core-contracts",
    "config",
    "telemetry",
    "model-registry",
    "credential-resolver",
    "reliability",
    "policy-engine",
    "streaming",
    "orchestrator",
    "middleware",
    "providers/groq",
    "providers/nvidia-nim",
    // Wave 8 / EM-8: bootstrap() constructs the AIStrategyLayer instance
    // (capability/execution-profile/runtime-profile registries + cost/
    // prompt optimizers + learning registry) and wires it into the
    // orchestrator when GatewayConfig.enableStrategyLayer is true
    // (ADR-0017).
    "strategy-layer",
    "capability-registry",
    "execution-profile-registry",
    "runtime-profiles",
    "cost-optimizer",
    "prompt-optimizer",
    "learning",
    // Wave 9 / EM-10: bootstrap() constructs the InMemoryBudgetLedger +
    // BudgetPolicyProvider + DefaultBudgetEnforcer (wired into
    // AIStrategyLayer's new optional `budgetEnforcer` option) and the
    // DefaultPipelineOrchestrator wrapping the already-constructed
    // orchestrator, exposed via the new `/v1/execute/pipeline` route.
    "budget-governance",
    "pipeline-orchestrator",
  ],
  "apps/gateway-server": ["gateway-runtime", "config", "middleware", "telemetry"],
  // EM-5.5: additive second composition root (Vercel target), approved
  // architecture at docs/Hosting-architecture/
  // EM-5.5-vercel-deployment-architecture-review.md (revised). Same
  // allowed-deps list as `apps/gateway-server` — both depend on the
  // shared `gateway-runtime` package, not on each other — see
  // docs/adr/0011-shared-gateway-runtime-package.md.
  "apps/vercel-adapter": ["gateway-runtime", "config", "middleware"],
  // Wave 6 / EM-6 begins: the Strategy Layer foundation (architecture §30,
  // Blueprint §7 EM-6) — Capability Registry, Execution Profile Registry,
  // Runtime Profiles. Matches Blueprint §4.1's table exactly. None of the
  // three is yet a dependency of `orchestrator`/`gateway-runtime`/either
  // app — EM-6 explicitly does not wire them in (Blueprint §7); that wiring
  // is `strategy-layer`'s job (Wave 8, EM-8).
  "capability-registry": ["model-registry", "core-contracts"],
  "execution-profile-registry": ["config", "core-contracts"],
  "runtime-profiles": ["config"],
  // Wave 7 / EM-7 begins: Cost Optimizer, Prompt Optimizer, Learning
  // Extension Points, Plugin System (Blueprint §7 EM-7). Matches Blueprint
  // §4.1's table, with two documented, flagged deviations:
  // 1. `prompt-optimizer` additionally depends on `execution-profile-registry`
  //    (the table lists only `capability-registry`, `core-contracts`),
  //    required because architecture §34.2's frozen `PromptOptimizer.optimize`
  //    signature takes a `ResolvedExecutionProfile` — that package's own
  //    exported type. Same "follow the more specific, directly-binding
  //    source over the summary table, and flag it" resolution EM-6 used
  //    for the §31.4/§37.2 tension; see `packages/prompt-optimizer/README.md`
  //    and that package's `src/prompt-optimizer.ts` doc comment. This is a
  //    genuine, unavoidable Architecture-Spec/Blueprint inconsistency, not
  //    an implementation choice — filed as ADR-0014 (Proposed) per this
  //    project's ADR process (CONTRIBUTING.md), not silently resolved.
  // 2. `plugin-system` additionally depends on `providers/provider-sdk`
  //    (the table lists only `core-contracts`), required because
  //    architecture §11's frozen `GatewayPlugin.onProviderRegistered`
  //    signature takes the real `ProviderAdapter` — that package's own
  //    exported type. `provider-sdk` is a Wave-1, `core-contracts`-only
  //    package, so this edge carries no layering/circularity risk. Also
  //    filed as ADR-0015 (Proposed) — the Independent Engineering Review of
  //    EM-7 (Issue #3) found the first draft of this package had instead
  //    silently narrowed the interface locally rather than adding this
  //    edge, which was both an interface-fidelity defect (Issue #1) and a
  //    governance-process gap; both are now corrected.
  // None of these four packages is yet a dependency of
  // `orchestrator`/`gateway-runtime`/either app, and none of EM-0–EM-6's
  // entries above are touched — that wiring is `strategy-layer`'s job
  // (Wave 8, EM-8).
  "cost-optimizer": ["capability-registry", "execution-profile-registry", "runtime-profiles"],
  "prompt-optimizer": ["capability-registry", "core-contracts", "execution-profile-registry"],
  learning: ["telemetry", "policy-engine"],
  "plugin-system": ["core-contracts", "providers/provider-sdk"],
  // Wave 8 / EM-8: `strategy-layer` integration (architecture §30,
  // Blueprint §7 EM-8). Blueprint §4.1's literal table row for this
  // package is defective in two ways: it lists `orchestrator` as a
  // dependency (backwards — a cycle, since `orchestrator` depends on
  // `strategy-layer`, not the reverse; see the correct direction above and
  // in Blueprint §6.1's interface-freeze table) and it omits four
  // necessary edges (`core-contracts`, `capability-registry`,
  // `execution-profile-registry`, `runtime-profiles` — all load-bearing:
  // the pipeline calls all three registries directly, and
  // `AIStrategyLayer.buildStrategy` takes an `ExecuteRequest`). The
  // corrected list below is documented in full, with justification for
  // every line-item difference, in ADR-0016 (Accepted — not a judgment
  // call with more than one defensible resolution, unlike ADR-0014; a
  // literal dependency cycle has only one non-contradictory fix).
  // `policy-engine` is deliberately NOT included — see ADR-0016 and
  // ADR-0018 for how `strategy-layer`'s output still reaches
  // `policy-engine` (via `orchestrator` and `PolicyContext`) without this
  // package needing a direct edge to it.
  "strategy-layer": [
    "core-contracts",
    "capability-registry",
    "execution-profile-registry",
    "runtime-profiles",
    "cost-optimizer",
    "prompt-optimizer",
    "learning",
    // Wave 9 / EM-10 (architecture §43.3: "the Budget Enforcer runs as the
    // last step of the Optimization Pipeline"; Blueprint §6.1's interface
    // table: `BudgetEnforcer`/`BudgetLedger` are "Consumed by: strategy-layer
    // (Optimization Pipeline)"). `policy-engine` still gains no new edge —
    // `BudgetEnforcementStage` folds a forced downgrade into the
    // *already-existing* `optimizations.cost.recommendedModelClassDowngrade`
    // field, the same "local field a later stage can override" mechanism
    // Runtime Profile adjustments used at EM-9, not a new carrier. See
    // ADR-00XX (this milestone) for the one thing this does NOT close the
    // loop on (`forcedProviderExclusion`).
    "budget-governance",
  ],
  // Wave 9 / EM-10 (Blueprint §4.1, verbatim: "orchestrator's public
  // interface, core-contracts"). Depends on the `orchestrator` *package* —
  // its public `execute()`/types only, per that package's own README
  // ("Public API") — not on any lower-layer package `orchestrator` itself
  // depends on; `pipeline-orchestrator` re-executes nothing, it only
  // sequences repeated calls to the one entry point every other caller
  // already uses (Blueprint §8.19).
  "pipeline-orchestrator": ["orchestrator", "core-contracts"],
  // Wave 9 / EM-10 (Blueprint §4.1, verbatim: "config, telemetry,
  // policy-engine (Routing Rules interface)"). See
  // `packages/budget-governance/src/budget-routing-rule.ts` for exactly
  // what the `policy-engine` edge is for (a real, tested, but currently
  // road-blocked-by-a-frozen-interface `RoutingRule`) and why it does not,
  // and cannot yet, create a `policy-engine -> budget-governance` cycle
  // (nothing in `policy-engine` imports this package — the edge is
  // one-directional, same shape as `learning -> policy-engine`).
  "budget-governance": ["core-contracts", "config", "telemetry", "policy-engine"],
};

function pkgPathPattern(pkgKey) {
  // `apps/*` entries already carry their own top-level directory in the
  // table key (e.g. "apps/gateway-server"); every other entry is a
  // `packages/*` key as before. This is the only change to this function
  // — every pre-existing key's generated pattern is identical to before.
  return pkgKey.startsWith("apps/") ? `^${pkgKey}(/|$)` : `^packages/${pkgKey}(/|$)`;
}

/** @type {import('dependency-cruiser').IForbiddenRuleType[]} */
const perPackageRules = Object.entries(DEPENDENCY_TABLE).map(([pkgKey, allowedDeps]) => {
  const otherPackageKeys = Object.keys(DEPENDENCY_TABLE).filter((k) => k !== pkgKey);
  const disallowedKeys = otherPackageKeys.filter((k) => !allowedDeps.includes(k));

  return {
    name: `${pkgKey.replace(/\//g, "-")}-declared-deps-only`,
    severity: "error",
    comment:
      `packages/${pkgKey} may only depend on ` +
      (allowedDeps.length ? allowedDeps.join(", ") : "(nothing internal)") +
      ` (Engineering Blueprint §4.1).`,
    from: { path: pkgPathPattern(pkgKey) },
    to: {
      path: disallowedKeys.length
        ? `^packages/(${disallowedKeys.map((k) => k.replace(/\//g, "\\/")).join("|")})(/|$)`
        : "$^", // matches nothing when every other package is allowed
      pathNot: pkgPathPattern(pkgKey),
    },
  };
});

module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment:
        "No cycles are permitted anywhere in the package graph (Section 4: " +
        "'No cycles exist in this graph by construction').",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment: "Flags source files that import nothing and are imported by nothing.",
      from: {
        orphan: true,
        pathNot: ["\\.test\\.ts$", "^src/index\\.ts$", "vitest\\.config\\.ts$", "\\.d\\.ts$"],
      },
      to: {},
    },
    {
      name: "no-package-depends-on-apps",
      severity: "error",
      comment: "No package under packages/ may depend on apps/* (Section 9 dependency rule).",
      from: { path: "^packages" },
      to: { path: "^apps" },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      comment:
        "Every import must resolve to a real module. In this workspace, an import of an " +
        "undeclared @ai-gateway/* package is unresolvable by construction (pnpm's strict, " +
        "non-hoisted node_modules only links a package's declared dependencies — see " +
        "docs/adr/0003-boundary-enforcement-layers.md), so this rule is also a backstop " +
        "against undeclared cross-package dependencies, not just typos.",
      from: {},
      to: { couldNotResolve: true },
    },
    ...perPackageRules,
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(dist|coverage)($|/)" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
