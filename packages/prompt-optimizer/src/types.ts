import type { ChatMessage } from "@ai-gateway/core-contracts";

/** architecture §34.2, verbatim. */
export interface TokenBudget {
  maxInputTokens: number;
  reservedForOutput: number;
}

/**
 * architecture §34.2, verbatim shape. `transformationsApplied`'s exact
 * semantics aren't specified beyond the field name — `DefaultPromptOptimizer`
 * (Independent Engineering Review of EM-7, Issue #9) populates it with only
 * the transformers that were both pipeline-eligible for this call (i.e. not
 * excluded by `EXACT_WORDING_PROFILE_IDS`) *and* produced an observable
 * change to the message array, not every transformer that merely ran. A
 * `normalized` transformer that found nothing to normalize, for example,
 * does not appear here even though it always executes. This is a
 * deliberate interpretation, chosen because it makes the field tell a
 * caller what actually happened to their prompt rather than which pipeline
 * stages exist — see `prompt-optimizer.ts`'s `DefaultPromptOptimizer.optimize`.
 */
export interface OptimizedPrompt {
  messages: ChatMessage[];
  estimatedTokens: number;
  transformationsApplied: PromptTransformationId[];
}

/** architecture §34.2, verbatim — the six named transformers of §34.3's pipeline table. */
export type PromptTransformationId =
  | "compressed"
  | "context_trimmed"
  | "duplicates_removed"
  | "system_prompt_deduped"
  | "normalized"
  | "long_context_windowed";

/**
 * architecture §34.2, verbatim. `apply` is deliberately synchronous and
 * side-effect-free (no provider call, no I/O) — architecture §34.1: "It
 * operates purely on the normalized `ChatMessage[]` shape... it never sees
 * a provider-specific request body."
 */
export interface PromptTransformer {
  id: PromptTransformationId;
  apply(messages: ChatMessage[], ctx: { budget: TokenBudget }): ChatMessage[];
}
