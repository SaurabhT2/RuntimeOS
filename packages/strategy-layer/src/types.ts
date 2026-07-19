import type { CapabilitySet } from "@ai-gateway/capability-registry";
import type { CostOptimizationResult, CachedResult } from "@ai-gateway/cost-optimizer";
import type { ExecuteRequest } from "@ai-gateway/core-contracts";
import type { ResolvedExecutionProfile } from "@ai-gateway/execution-profile-registry";
import type { OptimizedPrompt } from "@ai-gateway/prompt-optimizer";
import type { RuntimeProfile } from "@ai-gateway/runtime-profiles";

/**
 * `core-contracts` does not export a standalone `TenantContext` type — only
 * `ExecuteRequest.tenant`'s inline shape. Same duplication precedent as
 * `middleware`/`credential-resolver`'s own `TenantContext = ExecuteRequest["tenant"]`
 * (see `packages/middleware/src/types.ts`).
 */
export type TenantContext = ExecuteRequest["tenant"];

/**
 * architecture §30.3, **verbatim** — this is the one, frozen, authoritative
 * shape. It does not match the EM-8 work order's own paraphrase of this
 * type's fields (which lists `resolvedCapabilities`, `runtimeProfile`,
 * `optimizedPrompt`, `optimizationMetadata`, `routingHints`,
 * `executionHints` — none of which are this interface's actual field
 * names, and several of which don't exist on it at all). Per this whole
 * project's established governance (architecture spec and Engineering
 * Blueprint are authoritative over any other document, including a work
 * order), this package implements §30.3 exactly as written, not the work
 * order's paraphrase. See this package's README, "A note on the work
 * order's `StrategyDecision` field list," for the full accounting of every
 * difference and how each named EM-8 concept (Runtime Profile, Learning
 * Hooks, routing/execution hints) is actually realized without adding
 * fields to this frozen type.
 */
export interface StrategyDecision {
  requiredCapabilities: CapabilitySet;
  executionProfile: ResolvedExecutionProfile;
  optimizations: {
    cost: CostOptimizationResult;
    prompt: OptimizedPrompt;
  };
  /**
   * architecture §30.3: "short-circuits the Policy Engine entirely if
   * present." Always exactly `optimizations.cost.cacheHit` — promoted to
   * the top level so a caller (`orchestrator`) can check for a short-circuit
   * without reaching into `optimizations.cost` first.
   */
  cacheHit?: CachedResult;
}

/**
 * architecture §30.3, verbatim.
 *
 * `buildStrategy` never calls a provider, never references a concrete
 * `providerId`/`modelId`, and never branches on any business/domain
 * concept — it operates only on `task`, resolved capabilities, and
 * resolved profiles (EM-8's "No Provider Awareness"/"No Business Logic"
 * constraints).
 */
export interface AIStrategyLayer {
  buildStrategy(req: ExecuteRequest, ctx: TenantContext): Promise<StrategyDecision>;
}

/**
 * Not named in architecture §30.3 — the frozen interface only names
 * `AIStrategyLayer` and `StrategyDecision`. `StrategyContext` is this
 * package's own, designed-not-specified internal pipeline-state type
 * (Blueprint/EM-8 work order names it as a required public export without
 * further detail): the accumulator threaded through
 * `StrategyPipeline`'s ordered stages, each of which reads what prior
 * stages resolved and returns a new context with its own contribution
 * added — never mutating the context it was given (see `StrategyPipeline`'s
 * own doc comment for why: EM-8's "Immutable Decisions" constraint applies
 * to the final `StrategyDecision`, but this codebase's broader "no
 * downstream mutation" habit — e.g. every pipeline stage in
 * `@ai-gateway/prompt-optimizer` — extends that discipline to intermediate
 * pipeline state too, not just the final output).
 */
export interface StrategyContext {
  readonly request: ExecuteRequest;
  readonly tenant: TenantContext;
  readonly requiredCapabilities?: CapabilitySet;
  readonly executionProfile?: ResolvedExecutionProfile;
  readonly runtimeProfile?: RuntimeProfile;
  readonly optimizedPrompt?: OptimizedPrompt;
  readonly costOptimization?: CostOptimizationResult;
}

/**
 * One stage of the Strategy Pipeline (architecture §30.2's diagram: `CAP
 * --> PROF --> OPT --> DECISION`, refined by the EM-8 work order into six
 * named stages). "Every stage must remain independently replaceable"
 * (EM-8 constraint) — satisfied by each stage being a small, separately
 * exported, separately unit-tested class implementing this one-method
 * interface, with no stage aware of any other stage's existence.
 */
export interface StrategyPipelineStage {
  readonly name: string;
  run(ctx: StrategyContext): Promise<StrategyContext>;
}
