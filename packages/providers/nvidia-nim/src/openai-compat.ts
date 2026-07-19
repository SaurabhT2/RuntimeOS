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

/**
 * NVIDIA's hosted NIM inference endpoints are OpenAI-compatible
 * (architecture §12.3: "build.nvidia.com-style hosted API"). This
 * translation layer mirrors `@ai-gateway/groq`'s own `openai-compat.ts`
 * — the two adapter packages have no allowed dependency edge onto each
 * other or onto a shared "adapter kit" (Section 4.1's `DEPENDENCY_TABLE`:
 * each of `providers/groq`/`providers/nvidia-nim` may depend only on
 * `provider-sdk` + `core-contracts`), so each defines its own copy rather
 * than introducing a disallowed edge — the same duplication rationale
 * `provider-sdk`'s own `CredentialScope` doc comment already documents
 * for this codebase.
 */
export interface NimTool {
  type: "function";
  function: { name: string; description?: string; parameters: JSONSchema };
}

export interface NimToolCall {
  id: string;
  function: { name: string; arguments: string };
}

export interface NimChatCompletionRequest {
  model: string;
  messages: Array<{ role: ChatMessage["role"]; content: string; name?: string }>;
  temperature: number;
  max_tokens: number;
  stream: boolean;
  stream_options?: { include_usage: true };
  response_format?: { type: "json_object" };
  tools?: NimTool[];
}

export interface NimChatCompletionChoice {
  index: number;
  message?: {
    role: string;
    content: string | null;
    tool_calls?: NimToolCall[];
  };
  delta?: {
    content?: string | null;
  };
  finish_reason: string | null;
}

export interface NimChatCompletionResponse {
  id: string;
  choices: NimChatCompletionChoice[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export function toNimRequestBody(
  req: NormalizedInvocation,
  includeUsageInStream: boolean,
): NimChatCompletionRequest {
  const body: NimChatCompletionRequest = {
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
    body.tools = req.tools.map(toNimTool);
  }

  return body;
}

function toNimTool(tool: ToolDefinition): NimTool {
  return {
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  };
}

/** architecture §19.1's finish reasons, from NIM's OpenAI-compatible `finish_reason` string. */
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
      return "stop";
  }
}

function toToolCalls(toolCalls: NimToolCall[] | undefined): ToolCall[] | undefined {
  if (!toolCalls || toolCalls.length === 0) return undefined;
  return toolCalls.map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: tc.function.arguments,
  }));
}

export function fromNimResponse(response: NimChatCompletionResponse): NormalizedResult {
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

export function fromNimStreamEvent(event: NimChatCompletionResponse): NormalizedChunk | undefined {
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
