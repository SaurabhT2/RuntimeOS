import { createTelemetry, type Telemetry } from "@ai-gateway/telemetry";
import {
  DEFAULT_GATEWAY_CONFIG,
  FileConfigSource,
  gatewayConfigSchema,
  loadConfig,
  type CredentialScope,
  type GatewayConfig,
} from "@ai-gateway/config";
import {
  DefaultModelRegistry,
  SEED_MODELS,
  type ModelDescriptor,
  type ModelRegistry,
} from "@ai-gateway/model-registry";
import {
  AesGcmEncryptor,
  DefaultAuditLogger,
  DefaultCredentialResolver,
  DefaultResolutionChain,
  DbScopeResolver,
  DbSecretSource,
  EnvSecretSource,
  InMemoryCredentialStore,
  PlatformScopeResolver,
  generateEncryptionKey,
  type CredentialResolver,
} from "@ai-gateway/credential-resolver";
import {
  DefaultHealthMonitor,
  DefaultRetryEngine,
  InMemoryCircuitBreaker,
  type CircuitBreaker,
  type HealthMonitor,
} from "@ai-gateway/reliability";
import { DefaultPolicyEngine, type PolicyEngine } from "@ai-gateway/policy-engine";
import { DefaultStreamManager, type StreamManager } from "@ai-gateway/streaming";
import {
  DefaultExecutionOrchestrator,
  InMemoryProviderAdapterRegistry,
  type ExecutionOrchestrator,
  type ProviderAdapter,
} from "@ai-gateway/orchestrator";
import type { ExecuteRequest, ExecuteResponse } from "@ai-gateway/core-contracts";
import {
  AuthMiddleware,
  CacheMiddleware,
  MiddlewarePipeline,
  RateLimitMiddleware,
  type ApiKeyRecord,
} from "@ai-gateway/middleware";
import { GroqAdapter } from "@ai-gateway/groq";
import { NimAdapter } from "@ai-gateway/nvidia-nim";
import { DefaultCapabilityRegistry, SEED_CAPABILITIES } from "@ai-gateway/capability-registry";
import { createSeededExecutionProfileRegistry } from "@ai-gateway/execution-profile-registry";
import { createSeededRuntimeProfileRegistry } from "@ai-gateway/runtime-profiles";
import { DefaultCostOptimizer, InMemoryCacheClient } from "@ai-gateway/cost-optimizer";
import { DefaultPromptOptimizer } from "@ai-gateway/prompt-optimizer";
import { DefaultLearningRegistry } from "@ai-gateway/learning";
import { DefaultAIStrategyLayer, type AIStrategyLayer } from "@ai-gateway/strategy-layer";
import {
  DefaultBudgetEnforcer,
  InMemoryBudgetLedger,
  StaticBudgetPolicyProvider,
  type BudgetEnforcementMode,
  type BudgetEnforcer,
  type BudgetLedger,
  type BudgetPolicy,
} from "@ai-gateway/budget-governance";
import { DefaultPipelineOrchestrator } from "@ai-gateway/pipeline-orchestrator";

/**
 * The RuntimeOS composition root — architecture §6.4's "the only place in
 * the entire codebase permitted to import a concrete implementation of
 * every interface simultaneously." This package is the **shared** home for
 * that composition root: every hosting-specific application (`apps/
 * gateway-server`, `apps/vercel-adapter`, and any future target) calls the
 * same `bootstrap()` here rather than each defining/maintaining its own
 * copy (see `docs/adr/0011-shared-gateway-runtime-package.md` for why this
 * package exists and what stays app-side instead).
 *
 * `GatewayRuntimeConfig` deliberately has **no host/port/listen-address
 * section**: `bootstrap()` never reads one (it never has — this isn't a
 * new restriction introduced by extracting this file, just making explicit
 * a fact that was already true). Host/port belong to
 * `apps/gateway-server`'s own config loader, which constructs its own,
 * app-local config shape that is a superset of `GatewayRuntimeConfig` and
 * passes it here unchanged; `apps/vercel-adapter`'s loader has no such
 * section at all, since Vercel owns request routing entirely. Hosting
 * lifecycle (listen sockets, signal handling, Vercel Function invocation)
 * is exactly the boundary this package does not cross — see this
 * package's README, "What belongs here vs. what stays in an app."
 */
