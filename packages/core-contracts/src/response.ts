import { z } from "zod";

/**
 * A single tool/function invocation requested by the model. Referenced by
 * architecture §10.4 (`ExecuteResponse.output.toolCalls`) without a spelled
 * out shape; defined here following the conventional tool-call envelope
 * (id + name + JSON-encoded arguments) so every provider adapter normalizes
 * to the same structure regardless of the originating provider's native
 * tool-call format (architecture §12.1's `NormalizedResult`).
 */
export interface ToolCall {
  id: string;
  name: string;
  /** JSON-encoded arguments, matching the tool's declared parameter schema. */
  arguments: string;
}

export const toolCallSchema: z.ZodType<ToolCall> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  arguments: z.string(),
});

export const FINISH_REASONS = [
  "stop",
  "length",
  "content_filter",
  "tool_call",
  "cancelled",
] as const;

export type FinishReason = (typeof FINISH_REASONS)[number];

export const finishReasonSchema = z.enum(FINISH_REASONS);

/**
 * architecture §10.4. Every response includes enough metadata (provider,
 * model class, tokens, cost, latency) for the caller to build its own
 * dashboards without having chosen any of it (architecture §10.1).
 */
export interface ExecuteResponse {
  requestId: string;
  output: {
    text?: string;
    /** Present when structured output was requested. */
    json?: unknown;
    toolCalls?: ToolCall[];
  };
  usage: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  };
  execution: {
    /** e.g. "groq" — informational, opaque identifier. */
    providerId: string;
    /** e.g. "fast-extraction" — capability class, not raw model string. */
    modelClass: string;
    latencyMs: number;
    retries: number;
    failedOver: boolean;
  };
  finishReason: FinishReason;
}

export const executeResponseSchema: z.ZodType<ExecuteResponse> = z.object({
  requestId: z.string().min(1),
  output: z.object({
    text: z.string().optional(),
    json: z.unknown().optional(),
    toolCalls: z.array(toolCallSchema).optional(),
  }),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    estimatedCostUsd: z.number().nonnegative(),
  }),
  execution: z.object({
    providerId: z.string().min(1),
    modelClass: z.string().min(1),
    latencyMs: z.number().nonnegative(),
    retries: z.number().int().nonnegative(),
    failedOver: z.boolean(),
  }),
  finishReason: finishReasonSchema,
});
