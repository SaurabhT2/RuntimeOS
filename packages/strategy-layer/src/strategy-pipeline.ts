import type { ExecuteRequest } from "@ai-gateway/core-contracts";
import type {
  StrategyContext,
  StrategyDecision,
  StrategyPipelineStage,
  TenantContext,
} from "./types.js";

/** Blueprint/EM-8 work order-named public export. Runs the ordered stages and assembles the final, immutable `StrategyDecision`. */
export interface StrategyPipeline {
  run(request: ExecuteRequest, tenant: TenantContext): Promise<StrategyDecision>;
}

/**
 * Thrown if a stage's contract is violated (a required field was not
 * resolved by the time the pipeline finishes) — this should never happen
 * with `DEFAULT_STRATEGY_STAGES` (each stage validates its own
 * preconditions; see each stage's own `run` method), but a custom
 * `StrategyPipelineStage[]` list supplied by a caller (this pipeline's
 * whole point is that stages are "independently replaceable," per EM-8)
 * could omit a required stage.
 */
export class IncompleteStrategyDecisionError extends Error {
  constructor(missingField: string) {
    super(
      `Strategy pipeline finished without resolving "${missingField}" — check that every required stage is present in the configured pipeline.`,
    );
    this.name = "IncompleteStrategyDecisionError";
  }
}

/**
 * Recursively `Object.freeze`s `value` and every plain object/array reachable
 * from it. `Object.freeze` on its own is shallow — it only locks the
 * top-level property bindings, leaving any nested object or array fully
 * mutable — so freezing just the top of a decision (or just one extra level)
 * does not actually satisfy "every nested object must be immutable"
 * (EM-8 constraint 4). This walks the whole structure once, depth-first,
 * freezing children before parents.
 *
 * Deliberately narrow on purpose: `StrategyDecision`'s entire tree
 * (`CapabilitySet`, `ResolvedExecutionProfile`, `RetryPolicy`,
 * `CostOptimizationResult`, `OptimizedPrompt`, `CachedResult`, and every
 * array among them — `preferredModelClasses`, `retryableErrorCodes`,
 * `messages`, `transformationsApplied`) is plain, JSON-shaped data: plain
 * objects, arrays, and primitives, no `Date`/`Map`/`Set`/class instances,
 * no cycles. A general-purpose deep-freeze would also need to guard against
 * cycles and special-case exotic object types; this one does not, because
 * nothing in this specific tree needs that, and silently "succeeding" on an
 * unsupported shape would be worse than the narrower, correct version.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Object.isFrozen(value)) {
    // Already frozen (or shared/reused) — do not re-walk it. Also the only
    // thing standing between this function and infinite recursion if this
    // tree's "no cycles" assumption is ever violated.
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function assembleDecision(ctx: StrategyContext): StrategyDecision {
  if (!ctx.requiredCapabilities) {
    throw new IncompleteStrategyDecisionError("requiredCapabilities");
  }
  if (!ctx.executionProfile) {
    throw new IncompleteStrategyDecisionError("executionProfile");
  }
  if (!ctx.costOptimization) {
    throw new IncompleteStrategyDecisionError("costOptimization");
  }
  if (!ctx.optimizedPrompt) {
    throw new IncompleteStrategyDecisionError("optimizedPrompt");
  }

  const decision: StrategyDecision = {
    requiredCapabilities: ctx.requiredCapabilities,
    executionProfile: ctx.executionProfile,
    optimizations: {
      cost: ctx.costOptimization,
      prompt: ctx.optimizedPrompt,
    },
    cacheHit: ctx.costOptimization.cacheHit,
  };

  // EM-8 constraint 4, "Immutable Decisions: every StrategyDecision must be
  // immutable. No downstream mutation." `Object.freeze` alone is shallow —
  // it only locks the top level, leaving every nested object/array (e.g.
  // `executionProfile.retryPolicy`, `executionProfile.retryPolicy
  // .retryableErrorCodes`, `optimizations.prompt.messages`) mutable. Review
  // Finding 1 (Independent Architecture & Engineering Review) confirmed
  // exactly that gap, plus this comment previously claiming otherwise.
  // `deepFreeze` walks the whole tree depth-first, so every plain
  // object/array this decision reaches — not just its first one or two
  // levels — is genuinely frozen.
  return deepFreeze(decision);
}

/**
 * architecture §30.2's pipeline, refined into the EM-8 work order's six
 * named stages: Capability → Execution Profile → Runtime Profile → Prompt
 * Optimization → Cost Optimization → Learning Hooks → `StrategyDecision`
 * (see `stages/prompt-optimization-stage.ts` for why Prompt Optimization
 * runs before Cost Optimization, reordered from the work order's own
 * listed order to match architecture §33/§34's actual dataflow).
 */
export class DefaultStrategyPipeline implements StrategyPipeline {
  constructor(private readonly stages: StrategyPipelineStage[]) {}

  async run(request: ExecuteRequest, tenant: TenantContext): Promise<StrategyDecision> {
    let ctx: StrategyContext = { request, tenant };
    for (const stage of this.stages) {
      ctx = await stage.run(ctx);
    }
    return assembleDecision(ctx);
  }
}
