import type { ExecuteRequest, TaskType } from "@ai-gateway/core-contracts";
import type { CapabilityRequirement } from "./types.js";

/**
 * architecture §13.2 step 1: "maps the `TaskType` (and any schema/latency
 * constraints) to a required-capability set, e.g. `json_generation` +
 * `requiredSchema` -> `{supportsJsonMode: true}`."
 *
 * Static, deterministic, and total: every `TaskType` — known or a
 * deployment-registered custom one (`core-contracts`' `isKnownTaskType`
 * explicitly allows unrecognized strings) — gets a requirement back. Unknown
 * task types fall through to `DEFAULT_AFFINITY`, matching `core-contracts`'
 * own guidance not to treat an unmatched `TaskType` as an error.
 */
const CREATIVE_TASKS: ReadonlySet<TaskType> = new Set(["creative_writing", "marketing_content"]);
const REASONING_TASKS: ReadonlySet<TaskType> = new Set(["complex_reasoning", "code_generation"]);
const EXTRACTION_TASKS: ReadonlySet<TaskType> = new Set([
  "knowledge_extraction",
  "entity_extraction",
  "classification",
  "summarization",
]);

const DEFAULT_AFFINITY = { creativityAffinity: 0.3, reasoningAffinity: 0.3 };

function affinityForTask(task: TaskType): {
  creativityAffinity: number;
  reasoningAffinity: number;
} {
  if (CREATIVE_TASKS.has(task)) {
    return { creativityAffinity: 0.9, reasoningAffinity: 0.2 };
  }
  if (REASONING_TASKS.has(task)) {
    return { creativityAffinity: 0.2, reasoningAffinity: 0.9 };
  }
  if (EXTRACTION_TASKS.has(task)) {
    return { creativityAffinity: 0.1, reasoningAffinity: 0.3 };
  }
  if (task === "json_generation") {
    return { creativityAffinity: 0.1, reasoningAffinity: 0.4 };
  }
  return DEFAULT_AFFINITY;
}

/**
 * Classifies an `ExecuteRequest` into the capability set the Candidate
 * Query (`candidate-query.ts`) filters the Model Registry by, and the
 * affinity signals the `ModelScorer`'s quality term consults.
 */
export function classifyTask(req: ExecuteRequest): CapabilityRequirement {
  const { creativityAffinity, reasoningAffinity } = affinityForTask(req.task);

  return {
    requiresJsonMode: Boolean(req.constraints?.requiredSchema) || req.task === "json_generation",
    // core-contracts has no per-request tool-declaration field yet (tools
    // are declared adapter/provider-side, architecture §12.1's
    // `NormalizedInvocation.tools`) — no v1.0 request signal maps to this
    // today, so it is always `false` until a future milestone adds one.
    requiresToolCalling: false,
    requiresStreaming: req.constraints?.streaming ?? false,
    minContextTokens: req.constraints?.minContextTokens,
    maxCostUsd: req.constraints?.maxCostUsd,
    creativityAffinity,
    reasoningAffinity,
  };
}