export interface GatewayRuntimeConfig {
  /** Optional path to a `GatewayConfig` JSON file (`@ai-gateway/config`'s `FileConfigSource`). Falls back to `DEFAULT_GATEWAY_CONFIG` plus hot-reload disabled when omitted. */
  gatewayConfigPath?: string;
  /** Which environment variable holds each provider's platform-managed API key (`PlatformScopeResolver`'s own constructor shape, architecture §16.1). */
  providerPlatformKeyEnvVars: {
    groq: string;
    "nvidia-nim": string;
  };
  credentialPriority: CredentialScope[];
  apiKeys: ApiKeyRecord[];
  rateLimit: {
    requestsPerWindow?: number;
    windowMs?: number;
  };
  cache: {
    ttlMs?: number;
    includeTenantInKey?: boolean;
  };
  /**
   * (v1.2, EM-8, ADR-0017) Explicit override of `GatewayConfig.enableStrategyLayer`.
   * `apps/gateway-server`'s own config loader reads the literal
   * `ENABLE_STRATEGY_LAYER` process environment variable and passes it
   * here; when present, it wins over the `GatewayConfig` value. Omit to
   * let `GatewayConfig.enableStrategyLayer` (default `false`) govern.
   */
  enableStrategyLayer?: boolean;
  /**
   * (v1.2, EM-10, architecture §43) Per-tenant `BudgetPolicy` records for
   * `StaticBudgetPolicyProvider`. Omitted or empty means Budget Governance
   * is not constructed at all — no ledger, no enforcer, no
   * `BudgetEnforcementStage` added to the Strategy Pipeline — the same
   * "absent means not there, not there-and-inert" contract
   * `enableStrategyLayer` itself already follows. Requires
   * `enableStrategyLayer` (Budget Enforcement runs *inside* the Strategy
   * Pipeline, architecture §43.3) — configuring policies without also
   * enabling the Strategy Layer has no effect and is not an error.
   */
  budgetPolicies?: BudgetPolicy[];
  /**
   * (v1.2, EM-10, Blueprint §7's explicit EM-10 risk mitigation) Defaults
   * to `"shadow"` — a fresh deployment that configures `budgetPolicies`
   * still enforces nothing until this is explicitly set to `"enforcing"`.
   */
  budgetEnforcementMode?: BudgetEnforcementMode;
  /** (v1.2, EM-10, ADR-014) Platform-wide pipeline step cap. Defaults to `pipeline-orchestrator`'s own default (20) when omitted. */
  maxPipelineSteps?: number;
}

export interface GatewayApp {
  telemetry: Telemetry;
  gatewayConfig: GatewayConfig;
  modelRegistry: ModelRegistry;
  credentialResolver: CredentialResolver;
  healthMonitor: HealthMonitor;
  circuitBreaker: CircuitBreaker;
  policyEngine: PolicyEngine;
  streamManager: StreamManager;
  adapterRegistry: InMemoryProviderAdapterRegistry;
  orchestrator: ExecutionOrchestrator;
  auth: AuthMiddleware;
  rateLimit: RateLimitMiddleware;
  cache: CacheMiddleware;
  pipeline: MiddlewarePipeline;
  adapters: ProviderAdapter[];
  /**
   * (v1.2, EM-8) Present only when the Strategy Layer feature flag
   * resolved to `true` (ADR-0017) — `undefined` when disabled, exactly
   * mirroring whether `orchestrator` itself was constructed with a
   * `strategyLayer` option. Exposed on `GatewayApp` for observability/
   * testing (e.g. asserting the flag actually took effect), not because
   * anything in this package calls it directly beyond the one
   * `DefaultExecutionOrchestrator` constructor call below.
   */
  strategyLayer?: AIStrategyLayer;
  /**
   * (v1.2, EM-10) Present only when `runtimeConfig.budgetPolicies` was
   * non-empty (and thus only ever alongside a defined `strategyLayer` —
   * see `budgetPolicies`'s own doc comment on `GatewayRuntimeConfig`).
   * Exposed the same way `strategyLayer` is: for observability/testing,
   * not because anything outside the one `DefaultAIStrategyLayer`
   * constructor call below needs it directly.
   */
  budgetEnforcer?: BudgetEnforcer;
  /**
   * (v1.2, EM-10 Review Finding 1) The *same* `BudgetLedger` instance
   * `budgetEnforcer` reads from and `orchestrator`'s `onExecutionCompleted`
   * hook writes to. Exposed for the same reason `budgetEnforcer` is —
   * observability/testing (e.g. asserting cumulative spend actually
   * accrued across requests) — not because anything outside the two
   * constructor call sites above needs it directly. `undefined` under the
   * exact same conditions `budgetEnforcer` is.
   */
  budgetLedger?: BudgetLedger;
  /**
   * (v1.2, EM-10) Wraps `orchestrator` — never a second execution engine,
   * always this exact instance's public `execute()`. Constructed
   * unconditionally (Multi-Step Pipelines, architecture §41, have no
   * feature flag of their own — a caller who never sends a pipeline
   * request is completely unaffected by this existing).
   */
  pipelineOrchestrator: DefaultPipelineOrchestrator;
}

