import { z } from "zod";
import { finishReasonSchema, type FinishReason } from "./response.js";

/**
 * A single chunk of a streamed execution (architecture §10.4, §12.1
 * streaming variant). Transport-agnostic: the `streaming` package (Wave 3)
 * is responsible for framing this as SSE or WebSocket messages — this type
 * only defines the payload shape every transport carries.
 */
export interface StreamChunk {
  requestId: string;
  delta: {
    text?: string;
    toolCallDelta?: unknown;
  };
  done: boolean;
  finishReason?: FinishReason;
}

export const streamChunkSchema: z.ZodType<StreamChunk> = z.object({
  requestId: z.string().min(1),
  delta: z.object({
    text: z.string().optional(),
    toolCallDelta: z.unknown().optional(),
  }),
  done: z.boolean(),
  finishReason: finishReasonSchema.optional(),
});
