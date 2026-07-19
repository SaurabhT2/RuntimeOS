import type { PromptTransformer } from "../types.js";
import { estimateTokens } from "../token-estimator.js";

/**
 * architecture §34.3: "Drops or summarizes lowest-relevance context when
 * `estimatedTokens` exceeds `budget.maxInputTokens`, prioritizing the most
 * recent turns and any explicitly marked 'must keep' content." This
 * implementation's "must keep" content is every `role: "system"` message
 * (the closest concept this milestone's `ChatMessage` shape has to an
 * explicit keep-marker — architecture §10.3 has no other priority field on
 * a message); "most recent turns" means non-system messages are dropped
 * oldest-first until the array fits the budget or only the single most
 * recent non-system message remains (never drops the last one — an empty
 * conversation is never a valid trim result).
 *
 * A no-op when the array already fits the budget.
 */
export const contextTrimmedTransformer: PromptTransformer = {
  id: "context_trimmed",
  apply(messages, ctx) {
    if (estimateTokens(messages) <= ctx.budget.maxInputTokens) {
      return messages;
    }

    const systemMessages = messages.filter((m) => m.role === "system");
    const conversation = messages.filter((m) => m.role !== "system");

    const trimmed = [...conversation];
    while (
      trimmed.length > 1 &&
      estimateTokens([...systemMessages, ...trimmed]) > ctx.budget.maxInputTokens
    ) {
      trimmed.shift();
    }

    return [...systemMessages, ...trimmed];
  },
};
