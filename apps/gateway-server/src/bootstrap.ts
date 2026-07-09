import { createTelemetry, type Telemetry } from "@ai-gateway/telemetry";
import {
  DEFAULT_GATEWAY_CONFIG,
  FileConfigSource,
  gatewayConfigSchema,
  loadConfig,
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
import {
  AuthMiddleware,
  CacheMiddleware,
  MiddlewarePipeline,
  RateLimitMiddleware,
} from "@ai-gateway/middleware";
import { GroqAdapter } from "@ai-gateway/groq";
import { NimAdapter } from "@ai-gateway/nvidia-nim";
import type { GatewayServerConfig } from "./server-config.js";

/**
 * The single composition root (architecture §6.4): the only place in the
 * entire codebase permitted to import a concrete implementation of every
 * interface simultaneously, constructing and wiring each one exactly once
 * at process start. This file only ever calls documented
 * constructors/factory functions from each package's own public API
 * (barrel exports) — it never reaches into a package's internals, and no
 * package it touches has its own source modified.
 *
 * Deliberately **not** a class — one function returning a plain bundle of
 * already-wired instances, matching `orchestrator`'s own "a sequencing
 * function, not a class hierarchy" precedent (Blueprint §8.11) at the
 * composition-root layer.
 */
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
}

/**
 * Loads the tenant/admin-facing `GatewayConfig` (architecture §10.6). A
 * configured path is loaded and validated via `@ai-gateway/config`'s own
 * `FileConfigSource`/`loadConfig`; an omitted path falls back to
 * `DEFAULT_GATEWAY_CONFIG`. Hot-reload (`watchConfig`) is intentionally
 * not wired here — nothing in this milestone's named scope (Blueprint
 * §7 EM-5's "Features delivered" line) requires live config reload for
 * the v1.0 MVP, and every other consumer of a `GatewayConfig` in this
 * codebase already assumes the one-shot, `loadConfig`-produced shape.
 */
async function loadGatewayConfig(path: string | undefined): Promise<GatewayConfig> {
  if (!path) {
    return DEFAULT_GATEWAY_CONFIG;
  }
  const source = new FileConfigSource(path);
  return loadConfig(source);
}

/**
 * Test/embedding seam: every field is optional and, when supplied,
 * replaces the corresponding concrete instance this function would
 * otherwise construct itself. Exists so integration tests can exercise
 * the *real* composition root — same `bootstrap()` function, same
 * wiring order — while substituting only the one piece that must never
 * make a live network call in a test run (`adapters`), matching this
 * codebase's established convention (`GroqAdapter`/`NimAdapter`'s own
 * `fetchImpl` constructor option, documented the same way in their own
 * READMEs: "a test seam, never live calls in CI").
 */
export interface BootstrapOverrides {
  adapters?: ProviderAdapter[];
  /** Replaces `SEED_MODELS` as `DefaultModelRegistry`'s seed data — primarily a test seam for a small, deterministic two-provider catalog (see `test/fixtures.ts`); a real deployment should rely on the default. */
  modelRegistrySeed?: ModelDescriptor[];
}

/**
 * Constructs every platform package instance and wires them into one
 * `GatewayApp` bundle. Throws (never silently degrades) if `gatewayConfig`
 * fails schema validation — the same fail-fast posture `server-config.ts`'s
 * env loading already applies to this process's own bootstrap settings.
 *
 * ## ADR candidate surfaced while wiring this function
 *
 * `GatewayConfig.reliability` (`maxRetries`, `backoff`,
 * `circuitBreakerThreshold` — architecture §10.6, frozen EM-1) is not
 * actually consumed by any package as of the EM-4 baseline: `policy-engine`
 * hardcodes `DEFAULT_RETRY_POLICY` on every `ExecutionPlan`
 * (`policy-engine.ts`, unconditionally) rather than reading
 * `maxRetries`/`backoff` from a `GatewayConfig`, and no package anywhere
 * reads `circuitBreakerThreshold` at all. This composition root is the
 * first place in the codebase that could plausibly wire it — but
 * `circuitBreakerThreshold`'s declared type (`z.number().int().positive()`,
 * default `5`) is not obviously the same quantity as
 * `CircuitBreaker`'s actual `failureRateThreshold` (a `0..1` rolling
 * failure *rate*, default `0.5`, over a `rollingWindowSize` of `20`):
 * neither `GatewayConfig`'s schema nor architecture §10.6/§18.2 states
 * whether `circuitBreakerThreshold: 5` means "5 failures," "a rate of
 * 5%," or something else. Silently picking an interpretation here (e.g.
 * `circuitBreakerThreshold / 100`) risks misconfiguring the breaker in a
 * real deployment with no way for an operator to know that happened. Per
 * this milestone's "if implementation reveals an architectural
 * inconsistency, document it as an ADR candidate — do not redesign the
 * architecture" instruction, this constructs `InMemoryCircuitBreaker` and
 * `DefaultRetryEngine` with their own shipped defaults
 * (`DEFAULT_CIRCUIT_BREAKER_OPTIONS`, `DEFAULT_RETRY_POLICY`, both applied
 * automatically when no override is passed) rather than forcing a guessed
 * mapping — see `docs/adr/0010-gatewayconfig-reliability-section-unconsumed.md`
 * (ADR candidate; this milestone's Deliverables, ADR Candidates) for the
 * full write-up and options for the Board.
 */
