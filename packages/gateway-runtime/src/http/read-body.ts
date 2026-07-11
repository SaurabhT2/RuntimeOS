import type { IncomingMessage } from "node:http";
import { GatewayError } from "@ai-gateway/core-contracts";

/**
 * Reads `req` as a raw stream via `data`/`end`/`error` events and
 * JSON-parses the result. Works unmodified under both hosting layers:
 * a real `http.Server`'s `IncomingMessage` never pre-consumes the body,
 * and a plain (non-Next.js) Vercel Node.js Function's `request.body`
 * helper is a lazily-computed getter — "only computed when it is
 * accessed" per Vercel's own documentation — so as long as nothing ever
 * touches `.body` before this function runs, the stream reaches it
 * unconsumed there too. No `bodyParser: false`-style opt-out is needed on
 * either platform.
 *
 * Throws `GatewayError("INVALID_SCHEMA", ...)` — never a raw `SyntaxError`
 * or an unbounded-memory read — for a malformed, oversized, or empty body.
 * Does not validate the parsed shape against `ExecuteRequest`;
 * `orchestrator`'s own `executeRequestSchema` check (already run on every
 * `execute`/`executeStream` call) is the single source of truth for that,
 * so this function's only job is "valid, size-bounded JSON or a clean
 * 400."
 */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    const fail = (error: GatewayError) => {
      if (settled) return;
      settled = true;
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
      reject(error);
    };

    const onData = (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        fail(
          new GatewayError(
            "INVALID_SCHEMA",
            `Request body exceeds the ${MAX_BODY_BYTES}-byte limit.`,
            false,
          ),
        );
        req.destroy();
        return;
      }
      chunks.push(chunk);
    };

    const onEnd = () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw.trim().length === 0) {
        reject(new GatewayError("INVALID_SCHEMA", "Request body must not be empty.", false));
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(
          new GatewayError(
            "INVALID_SCHEMA",
            `Request body is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
            false,
          ),
        );
      }
    };

    const onError = (error: Error) => {
      fail(
        new GatewayError("INVALID_SCHEMA", `Failed to read request body: ${error.message}`, false),
      );
    };

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}
