import type { IncomingMessage, ServerResponse } from "node:http";
import type { StudioConfig } from "./studio-config.js";

/**
 * Forwards one request to the target gateway (`config.gatewayUrl` +
 * `gatewayPath`), injecting `Authorization: Bearer <config.gatewayApiKey>`
 * server-side — the browser never sees this key. This is the *only*
 * place this app talks to a gateway; every Studio feature is built on
 * top of this one function forwarding to one of the four real routes
 * `packages/gateway-runtime/src/dispatch.ts` registers
 * (`/v1/execute`, `/v1/execute/stream`, `/v1/execute/pipeline`,
 * `/v1/health`) — nothing is invented, mocked, or answered locally.
 *
 * Handles both ordinary JSON responses and `text/event-stream` (SSE)
 * responses identically at the transport level: read the upstream body
 * incrementally and write each chunk to `res` as it arrives, rather than
 * buffering — required for streaming to actually stream, and harmless
 * for JSON (which is usually one chunk anyway).
 *
 * Client disconnects (the browser tab closing, or the Studio UI's own
 * "Cancel" button aborting its `fetch`) propagate to the upstream
 * request via `AbortController`, so a cancelled Studio request doesn't
 * leave an orphaned in-flight request against the real gateway.
 */
export async function proxyToGateway(
  req: IncomingMessage,
  res: ServerResponse,
  config: StudioConfig,
  gatewayPath: string,
): Promise<void> {
  const method = req.method ?? "GET";
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

  const controller = new AbortController();
  req.on("close", () => controller.abort());

  let upstream: Response;
  try {
    upstream = await fetch(`${config.gatewayUrl}${gatewayPath}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.gatewayApiKey}`,
      },
      body,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      // The client disconnected before we got a response — nothing left
      // to write to `res` (it's not writable if the client is gone
      // anyway).
      return;
    }
    res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: {
          name: "StudioProxyError",
          code: "GATEWAY_UNREACHABLE",
          message: `Could not reach the target gateway at ${config.gatewayUrl}${gatewayPath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          retryable: true,
        },
      }),
    );
    return;
  }

  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
  const headers: Record<string, string> = { "content-type": contentType };
  // SSE responses must not be buffered by any intermediary — mirror the
  // upstream's own no-buffering intent explicitly.
  if (contentType.includes("text/event-stream")) {
    headers["cache-control"] = "no-cache";
    headers["connection"] = "keep-alive";
    headers["x-accel-buffering"] = "no";
  }
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter) headers["retry-after"] = retryAfter;

  res.writeHead(upstream.status, headers);

  if (!upstream.body) {
    res.end();
    return;
  }

  const reader = upstream.body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) res.write(Buffer.from(value));
    }
  } catch {
    // Reader errors (upstream connection dropped mid-stream, or our own
    // client disconnected — same `close` listener above already aborted
    // the controller in that case) — nothing more to write.
  } finally {
    res.end();
  }
}
