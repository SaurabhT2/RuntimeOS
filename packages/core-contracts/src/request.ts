import { z } from "zod";
import { type JSONSchema, jsonSchemaSchema } from "./json-schema.js";
import { type TaskType, taskTypeSchema } from "./task.js";

export type ChatRole = "system" | "user" | "assistant" | "tool";

/** architecture §10.3 */
export interface ChatMessage {
  role: ChatRole;
  content: string;
  name?: string;
}

export const chatMessageSchema: z.ZodType<ChatMessage> = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
  name: z.string().optional(),
});

/**
 * What the caller wants done, the content it operates on, and everything the
 * gateway needs to route, execute, and attribute the request — without ever
 * letting the caller name a provider or model directly (architecture §10.1).
 *
 * This is one of the interfaces named in Blueprint §6.1 as "must be frozen
 * before implementation": changes after EM-0's acceptance require the same
 * ADR discipline as any architecture-level contract change (Blueprint §6.3;
 * architecture §28/§39/§46).
 *
 * architecture §10.3
 */
export interface ExecuteRequest {
  /** What the caller wants done. NEVER a model name. */
  task: TaskType;

  /** The content the task operates on. */
  input: {
    text?: string;
    messages?: ChatMessage[];
    context?: Record<string, unknown>;
  };

  /** Optional caller-side constraints. All optional; the gateway has sane defaults. */
  constraints?: {
    maxLatencyMs?: number;
    maxCostUsd?: number;
    /** Triggers structured-output routing (architecture §12.2). */
    requiredSchema?: JSONSchema;
    minContextTokens?: number;
    streaming?: boolean;
  };

  /** Optional soft preferences — hints, not guarantees. */
  preferences?: {
    creativity?: "low" | "medium" | "high";
    prioritize?: "cost" | "latency" | "quality";
    /**
     * v1.1, optional, advanced use only: override the auto-resolved
     * Execution Profile (architecture §31). Still a profile ID, never a raw
     * inference parameter — the "never configure model parameters directly"
     * guarantee (architecture §31.1) holds even for this override. Not
     * consumed by any v1.0 package; carried here so the wire contract does
     * not need to change when the Strategy Layer (Wave 8) lands.
     */
    executionProfileOverride?: string;
  };

  /** Multi-tenant scoping — used for credential resolution, rate limits, telemetry. */
  tenant: {
    organizationId: string;
    workspaceId?: string;
    projectId?: string;
    userId?: string;
  };

  /** Caller-supplied idempotency/correlation key. */
  requestId?: string;
  correlationId?: string;
}

export const executeRequestSchema: z.ZodType<ExecuteRequest> = z.object({
  task: taskTypeSchema,
  input: z.object({
    text: z.string().optional(),
    messages: z.array(chatMessageSchema).optional(),
    context: z.record(z.unknown()).optional(),
  }),
  constraints: z
    .object({
      maxLatencyMs: z.number().positive().optional(),
      maxCostUsd: z.number().nonnegative().optional(),
      requiredSchema: jsonSchemaSchema.optional(),
      minContextTokens: z.number().int().positive().optional(),
      streaming: z.boolean().optional(),
    })
    .optional(),
  preferences: z
    .object({
      creativity: z.enum(["low", "medium", "high"]).optional(),
      prioritize: z.enum(["cost", "latency", "quality"]).optional(),
      executionProfileOverride: z.string().optional(),
    })
    .optional(),
  tenant: z.object({
    organizationId: z.string().min(1),
    workspaceId: z.string().optional(),
    projectId: z.string().optional(),
    userId: z.string().optional(),
  }),
  requestId: z.string().optional(),
  correlationId: z.string().optional(),
});