/**
 * Test/embedding seam: lets a caller substitute fake provider adapters or
 * model-registry seed data without touching this file. Both apps' test
 * suites use this; a real deployment should rely on the defaults.
 *
 * `instrumentationName`/`defaultActor` are the one piece of per-caller
 * *identity* `bootstrap()` needs (they show up in telemetry spans and in
 * `DefaultCredentialResolver`'s audit log's `actor` field respectively) —
 * not environment-derived config, so they live here rather than on
 * `GatewayRuntimeConfig`. Their defaults are `apps/gateway-server`'s
 * original, pre-extraction v1.0.2 values (`"@ai-gateway/gateway-server"`/
 * `"gateway-server"`) so that app's call site (`bootstrap(serverConfig)`,
 * unchanged) continues to produce byte-for-byte identical telemetry/audit
 * output after this extraction. `apps/vercel-adapter` passes its own
 * (`"@ai-gateway/vercel-adapter"`/`"vercel-adapter"`) explicitly.
 */
export interface BootstrapOverrides {
  adapters?: ProviderAdapter[];
  modelRegistrySeed?: ModelDescriptor[];
  instrumentationName?: string;
  defaultActor?: string;
}

async function loadGatewayConfig(path: string | undefined): Promise<GatewayConfig> {
  if (!path) {
    return DEFAULT_GATEWAY_CONFIG;
  }
  const source = new FileConfigSource(path);
  return loadConfig(source);
}

/**
 * Constructs every platform package instance and wires them into one
 * `GatewayApp` bundle. This exact construction — same packages, same
 * constructors, same order — is what every hosting-specific app in this
 * repository calls; none of them redefine it.
 *
 * `GatewayConfig.reliability` is parsed and validated
 * (`gatewayConfigSchema`) but not yet consumed by anything constructed
 * below (`DefaultHealthMonitor`/`InMemoryCircuitBreaker`/
 * `DefaultRetryEngine` all use their own internal defaults) — see
 * `docs/adr/0010-gatewayconfig-reliability-section-unconsumed.md`.
 */
