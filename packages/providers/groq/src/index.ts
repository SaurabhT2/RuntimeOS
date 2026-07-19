/**
 * @ai-gateway/groq
 *
 * Groq ProviderAdapter implementation.
 *
 * STATUS: implemented (Engineering Milestone EM-3, Blueprint §5, §7).
 *
 * Architecture reference: §12.3
 */

export { GroqAdapter, type GroqAdapterOptions, type GroqPricing } from "./groq-adapter.js";
export { TokenBucketRateLimiter, type TokenBucketOptions } from "./rate-limiter.js";
export { mapGroqHttpError } from "./http-errors.js";
export { parseSseDataLines } from "./sse-parser.js";
export {
  toGroqRequestBody,
  fromGroqResponse,
  fromGroqStreamEvent,
  mapFinishReason,
  type GroqChatCompletionRequest,
  type GroqChatCompletionResponse,
  type GroqChatCompletionChoice,
} from "./openai-compat.js";