export async function bootstrap(
  serverConfig: GatewayServerConfig,
  overrides: BootstrapOverrides = {},
): Promise<GatewayApp> {
  const telemetry = createTelemetry({ instrumentationName: "@ai-gateway/gateway-server" });

  const gatewayConfig = await loadGatewayConfig(serverConfig.gatewayConfigPath);
  const parsedGatewayConfig = gatewayConfigSchema.safeParse(gatewayConfig);
  if (!parsedGatewayConfig.success) {
    throw new Error(`GatewayConfig failed schema validation: ${parsedGatewayConfig.error.message}`);
  }

  const credentialPriority =
    serverConfig.credentialPriority.length > 0
      ? serverConfig.credentialPriority
      : parsedGatewayConfig.data.credentialPriority;

  // --- Model Registry (Wave 2) ---------------------------------------
  // `SEED_MODELS` is a placeholder seed table (see model-registry's own
  // README, Design notes): its `modelId` values are illustrative, not
  // real provider-hosted model identifiers. `GroqAdapter`/`NimAdapter`
  // pass `NormalizedInvocation.modelId` straight through as the literal
  // provider-side model string (EM-3 Engineering Decision 3), so a real
  // deployment against live Groq/NIM APIs must supply its own
  // `ModelDescriptor` rows with real model IDs — an operator/config
  // concern (architecture §14.2: "no redeploy"), not something this
  // composition root can responsibly invent. `SEED_MODELS` is used as the
  // default here because it is the only registry data that exists
  // anywhere in this repo; see this package's README, Deferred Work, and
  // this milestone's own README, Deferred Work.
  const modelRegistry = new DefaultModelRegistry({
    seed: overrides.modelRegistrySeed ?? SEED_MODELS,
  });

  // --- Credential Resolver (Wave 2) -----------------------------------
  const credentialStore = new InMemoryCredentialStore();
  const encryptor = new AesGcmEncryptor(generateEncryptionKey());
  const auditLogger = new DefaultAuditLogger(telemetry);

  const resolvers = [
    new PlatformScopeResolver({
      groq: serverConfig.providerPlatformKeyEnvVars.groq,
      "nvidia-nim": serverConfig.providerPlatformKeyEnvVars["nvidia-nim"],
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
    defaultActor: "gateway-server",
  });

  // --- Reliability (Wave 2) -------------------------------------------
  // See this function's own doc comment above: `GatewayConfig.reliability`
  // is not wired here — its shipped defaults are used instead (ADR
  // candidate 0010).
  const healthMonitor = new DefaultHealthMonitor();
  const circuitBreaker = new InMemoryCircuitBreaker();
  const retryEngine = new DefaultRetryEngine();

  // --- Policy Engine (Wave 3) ------------------------------------------
  const policyEngine = new DefaultPolicyEngine({ modelRegistry, healthMonitor });

  // --- Provider Adapters (Wave 3) --------------------------------------
  const adapters: ProviderAdapter[] = overrides.adapters ?? [new GroqAdapter(), new NimAdapter()];
  const adapterRegistry = new InMemoryProviderAdapterRegistry(adapters);

  // --- Streaming (Wave 3) ------------------------------------------------
  const streamManager = new DefaultStreamManager();

  // --- Orchestrator (Wave 4) --------------------------------------------
  const orchestrator = new DefaultExecutionOrchestrator({
    policyEngine,
    credentialResolver,
    retryEngine,
    streamManager,
    adapterRegistry,
    telemetry,
    circuitBreaker,
    healthMonitor,
  });

  // --- Middleware (Wave 4) -----------------------------------------------
  const auth = new AuthMiddleware({ keys: serverConfig.apiKeys, telemetry });
  const rateLimit = new RateLimitMiddleware({
    requestsPerWindow: serverConfig.rateLimit.requestsPerWindow,
    windowMs: serverConfig.rateLimit.windowMs,
    telemetry,
  });
  const cache = new CacheMiddleware({
    ttlMs: serverConfig.cache.ttlMs,
    includeTenantInKey: serverConfig.cache.includeTenantInKey,
    telemetry,
  });
  const pipeline = new MiddlewarePipeline({ auth, rateLimit, cache });

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
  };
}
