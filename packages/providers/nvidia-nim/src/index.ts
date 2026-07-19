/**
 * @ai-gateway/nvidia-nim
 *
 * NVIDIA NIM ProviderAdapter implementation.
 *
 * STATUS: implemented (Engineering Milestone EM-3, Blueprint §5, §7).
 *
 * Architecture reference: §12.3
 */

export { NimAdapter, type NimAdapterOptions, type NimPricing } from "./nim-adapter.js";
export { mapNimHttpError } from "./http-errors.js";
export { parseSseDataLines } from "./sse-parser.js";
export {
  toNimRequestBody,
  fromNimResponse,
  fromNimStreamEvent,
  mapFinishReason,
  type NimChatCompletionRequest,
  type NimChatCompletionResponse,
  type NimChatCompletionChoice,
} from "./openai-compat.js";
