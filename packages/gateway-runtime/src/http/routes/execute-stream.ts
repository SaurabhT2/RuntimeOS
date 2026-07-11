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
 * Architecture §17's streaming lifecycle: `AuthMiddleware.authenticate`
 * and `RateLimitMiddleware.checkOrThrow` are called directly (bypassing
 * `MiddlewarePipeline.run`, which is shaped around one full response, not
 * a stream), then straight to `ExecutionOrchestrator.executeStream`.
 *
 * Cancellation is detected via both `req`'s `close` **and** `error`
 * events. `close` is the classic Node `http.Server` disconnect signal;
 * `error` (checked for `message === "aborted"`) is what Vercel's
 * documentation names as the disconnect signal for classic Node.js
 * `(request, response)` handlers on that platform (made prompt by that
 * hosting layer's own function configuration — see `apps/vercel-adapter`'s
 * `vercel.json`). Listening for both here, in the one shared
 * implementation, means every hosting layer gets correct cancellation
 * behavior for free rather than needing to special-case it — this handler
 * has no idea which platform is calling it, by design.
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
    // the `close`/`error` handlers below.
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
    // before the first chunk arrives.
    res.flushHeaders?.();

    const activeRequestId = requestId;
    let cancelled = false;
    const onClose = () => {
      if (cancelled) return;
      cancelled = true;
      app.orchestrator.cancel(activeRequestId);
    };
    const onError = (error: Error) => {
      if (error.message === "aborted") {
        onClose();
      }
    };
    req.on("close", onClose);
    req.on("error", onError);

    try {
      for await (const chunk of app.orchestrator.executeStream(request)) {
        res.write(encodeSseChunk(chunk));
        if (chunk.done) {
          break;
        }
      }
    } finally {
      req.removeListener("close", onClose);
      req.removeListener("error", onError);
    }
    res.end();
  } catch (error) {
    if (res.headersSent) {
      // The SSE stream had already opened (headers sent) before this
      // failure — an HTTP status code can no longer change at this point,
      // so the error is framed as one final SSE chunk instead of a
      // top-level JSON error body.
      const { body } = toErrorResponseBody(error);
      res.write(`data: ${JSON.stringify(body)}\n\n`);
      res.end();
      return;
    }
    sendError(res, error);
  }
}
