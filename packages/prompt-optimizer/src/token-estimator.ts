import type { ChatMessage } from "@ai-gateway/core-contracts";

/**
 * architecture §34.4: "A provider-agnostic estimator (not a provider's
 * exact tokenizer, since the eventual model isn't chosen yet at this
 * pipeline stage)... the estimator only needs to be good enough to drive
 * trimming decisions, not to be billing-accurate." Designed, not specified:
 * the common "~4 characters per token" approximation for English-language
 * text, applied per-message content plus a small fixed per-message
 * overhead for role/formatting, then summed. This deliberately
 * over-approximates slightly (real BPE tokenizers are usually a bit more
 * efficient than 4 chars/token for common English text) so that budgeting
 * decisions err toward trimming a little early rather than a little late —
 * consistent with this package's job being pipeline budgeting, not billing.
 */
const CHARS_PER_TOKEN_APPROXIMATION = 4;

/** Small fixed overhead per message for role/formatting tokens a real chat-completion tokenizer adds. */
const PER_MESSAGE_OVERHEAD_TOKENS = 4;

function estimateMessageTokens(message: ChatMessage): number {
  const contentTokens = Math.ceil(message.content.length / CHARS_PER_TOKEN_APPROXIMATION);
  return contentTokens + PER_MESSAGE_OVERHEAD_TOKENS;
}

/** architecture §34.4, verbatim signature. */
export function estimateTokens(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}
