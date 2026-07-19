import type {
  ChatMessage,
  ExecuteResponse,
  JSONSchema,
  ToolCall,
} from "@ai-gateway/core-contracts";
import type {
  NormalizedChunk,
  NormalizedInvocation,
  NormalizedResult,
  ToolDefinition,
} from "@ai-gateway/provider-sdk";

export interface GroqTool {
  type: "function";
  function: { name: string; description?: string; parameters: JSONSchema };
}

export interface GroqToolCall {
  id: string;
  function: { name: string; arguments: string };
}

/**
 * Groq's `/openai/v1/chat/completions` request body — OpenAI-compatible
 * (architecture §12.3). Only the fields this adapter actually sends are
 * modeled; Groq accepts (and this adapter does not use) many more.
 */
export interface GroqChatCompletionRequest {
  model: string;
  messages: Array<{ role: ChatMessage["role"]; content: string; name?: string }>;
  temperature: number;
  max_tokens: number;
  stream: boolean;
  stream_options?: { include_usage: true };
  response_format?: { type: "json_object" };
  tools?: GroqTool[];
}

export interface GroqChatCompletionChoice {
  index: number;
  message?: {
    role: string;
    content: string | null;
    tool_calls?: GroqToolCall[];
  };
  delta?: {
    content?: string | null;
    tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
  };
  finish_reason: string | null;
}

export interface GroqChatCompletionResponse {
  id: string;
  choices: GroqChatCompletionChoice[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

/** Builds the request body sent to Groq's chat-completions endpoint from a `NormalizedInvocation`. */
export function toGroqRequestBody(
  req: NormalizedInvocation,
  includeUsageInStream: boolean,
): GroqChatCompletionRequest {
  const body: GroqChatCompletionRequest = {
    model: req.modelId,
    messages: req.messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.name ? { name: m.name } : {}),
    })),
    temperature: req.temperature,
    max_tokens: req.maxOutputTokens,
    stream: req.stream,
  };

  if (req.stream && includeUsageInStream) {
    body.stream_options = { include_usage: true };
  }
  if (req.responseFormat?.type === "json") {
    body.response_format = { type: "json_object" };
  }
  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools.map(toGroqTool);
  }

  return body;
}

function toGroqTool(tool: ToolDefinition): GroqTool {
  return {
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  };
}

/** architecture §19.1's finish reasons, from Groq's OpenAI-compatible `finish_reason` string. */
export function mapFinishReason(
  reason: string | null | undefined,
): ExecuteResponse["finishReason"] {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "content_filter":
      return "content_filter";
    case "tool_calls":
      return "tool_call";
    default:
      // Groq has not (yet) returned this finish_reason in this adapter's
      // testing — default to "stop" rather than throwing, since an
      // unrecognized-but-present finish_reason still means the model did
      // produce a completion.
      return "stop";
  }
}

function toToolCalls(toolCalls: GroqToolCall[] | undefined): ToolCall[] | undefined {
  if (!toolCalls || toolCalls.length === 0) return undefined;
  return toolCalls.map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: tc.function.arguments,
  }));
}

/** Translates a full (non-streaming) Groq response into a `NormalizedResult`. */
export function fromGroqResponse(response: GroqChatCompletionResponse): NormalizedResult {
  const choice = response.choices[0];
  return {
    text: choice?.message?.content ?? undefined,
    toolCalls: toToolCalls(choice?.message?.tool_calls),
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    },
    finishReason: mapFinishReason(choice?.finish_reason),
    raw: response,
  };
}

/** Translates one parsed SSE `data:` payload from Groq's stream into a `NormalizedChunk`, or `undefined` for a chunk carrying no actionable delta. */
export function fromGroqStreamEvent(
  event: GroqChatCompletionResponse,
): NormalizedChunk | undefined {
  const choice = event.choices[0];
  const finishReason = choice?.finish_reason;

  if (finishReason) {
    return {
      delta: {},
      done: true,
      finishReason: mapFinishReason(finishReason),
      usage: event.usage
        ? { inputTokens: event.usage.prompt_tokens, outputTokens: event.usage.completion_tokens }
        : undefined,
    };
  }

  const text = choice?.delta?.content;
  if (text === undefined || text === null) {
    return undefined;
  }
  return { delta: { text }, done: false };
}
