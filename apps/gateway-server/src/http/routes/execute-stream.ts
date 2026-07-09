import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ExecuteRequest } from "@ai-gateway/core-contracts";
import { encodeSseChunk } from "@ai-gateway/streaming";
import type { GatewayApp } from "../../bootstrap.js";
import { readJsonBody } from "../read-body.js";
import { sendError, toErrorResponseBody } from "../respond.js";
import { extractApiKey } from "../auth-header.js";
import { validateExecuteRequest } from "../validate-request.js";

/**
 * architecture §17's streaming lifecycle. `MiddlewarePipeline.run` is
 * shaped around a `downstream: (req, auth) => Promise<ExecuteResponse>`
 * (one full response, never a stream) and its own cache-check step never
 * applies to a streaming request in the first place (`CacheMiddleware`'s
 * own documented behavior — see `middleware`'s README) — so this handler
 * calls `AuthMiddleware.authenticate` and `RateLimitMiddleware.checkOrThrow`
 * directly rather than through `pipeline.run`, then goes straight to
 * `ExecutionOrchestrator.executeStream`. This mirrors architecture §17's
 * `A -> B -> C` nodes exactly (skipping `D`, which the diagram itself only
 * applies to the non-streaming path) — not new business logic, just this
 * composition root wiring the same two middleware stages a second way for
 * the one lifecycle shape `MiddlewarePipeline` doesn't cover end-to-end.
 */
export async function handleExecuteStream(
  req: IncomingMessage,
  res: ServerResponse,
  app: GatewayApp,
): Promise<void> {
  let requestId: string | undefined;
  try {
    const rawBody = await readJsonBody(req);
    const body = validateExecuteRequest(rawBody);
    const apiKey = extractApiKey(req);

    // B, C: throws on failure, caught below exactly like the non-streaming route.
    const auth = app.auth.authenticate(apiKey);
    app.rateLimit.checkOrThrow(auth.tenant);

    // Fixed up-front so this handler (not the orchestrator) always knows
    // the requestId a mid-stream client disconnect should cancel — see
    // the `close` handler below. `executeStream` itself would otherwise
    // generate one internally when absent (`req.requestId ?? generateRequestId()`),
    // which this handler would have no way to learn ahead of time.
    requestId = body.requestId ?? randomUUID();
    const request: ExecuteRequest = {
      ...body,
      requestId,
      constraints: { ...body.constraints, streaming: true },
    };

    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    // Flush headers immediately so a client sees the stream open even
    // before the first chunk arrives — some Node versions buffer the
    // first `write` otherwise.
    res.flushHeaders?.();

    const activeRequestId = requestId;
    const onClose = () => {
      app.orchestrator.cancel(activeRequestId);
    };
    req.on("close", onClose);

    try {
      for await (const chunk of app.orchestrator.executeStream(request)) {
        res.write(encodeSseChunk(chunk));
        if (chunk.done) {
          break;
        }
      }
    } finally {
      req.removeListener("close", onClose);
    }
    res.end();
  } catch (error) {
    if (res.headersSent) {
      // The SSE stream had already opened (headers sent) before this
      // failure — an HTTP status code can no longer change at this point,
      // so the error is framed as one final SSE chunk instead of a
      // top-level JSON error body, matching how any other mid-stream
      // provider failure already surfaces (`orchestrator`'s own
      // post-first-chunk-terminal behavior, EM-4 README).
      const { body } = toErrorResponseBody(error);
      res.write(`data: ${JSON.stringify(body)}\n\n`);
      res.end();
      return;
    }
    sendError(res, error);
  }
}
