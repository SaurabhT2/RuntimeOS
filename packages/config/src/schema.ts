import { z } from "zod";
import type { TaskType } from "@ai-gateway/core-contracts";

/**
 * The five credential scopes, most-specific first (architecture §15.1).
 * `GatewayConfig.credentialPriority` orders these for the Credential
 * Resolver's resolution chain (architecture §15.2) — `config` only carries
 * the ordering; `credential-resolver` (Wave 2) is the package that acts on
 * it.
 */
export const CREDENTIAL_SCOPES = [
  "user",
  "project",
  "workspace",
  "organization",
  "platform",
] as const;

export type CredentialScope = (typeof CREDENTIAL_SCOPES)[number];

export const ROUTING_STRATEGIES = [
  "cost_optimized",
  "latency_optimized",
  "quality_optimized",
] as const;

export type RoutingStrategy = (typeof ROUTING_STRATEGIES)[number];

/**
 * Per-task routing override (architecture §10.6's `RoutingOverride`, named
 * but not spelled out there). Kept intentionally minimal for EM-1: a
 * strategy override plus an optional provider allow-list is enough to
 * express "route this task type differently" without any scoring logic
 * living here — scoring itself is `policy-engine`'s job (Wave 3).
 */
export interface RoutingOverride {
  strategy?: RoutingStrategy;
  preferredProviders?: string[];
}

export const routingOverrideSchema: z.ZodType<RoutingOverride> = z.object({
  strategy: z.enum(ROUTING_STRATEGIES).optional(),
  preferredProviders: z.array(z.string().min(1)).optional(),
});

export const BACKOFF_STRATEGIES = ["exponential", "linear"] as const;
export type BackoffStrategy = (typeof BACKOFF_STRATEGIES)[number];

/**
 * architecture §10.6. The tenant/admin-facing configuration model — never
 * consulted per-request (that's `ExecuteRequest`, `core-contracts`); this is
 * deployment-level configuration, loaded once at startup and refreshed on
 * hot-reload.
 */
export interface GatewayConfig {
  credentialPriority: CredentialScope[];
  routing: {
    defaultStrategy: RoutingStrategy;
    perTaskOverrides?: Partial<Record<TaskType, RoutingOverride>>;
  };
  reliability: {
    maxRetries: number;
    backoff: BackoffStrategy;
    circuitBreakerThreshold: number;
  };
  /**
   * (v1.1, EM-6, ADR-0013) Selects the active Runtime Profile (architecture
   * §37) for this tenant/deployment — "via `GatewayConfig`, Section 10.6 —
   * extended with an optional `runtimeProfileId` field" (architecture
   * §37.4, verbatim). Typed as a plain, unconstrained `string` here rather
   * than `@ai-gateway/runtime-profiles`' `RuntimeProfileId` union: `config`
   * is a dependency *of* `runtime-profiles` (Blueprint §4.1's
   * `DEPENDENCY_TABLE`), so `config` importing that type back would be a
   * cycle. Left `undefined`, a consumer falls back to
   * `runtime-profiles`' own `DEFAULT_RUNTIME_PROFILE_ID` (`"production"`).
   */
  runtimeProfileId?: string;
  /**
   * (v1.2, EM-8, ADR-0017) Feature flag for the AI Strategy Layer
   * (architecture §30). Defaults to `false` — when absent or `false`,
   * `orchestrator` calls `policy-engine` directly, exactly as it did in
   * EM-7; when `true`, `orchestrator` calls `@ai-gateway/strategy-layer`
   * first and threads the resulting `StrategyDecision` into
   * `PolicyContext.strategyDecision` (ADR-0018). `apps/gateway-server`'s
   * runtime config loader also honors a literal `ENABLE_STRATEGY_LAYER`
   * process environment variable as an override of this field — see
   * ADR-0017 for why that lives at the app/bootstrap layer rather than as
   * a second config-loading mechanism inside this package.
   */
  enableStrategyLayer?: boolean;
}

export const gatewayConfigSchema: z.ZodType<GatewayConfig> = z.object({
  credentialPriority: z
    .array(z.enum(CREDENTIAL_SCOPES))
    .min(1, "credentialPriority must list at least one scope"),
  routing: z.object({
    defaultStrategy: z.enum(ROUTING_STRATEGIES),
    perTaskOverrides: z.record(routingOverrideSchema).optional(),
  }),
  reliability: z.object({
    maxRetries: z.number().int().nonnegative(),
    backoff: z.enum(BACKOFF_STRATEGIES),
    circuitBreakerThreshold: z.number().int().positive(),
  }),
  runtimeProfileId: z.string().min(1).optional(),
  enableStrategyLayer: z.boolean().optional(),
});

/**
 * The sane, documented default `GatewayConfig` (Blueprint §8.2: "sane
 * defaults plus full override-ability"). Used whenever a deployment doesn't
 * supply every field explicitly.
 */
export const DEFAULT_GATEWAY_CONFIG: GatewayConfig = {
  credentialPriority: ["user", "project", "workspace", "organization", "platform"],
  routing: {
    defaultStrategy: "quality_optimized",
  },
  reliability: {
    maxRetries: 2,
    backoff: "exponential",
    circuitBreakerThreshold: 5,
  },
};
