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
  orchestrator: [
    "policy-engine",
    "credential-resolver",
    "reliability",
    "streaming",
    "telemetry",
    "core-contracts",
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
  ],
  "apps/gateway-server": ["gateway-runtime", "config", "middleware", "telemetry"],
  // EM-5.5: additive second composition root (Vercel target), approved
  // architecture at docs/Hosting-architecture/
  // EM-5.5-vercel-deployment-architecture-review.md (revised). Same
  // allowed-deps list as `apps/gateway-server` — both depend on the
  // shared `gateway-runtime` package, not on each other — see
  // docs/adr/0011-shared-gateway-runtime-package.md.
  "apps/vercel-adapter": ["gateway-runtime", "config", "middleware"],
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
