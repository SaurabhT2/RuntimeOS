import type { IncomingMessage, ServerResponse } from "node:http";
import {
  isGatewayError,
  type ExecuteResponse,
  type GatewayError,
} from "@ai-gateway/core-contracts";
import type { PipelineResult } from "@ai-gateway/pipeline-orchestrator";
import type { GatewayApp } from "../../bootstrap.js";
import { extractApiKey } from "../auth-header.js";
import { readJsonBody } from "../read-body.js";
import { sendError, sendJson } from "../respond.js";
import { validatePipelineRequest } from "../validate-pipeline-request.js";

/**
 * A `PipelineResult.stepResults` entry is `ExecuteResponse | GatewayError`
 * (`@ai-gateway/pipeline-orchestrator`'s own type) — `GatewayError`
 * instances need `.toJSON()` (architecture §19.1) before
 * `JSON.stringify`, the same serialization every other error response this
 * gateway ever sends already goes through (`respond.ts`'s own
 * `toErrorResponseBody`); a plain `ExecuteResponse` is already
 * JSON-serializable as-is.
 */
function serializePipelineResult(result: PipelineResult): unknown {
  const stepResults: Record<string, ExecuteResponse | ReturnType<GatewayError["toJSON"]>> = {};
  for (const [stepId, outcome] of Object.entries(result.stepResults)) {
    stepResults[stepId] = isGatewayError(outcome) ? outcome.toJSON() : outcome;
  }
  return { ...result, stepResults };
}

/**
 * architecture §41.3: `POST /v1/execute/pipeline`. A new endpoint, not a
 * change to `/v1/execute` — a caller who never sends a pipeline request
 * never encounters this handler. Applies the same auth + rate-limit steps
 * `handleExecute`'s `MiddlewarePipeline.run` does (architecture §17's `B`,
 * `C`) directly, rather than through that class, since
 * `MiddlewarePipeline.run` is typed to one `ExecuteRequest` in, one
 * `ExecuteResponse` out (its own cache step, `D`, specifically) — a shape
 * that doesn't fit a multi-step `ExecutionPipeline`/`PipelineResult`. No
 * cache step: caching a whole multi-step pipeline result under a
 * single-`ExecuteRequest`-shaped key isn't a fit either, and architecture
 * §41 doesn't ask for one.
 */
export async function handleExecutePipeline(
  req: IncomingMessage,
  res: ServerResponse,
  app: GatewayApp,
): Promise<void> {
  try {
    const rawBody = await readJsonBody(req);
    const pipeline = validatePipelineRequest(rawBody);
    const apiKey = extractApiKey(req);

    const auth = app.auth.authenticate(apiKey);
    app.rateLimit.checkOrThrow(auth.tenant);

    const result = await app.pipelineOrchestrator.executePipeline(pipeline);
    sendJson(res, 200, serializePipelineResult(result));
  } catch (error) {
    sendError(res, error);
  }
}
