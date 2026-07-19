import { z } from "zod";

/**
 * The well-known task types the gateway ships routing support for out of the
 * box (architecture §10.3, §13.2's Task Classifier). This set is extensible:
 * `TaskType` also accepts any other string, because deployments may register
 * custom task types via {@link GatewayConfig} (architecture §10.6) without
 * requiring a `core-contracts` release.
 *
 * IMPORTANT: this list is informational/exhaustive-for-docs only. Do not
 * write code that exhaustively switches on `KNOWN_TASK_TYPES` and treats an
 * unmatched value as an error — unknown task types are a supported, expected
 * case (see {@link isKnownTaskType}).
 */
export const KNOWN_TASK_TYPES = [
  "knowledge_extraction",
  "entity_extraction",
  "classification",
  "summarization",
  "json_generation",
  "creative_writing",
  "complex_reasoning",
  "marketing_content",
  "code_generation",
] as const;

export type KnownTaskType = (typeof KNOWN_TASK_TYPES)[number];

/**
 * What the caller wants done. NEVER a model name (architecture §10.1 design
 * goal: "No field ever accepts a provider name or model name from the
 * caller."). Extensible beyond {@link KNOWN_TASK_TYPES} via config-registered
 * custom task types.
 */
export type TaskType = KnownTaskType | (string & {});

/**
 * Returns true if `value` is one of the task types shipped by default.
 * A `false` result does NOT mean the task type is invalid — it may be a
 * valid custom task type registered via {@link GatewayConfig}. Callers that
 * need to validate against a specific deployment's registered task types
 * should consult the Model/Task Registry at runtime, not this function.
 */
export function isKnownTaskType(value: string): value is KnownTaskType {
  return (KNOWN_TASK_TYPES as readonly string[]).includes(value);
}

/**
 * Runtime schema for {@link TaskType}. Deliberately permissive (any
 * non-empty string) to match the extensibility guarantee above — this schema
 * exists to catch structurally invalid requests (empty string, wrong type),
 * not to enforce the known-task-type allowlist.
 */
export const taskTypeSchema = z.string().min(1, "task must be a non-empty string");