export async function bootstrap(
  runtimeConfig: GatewayRuntimeConfig,
  overrides: BootstrapOverrides = {},
): Promise<GatewayApp> {
  const telemetry = createTelemetry({
    instrumentationName: overrides.instrumentationName ?? "@ai-gateway/gateway-server",
  });

  const gatewayConfig = await loadGatewayConfig(runtimeConfig.gatewayConfigPath);
  const parsedGatewayConfig = gatewayConfigSchema.safeParse(gatewayConfig);
  if (!parsedGatewayConfig.success) {
    throw new Error(`GatewayConfig failed schema validation: ${parsedGatewayConfig.error.message}`);
  }

  const credentialPriority =
    runtimeConfig.credentialPriority.length > 0
      ? runtimeConfig.credentialPriority
      : parsedGatewayConfig.data.credentialPriority;

  // --- Model Registry ---------------------------------------------------
  const modelRegistry = new DefaultModelRegistry({
    seed: overrides.modelRegistrySeed ?? SEED_MODELS,
  });

  // --- Credential Resolver ------------------------------------------------
  const credentialStore = new InMemoryCredentialStore();
  const encryptor = new AesGcmEncryptor(generateEncryptionKey());
  const auditLogger = new DefaultAuditLogger(telemetry);

  const resolvers = [
    new PlatformScopeResolver({
      groq: runtimeConfig.providerPlatformKeyEnvVars.groq,
      "nvidia-nim": runtimeConfig.providerPlatformKeyEnvVars["nvidia-nim"],
    }),
    new DbScopeResolver("user", credentialStore),
    new DbScopeResolver("project", credentialStore),
    new DbScopeResolver("workspace", credentialStore),
    new DbScopeResolver("organization", credentialStore),
  ];
  const resolutionChain = new DefaultResolutionChain({
    resolvers,
    sources: [new EnvSecretSource(), new DbSecretSource(credentialStore, encryptor)],
    priority: credentialPriority,
  });
  const credentialResolver = new DefaultCredentialResolver({
    chain: resolutionChain,
    auditLogger,
    defaultActor: overrides.defaultActor ?? "gateway-server",
  });

  // --- Reliability ---------------------------------------------------------
  const healthMonitor = new DefaultHealthMonitor();
  const circuitBreaker = new InMemoryCircuitBreaker();
  const retryEngine = new DefaultRetryEngine();

  // --- Policy Engine ---------------------------------------------------------
  const policyEngine = new DefaultPolicyEngine({ modelRegistry, healthMonitor });

  // --- Budget Governance (v1.2, EM-10, architecture §43) --------------------
  // Constructed before `strategyLayer` below, since a non-empty
  // `budgetPolicies` list is what `strategyLayer`'s own construction reads
  // to decide whether to wire a `budgetEnforcer` into it at all.
  //
  // (EM-10 Review Finding 1) `budgetLedger` is hoisted to its own name,
  // rather than constructed inline as `DefaultBudgetEnforcer`'s `ledger`
  // option, specifically so this exact same instance can also be handed to
  // `orchestrator`'s `onExecutionCompleted` hook below —
  // `BudgetLedger.recordSpend` and `BudgetEnforcer.evaluate`'s
  // `BudgetLedger.getSpend` must read and write the *same* store, or spend
  // recorded post-execution would never be visible to a later evaluation.
  const budgetLedger: BudgetLedger | undefined =
    runtimeConfig.budgetPolicies && runtimeConfig.budgetPolicies.length > 0
      ? new InMemoryBudgetLedger()
      : undefined;
  const budgetEnforcer: BudgetEnforcer | undefined =
    runtimeConfig.budgetPolicies && runtimeConfig.budgetPolicies.length > 0 && budgetLedger
      ? new DefaultBudgetEnforcer({
          ledger: budgetLedger,
          policyProvider: new StaticBudgetPolicyProvider(runtimeConfig.budgetPolicies),
          telemetry,
          // Blueprint §7 EM-10's own explicit risk mitigation: "shipping
          // with a 'shadow mode' ... for the first release, promoted to
          // enforcing mode only after a burn-in period" — a fresh
          // deployment enforces nothing until this is set explicitly.
          mode: runtimeConfig.budgetEnforcementMode ?? "shadow",
        })
      : undefined;

  // --- Strategy Layer (v1.2, EM-8, ADR-0017; EM-10 budgetEnforcer) ----------
  // "Disabled" and "no strategyLayer constructed" are the same state, by
  // design (see orchestrator's `ExecutionOrchestratorOptions.strategyLayer`
  // doc comment) — `enableStrategyLayer` is resolved once, here, and
  // nothing downstream needs its own copy of this flag.
  const enableStrategyLayer =
    runtimeConfig.enableStrategyLayer ?? parsedGatewayConfig.data.enableStrategyLayer ?? false;
  const strategyLayer: AIStrategyLayer | undefined = enableStrategyLayer
    ? new DefaultAIStrategyLayer({
        capabilityRegistry: new DefaultCapabilityRegistry({ seed: SEED_CAPABILITIES }),
        executionProfileRegistry: createSeededExecutionProfileRegistry(),
        runtimeProfileRegistry: createSeededRuntimeProfileRegistry(),
        costOptimizer: new DefaultCostOptimizer(),
        promptOptimizer: new DefaultPromptOptimizer(),
        learningRegistry: new DefaultLearningRegistry(),
        cache: new InMemoryCacheClient(),
        budgetEnforcer,
      })
    : undefined;
  // `budgetPolicies` configured without `enableStrategyLayer` has no
  // effect (§43.3 places Budget Enforcement *inside* the Strategy
  // Pipeline) — not an error, per `budgetPolicies`'s own doc comment, but
  // exposed on `GatewayApp` only when it was actually wired in, so a
  // caller can't be misled into thinking it's active when it isn't.
  const wiredBudgetEnforcer = enableStrategyLayer ? budgetEnforcer : undefined;
  // Same gating as `wiredBudgetEnforcer`, for the same reason: a ledger
  // with nothing ever consulting it (Strategy Layer disabled) shouldn't
  // silently start accumulating spend records nobody reads.
  const wiredBudgetLedger = enableStrategyLayer ? budgetLedger : undefined;

  /**
   * (v1.2, EM-10 Review Finding 1) The production wiring `BudgetLedger.recordSpend`
   * was missing entirely: fired once per successful, non-cache-hit
   * `execute()` call — see `orchestrator`'s `onExecutionCompleted` doc
   * comment for the full contract (success-only, not cache hits, failure
   * of this hook never fails the request). `req.tenant` (the tenant the
   * request was actually executed for) and the real, post-execution
   * `response.execution.providerId`/`response.usage.estimatedCostUsd`
   * (not the pre-execution `plannedCostUsd` `BudgetEnforcementStage` saw)
   * are exactly the three arguments architecture §43.2's `recordSpend`
   * signature asks for. `undefined` when Budget Governance isn't actually
   * active — the same "absent means not there" contract every other
   * EM-10/EM-8 optional wiring in this file already follows.
   */
  const onExecutionCompleted = wiredBudgetLedger
    ? (req: ExecuteRequest, response: ExecuteResponse): Promise<void> =>
        wiredBudgetLedger.recordSpend(
          req.tenant,
          response.execution.providerId,
          response.usage.estimatedCostUsd,
        )
    : undefined;

  // --- Provider Adapters ---------------------------------------------------------
  const adapters: ProviderAdapter[] = overrides.adapters ?? [new GroqAdapter(), new NimAdapter()];
  const adapterRegistry = new InMemoryProviderAdapterRegistry(adapters);

  // --- Streaming ---------------------------------------------------------------
  const streamManager = new DefaultStreamManager();

  // --- Orchestrator ---------------------------------------------------------------
  const orchestrator = new DefaultExecutionOrchestrator({
    policyEngine,
    credentialResolver,
    retryEngine,
    streamManager,
    adapterRegistry,
    telemetry,
    circuitBreaker,
    healthMonitor,
    strategyLayer,
    onExecutionCompleted,
  });

  // --- Middleware ---------------------------------------------------------------
  const auth = new AuthMiddleware({ keys: runtimeConfig.apiKeys, telemetry });
  const rateLimit = new RateLimitMiddleware({
    requestsPerWindow: runtimeConfig.rateLimit.requestsPerWindow,
    windowMs: runtimeConfig.rateLimit.windowMs,
    telemetry,
  });
  const cache = new CacheMiddleware({
    ttlMs: runtimeConfig.cache.ttlMs,
    includeTenantInKey: runtimeConfig.cache.includeTenantInKey,
    telemetry,
  });
  const pipeline = new MiddlewarePipeline({ auth, rateLimit, cache });

  // --- Pipeline Orchestrator (v1.2, EM-10, architecture §41) ----------------
  // Wraps `orchestrator` above — the exact same instance every single-request
  // caller uses, never a second execution engine.
  const pipelineOrchestrator = new DefaultPipelineOrchestrator({
    orchestrator,
    maxSteps: runtimeConfig.maxPipelineSteps,
  });

  return {
    telemetry,
    gatewayConfig: parsedGatewayConfig.data,
    modelRegistry,
    credentialResolver,
    healthMonitor,
    circuitBreaker,
    policyEngine,
    streamManager,
    adapterRegistry,
    orchestrator,
    auth,
    rateLimit,
    cache,
    pipeline,
    adapters,
    strategyLayer,
    budgetEnforcer: wiredBudgetEnforcer,
    budgetLedger: wiredBudgetLedger,
    pipelineOrchestrator,
  };
}
