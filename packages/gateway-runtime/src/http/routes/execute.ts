import type { IncomingMessage, ServerResponse } from "node:http";
import type { GatewayApp } from "../../bootstrap.js";
import { readJsonBody } from "../read-body.js";
import { sendError, sendJson } from "../respond.js";
import { extractApiKey } from "../auth-header.js";
import { validateExecuteRequest } from "../validate-request.js";

/**
 * Architecture §17's full non-streaming lifecycle, `A` through
 * `Z1`/`Z2`/`Z4`/`Z6`: parse the body, run it through
 * `MiddlewarePipeline.run` (auth -> rate limit -> cache-check), and — on a
 * cache miss — the bound `downstream` handler calls the real
 * `ExecutionOrchestrator.execute`. This handler's only job is HTTP framing
 * around that existing sequencing; every hosting layer (`apps/
 * gateway-server`, `apps/vercel-adapter`) calls this same function.
 */
export async function handleExecute(
  req: IncomingMessage,
  res: ServerResponse,
  app: GatewayApp,
): Promise<void> {
  try {
    const rawBody = await readJsonBody(req);
    const body = validateExecuteRequest(rawBody);
    const apiKey = extractApiKey(req);
    const response = await app.pipeline.run(body, apiKey, (r) => app.orchestrator.execute(r));
    sendJson(res, 200, response);
  } catch (error) {
    sendError(res, error);
  }
}
