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
import {
  AuthMiddleware,
  CacheMiddleware,
  MiddlewarePipeline,
  RateLimitMiddleware,
  type ApiKeyRecord,
} from "@ai-gateway/middleware";
import { GroqAdapter } from "@ai-gateway/groq";
import { NimAdapter } from "@ai-gateway/nvidia-nim";

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
