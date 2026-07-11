import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { GatewayApp } from "../../../src/bootstrap.js";
import { handleExecuteStream } from "../../../src/http/routes/execute-stream.js";

function fakeStreamReq(body: unknown): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage & EventEmitter;
  (req as unknown as { headers: Record<string, string> }).headers = {
    authorization: "Bearer test-key",
  };
  queueMicrotask(() => {
    req.emit("data", Buffer.from(JSON.stringify(body)));
    req.emit("end");
  });
  return req;
}

function fakeRes(): ServerResponse {
  return {
    writeHead: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    headersSent: false,
    writableEnded: false,
  } as unknown as ServerResponse;
}

/**
 * `req`'s `error` event (`message === "aborted"`) is Vercel's documented
 * disconnect signal for classic Node.js handlers on that platform — see
 * this route's own doc comment. A real HTTP client (`fetch`/
 * `AbortController`) naturally triggers `close` on disconnect, not a
 * synthetic `error` with that exact message, so this path can only be
 * exercised directly, against a minimal fake `req`/`res`/`GatewayApp`,
 * not through a real HTTP round trip.
 */
describe("handleExecuteStream error-event cancellation", () => {
  it("cancels the orchestrator when req emits an 'aborted' error mid-stream", async () => {
    const cancel = vi.fn();
    let releaseSecondChunk: () => void = () => {};
    const secondChunkGate = new Promise<void>((resolve) => {
      releaseSecondChunk = resolve;
    });

    const app = {
      auth: { authenticate: () => ({ tenant: { organizationId: "org-1" } }) },
      rateLimit: { checkOrThrow: () => {} },
      orchestrator: {
        cancel,
        executeStream: async function* () {
          yield { delta: { text: "partial" }, done: false };
          await secondChunkGate;
          yield {
            delta: {},
            done: true,
            finishReason: "stop",
            usage: { inputTokens: 1, outputTokens: 1 },
          };
        },
      },
    } as unknown as GatewayApp;

    const req = fakeStreamReq({
      task: "summarization",
      input: { text: "hi" },
      tenant: { organizationId: "org-1" },
    });
    const res = fakeRes();

    const handlerPromise = handleExecuteStream(req, res, app);

    // Wait for the first chunk to be written, then simulate Vercel's
    // disconnect signal.
    await vi.waitFor(() => expect(res.write).toHaveBeenCalledTimes(1));
    (req as unknown as EventEmitter).emit("error", new Error("aborted"));
    expect(cancel).toHaveBeenCalledTimes(1);

    releaseSecondChunk();
    await handlerPromise;
  });

  it("ignores an error event whose message is not 'aborted'", async () => {
    const cancel = vi.fn();
    const app = {
      auth: { authenticate: () => ({ tenant: { organizationId: "org-1" } }) },
      rateLimit: { checkOrThrow: () => {} },
      orchestrator: {
        cancel,
        executeStream: async function* () {
          yield {
            delta: { text: "hi" },
            done: true,
            finishReason: "stop",
            usage: { inputTokens: 1, outputTokens: 1 },
          };
        },
      },
    } as unknown as GatewayApp;

    const req = fakeStreamReq({
      task: "summarization",
      input: { text: "hi" },
      tenant: { organizationId: "org-1" },
    });
    const res = fakeRes();

    const handlerPromise = handleExecuteStream(req, res, app);
    await vi.waitFor(() => expect(res.writeHead).toHaveBeenCalled());
    (req as unknown as EventEmitter).emit("error", new Error("some other socket error"));
    await handlerPromise;

    expect(cancel).not.toHaveBeenCalled();
  });
});
