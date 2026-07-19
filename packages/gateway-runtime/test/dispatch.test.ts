import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { Router, type RouteHandler } from "../src/router.js";
import { dispatchGatewayRequest } from "../src/dispatch.js";

let server: Server | undefined;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  }
});

async function startWithHandler(handler: RouteHandler): Promise<string> {
  const router = new Router();
  router.register("GET", "/boom", handler);
  server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    dispatchGatewayRequest(router, req, res, path).catch(() => {});
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", () => resolve()));
  const address = server?.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

/**
 * Every real route handler (`handleExecute`/`handleExecuteStream`/
 * `handleHealth`) already catches its own errors internally — this
 * backstop only exists for the case where one somehow doesn't. These
 * tests exercise that backstop directly, since no *real* handler can be
 * made to throw past its own try/catch to reach it.
 */
describe("dispatchGatewayRequest error backstop", () => {
  it("sends a clean error response when a handler throws before writing any headers", async () => {
    const baseUrl = await startWithHandler(() => {
      throw new Error("handler exploded before writing anything");
    });
    const res = await fetch(`${baseUrl}/boom`);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });

  it("just ends the response when a handler throws after headers were already sent", async () => {
    const baseUrl = await startWithHandler((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("partial");
      throw new Error("handler exploded after headers were sent");
    });
    const res = await fetch(`${baseUrl}/boom`);
    // Headers already committed to 200 before the throw — the backstop
    // cannot change the status code at that point, it can only end the
    // response cleanly rather than leaving the connection hanging.
    expect(res.status).toBe(200);
  });
});
