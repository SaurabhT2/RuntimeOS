import type {
  ChatMessage,
  JSONSchema,
  ExecuteResponse,
  ToolCall,
} from "@ai-gateway/core-contracts";

/**
 * A tool the model may call, in the same shape regardless of which
 * provider's native tool-calling format is underneath (mirrors {@link ToolCall}'s
 * role for tool call *results*: this is the tool call *declaration*).
 * Referenced by architecture §12.1's `NormalizedInvocation.tools` without a
 * spelled-out shape; defined here as the natural counterpart to `ToolCall`.
 */
export interface ToolDefinition {
  name: string;
  description?: string;
  /** JSON Schema the tool's arguments must conform to. */
  parameters: JSONSchema;
}

/**
 * architecture §12.1. Every provider adapter receives exactly this shape
 * regardless of what the underlying provider API looks like — translating
 * it to the provider's native request shape is the *only* place in the
 * codebase that knows that provider's request JSON.
 */
export interface NormalizedInvocation {
  /** Provider-specific model identifier, chosen by the Policy Engine (Wave 3) — never caller-supplied. */
  modelId: string;
  messages: ChatMessage[];
  temperature: number;
  maxOutputTokens: number;
  responseFormat?: { type: "json"; schema?: JSONSchema };
  tools?: ToolDefinition[];
  stream: boolean;
  timeoutMs: number;
}

/**
 * architecture §12.1. Every adapter's `invoke()` translates the provider's
 * native response into exactly this shape (or throws a `GatewayError` —
 * never a raw provider exception, architecture §19.2).
 */
export interface NormalizedResult {
  text?: string;
  json?: unknown;
  toolCalls?: ToolCall[];
  usage: { inputTokens: number; outputTokens: number };
  finishReason: ExecuteResponse["finishReason"];
  /** Adapter-internal debugging only — stripped before crossing back out of the adapter layer. */
  raw?: unknown;
}

/**
 * One chunk of a streamed `invokeStream()` call. Deliberately request-agnostic
 * (no `requestId`) — that correlation is added by the `streaming` package
 * (Wave 3) when framing this as a wire-level `StreamChunk`
 * (`@ai-gateway/core-contracts`). `usage` is only ever populated on the
 * final chunk (`done: true`), once the provider has reported total token
 * counts.
 */
export interface NormalizedChunk {
  delta: {
    text?: string;
    toolCallDelta?: unknown;
  };
  done: boolean;
  finishReason?: ExecuteResponse["finishReason"];
  usage?: { inputTokens: number; outputTokens: number };
}
