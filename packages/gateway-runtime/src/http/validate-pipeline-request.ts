import { GatewayError, taskTypeSchema, type ExecuteRequest } from "@ai-gateway/core-contracts";
import type { ExecutionPipeline, PipelineContext, PipelineStep } from "@ai-gateway/pipeline-orchestrator";
import { z } from "zod";

/**
 * architecture §41.3's own endpoint sketch (`POST /v1/execute/pipeline
 * { steps: [...] } -> PipelineResult`) is deliberately terse — it names the
 * endpoint and the top-level shape, not a full wire schema for
 * `PipelineStep.buildInput`, which is a *function* in the in-process
 * `ExecutionPipeline` type and therefore cannot be sent over HTTP JSON
 * as-is. This file is that missing translation, not an architecture
 * reinterpretation: each wire step supplies either a literal `input`
 * (architecture §10.3's own `ExecuteRequest.input` shape, for a pipeline's
 * first step or any step independent of prior ones) or `inputFrom`, a
 * prior step's `id` whose `ExecuteResponse.output` becomes this step's
 * `input.text` — `output.text` when present, else `JSON.stringify(output.json)`
 * as a documented, deliberately simple fallback. Selecting individual
 * fields, combining multiple prior steps, or other richer mappings are
 * natural future extensions, not attempted in this milestone.
 */
const pipelineStepWireSchema = z
  .object({
    id: z.string().min(1),
    task: taskTypeSchema,
    input: z
      .object({
        text: z.string().optional(),
        context: z.record(z.unknown()).optional(),
      })
      .optional(),
    inputFrom: z.string().optional(),
    required: z.boolean().optional(),
  })
  .refine((step) => step.input !== undefined || step.inputFrom !== undefined, {
    message: "each pipeline step must supply either `input` or `inputFrom`",
  });

const pipelineWireSchema = z.object({
  id: z.string().min(1),
  tenant: z.object({
    organizationId: z.string().min(1),
    workspaceId: z.string().optional(),
    projectId: z.string().optional(),
    userId: z.string().optional(),
  }),
  steps: z.array(pipelineStepWireSchema).min(1),
});

function buildInputFor(
  step: z.infer<typeof pipelineStepWireSchema>,
): (ctx: PipelineContext) => Omit<ExecuteRequest, "task" | "tenant"> {
  if (step.input) {
    const input = step.input;
    return () => ({ input });
  }
  const sourceStepId = step.inputFrom!; // schema's own .refine already guarantees exactly one of these is set
  return (ctx: PipelineContext) => {
    const sourceOutput = ctx.outputs[sourceStepId];
    if (!sourceOutput) {
      // Only reachable if `sourceStepId` names a step that failed (and was
      // non-required) or that hasn't run yet by pipeline-definition order —
      // both are request-shape problems the caller can fix, not a platform
      // failure.
      throw new GatewayError(
        "INVALID_TASK",
        `Step "${step.id}"'s inputFrom ("${sourceStepId}") has no successful output to read — it either failed, was skipped, or does not precede this step.`,
        false,
        { stepId: step.id, inputFrom: sourceStepId },
      );
    }
    return { input: { text: sourceOutput.output.text ?? JSON.stringify(sourceOutput.output.json) } };
  };
}

/**
 * Validates a raw HTTP body as this endpoint's wire schema and translates
 * it into a real, in-process `ExecutionPipeline` — every `inputFrom`
 * reference becomes a `buildInput` closure reading `ctx.outputs`, per this
 * file's own doc comment above.
 */
export function validatePipelineRequest(body: unknown): ExecutionPipeline {
  const parsed = pipelineWireSchema.safeParse(body);
  if (!parsed.success) {
    throw new GatewayError(
      "INVALID_SCHEMA",
      `Malformed pipeline request: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
      false,
      { issues: parsed.error.issues },
    );
  }

  const stepIds = new Set(parsed.data.steps.map((s) => s.id));
  if (stepIds.size !== parsed.data.steps.length) {
    throw new GatewayError("INVALID_SCHEMA", "Every pipeline step must have a unique id.", false);
  }
  for (const step of parsed.data.steps) {
    if (step.inputFrom && !stepIds.has(step.inputFrom)) {
      throw new GatewayError(
        "INVALID_SCHEMA",
        `Step "${step.id}"'s inputFrom ("${step.inputFrom}") does not name any step in this pipeline.`,
        false,
      );
    }
  }

  const steps: PipelineStep[] = parsed.data.steps.map((step) => ({
    id: step.id,
    task: step.task,
    buildInput: buildInputFor(step),
    required: step.required,
  }));

  return { id: parsed.data.id, tenant: parsed.data.tenant, steps };
}
