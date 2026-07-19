import type { CapabilitySet } from "@ai-gateway/capability-registry";
import type { ResolvedExecutionProfile } from "@ai-gateway/execution-profile-registry";
import type { RuntimeProfile } from "@ai-gateway/runtime-profiles";

/**
 * architecture §33.2's `CacheClient`'s companion type, `CachedResult` — its
 * own shape isn't spelled out there (only referenced as the type of
 * `cacheHit`/`CostOptimizationResult.cacheHit`). Designed, not specified:
 * enough to short-circuit downstream execution with (Section 33.4:
 * "Orchestrator returns it directly without ever invoking the Policy
 * Engine, Credential Resolver, or any Provider Adapter") without this
 * package needing to know the real `ExecuteResponse` shape — importing
 * `core-contracts` for that isn't available (Blueprint §4.1's table lists
 * only `capability-registry`, `execution-profile-registry`,
 * `runtime-profiles`), so this is a minimal, self-contained shape a future
 * Strategy Layer (EM-8) can adapt into a real `ExecuteResponse`.
 */
export interface CachedResult {
  content: string;
  providerId?: string;
  modelId?: string;
  /** Epoch ms the cached entry was written. */
  cachedAt: number;
}

/**
 * architecture §31.2's `caching.keyStrategy` field, duplicated here (not
 * imported) for the same reason `runtime-profiles` duplicates
 * `ModelLifecycleState` — this package's dependency on
 * `execution-profile-registry` only brings in `ResolvedExecutionProfile`;
 * this two-value literal union is small enough that re-declaring it avoids
 * a needless coupling to that package's own internal field-level schema.
 */
export type CacheKeyStrategy = "exact" | "semantic";

/**
 * architecture §33.2: "read-only lookup handle." This package has no
 * dependency on whatever concrete cache backend the deployment uses
 * (Redis, in-memory, etc.) — same "adapter, not implementation" stance as
 * every other injected dependency in this codebase (Principle P4).
 */
export interface CacheClient {
  lookup(key: string, strategy: CacheKeyStrategy): Promise<CachedResult | undefined>;
}

/**
 * architecture §33.2, verbatim shape. `task` is typed as a plain `string`
 * rather than importing `core-contracts`' `TaskType` — this package has no
 * dependency edge on `core-contracts` (Blueprint §4.1's table), and
 * `TaskType` is itself defined as `KnownTaskType | (string & {})`, i.e.
 * structurally a plain extensible string; nothing is lost by using `string`
 * directly here.
 */
export interface OptimizationContext {
  task: string;
  capabilities: CapabilitySet;
  profile: ResolvedExecutionProfile;
  promptTokenEstimate: number;
  runtimeProfile: RuntimeProfile;
  cache: CacheClient;
}

/** architecture §33.2, verbatim shape. */
export interface CostOptimizationResult {
  /** e.g. force "fast-extraction" over "complex-reasoning" if the task doesn't need depth. */
  recommendedModelClassDowngrade?: string;
  /** Did the task actually need deep reasoning, or was that a default assumption? */
  reasoningRequired: boolean;
  /** e.g. short, non-interactive outputs don't benefit from streaming overhead. */
  disableStreaming?: boolean;
  /** Exact or semantic match found — short-circuits everything downstream (architecture §33.4). */
  cacheHit?: CachedResult;
  /** From Runtime Profile + workspace budget state. */
  preferFreeTierProviders: boolean;
  estimatedCostUsd: number;
  /** vs. the naive/default profile execution. */
  estimatedSavingsUsd: number;
}
