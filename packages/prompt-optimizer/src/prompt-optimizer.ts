import type { ChatMessage } from "@ai-gateway/core-contracts";
import type { ResolvedExecutionProfile } from "@ai-gateway/execution-profile-registry";
import { estimateTokens } from "./token-estimator.js";
import { DEFAULT_TRANSFORMER_PIPELINE } from "./transformers/index.js";
import type { OptimizedPrompt, PromptTransformationId, TokenBudget } from "./types.js";

/**
 * DEVIATION FROM BLUEPRINT §4.1's LITERAL TABLE, FLAGGED FOR BOARD
 * AWARENESS (same category as the EM-6-era §31.4/§37.2 field-naming
 * inconsistency the Independent Architecture Review recorded as "flagged
 * for Board awareness, not a defect in this milestone"): Blueprint §4.1's
 * dependency table lists `prompt-optimizer`'s dependencies as
 * `capability-registry, core-contracts` only. But architecture §34.2's
 * frozen `PromptOptimizer.optimize` signature — which this milestone must
 * implement exactly, per this milestone's own "do not modify existing
 * interfaces" constraint — takes a `profile: ResolvedExecutionProfile`
 * parameter, and `ResolvedExecutionProfile` is `execution-profile-registry`'s
 * own exported type (confirmed: that package's `index.ts` is its only
 * home). Implementing §34.2's interface verbatim is therefore impossible
 * without an `execution-profile-registry` dependency edge the table
 * doesn't list. Resolved the same way EM-6 resolved its own architecture-
 * spec-vs-Blueprint tension: followed the more specific, directly-binding
 * source (the frozen interface signature) over the summary table, and
 * added the one dependency edge required to satisfy it — see this
 * package's `package.json` and `.dependency-cruiser.cjs`'s
 * `prompt-optimizer` entry, both updated identically. No other Blueprint
 * §4.1 edge for this package was touched.
 */

/**
 * architecture §34.3: "never applied to profiles like `coding` or
 * `json_generation` where exact wording may matter." These two are the
 * architecture's own named examples, not an exhaustive enumeration — but
 * this milestone implements exactly what's named, matching Blueprint §7
 * EM-7's acceptance criterion ("tested explicitly for the `coding`/
 * `json_generation` profiles") rather than speculatively excluding other
 * profiles the architecture doesn't name.
 */
export const EXACT_WORDING_PROFILE_IDS: ReadonlySet<string> = new Set([
  "coding",
  "json_generation",
]);

function messagesEqual(a: ChatMessage[], b: ChatMessage[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((message, i) => {
    const other = b[i];
    return (
      other !== undefined &&
      message.role === other.role &&
      message.content === other.content &&
      message.name === other.name
    );
  });
}

/** architecture §34.2, verbatim. */
export interface PromptOptimizer {
  optimize(
    messages: ChatMessage[],
    budget: TokenBudget,
    profile: ResolvedExecutionProfile,
  ): Promise<OptimizedPrompt>;
}

/**
 * architecture §34's Prompt Optimization Layer (§34.1: "runs inside the
 * Optimization Pipeline... provider-independent... operates purely on the
 * normalized `ChatMessage[]` shape"). Transforms prompts only — never
 * calls a provider, and is not wired into `orchestrator`/`cost-optimizer`
 * (that integration is EM-8's job, Blueprint §7).
 */
export class DefaultPromptOptimizer implements PromptOptimizer {
  async optimize(
    messages: ChatMessage[],
    budget: TokenBudget,
    profile: ResolvedExecutionProfile,
  ): Promise<OptimizedPrompt> {
    const excludeCompression = EXACT_WORDING_PROFILE_IDS.has(profile.id);
    const pipeline = DEFAULT_TRANSFORMER_PIPELINE.filter(
      (transformer) => !(excludeCompression && transformer.id === "compressed"),
    );

    let current = messages;
    const transformationsApplied: PromptTransformationId[] = [];
    for (const transformer of pipeline) {
      const next = transformer.apply(current, { budget });
      if (!messagesEqual(next, current)) {
        transformationsApplied.push(transformer.id);
      }
      current = next;
    }

    return {
      messages: current,
      estimatedTokens: estimateTokens(current),
      transformationsApplied,
    };
  }
}
