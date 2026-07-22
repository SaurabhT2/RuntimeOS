import { createServer, type Server } from "node:http";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { proxyToGateway } from "../src/proxy.js";
import type { StudioConfig } from "../src/studio-config.js";

function baseConfig(gatewayUrl: string): StudioConfig {
  return {
    http: { host: "127.0.0.1", port: 0 },
    gatewayUrl,
    gatewayApiKey: "test-gateway-key",
  };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a bound AddressInfo");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server | undefined): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe("proxyToGateway", () => {
  let upstream: Server | undefined;
  let studio: Server | undefined;

  afterEach(async () => {
    await close(upstream);
    await close(studio);
    upstream = undefined;
    studio = undefined;
  });

  it("forwards method and body, and injects the gateway API key server-side", async () => {
    let seenAuth: string | undefined;
    let seenMethod: string | undefined;
    let seenBody = "";
    upstream = createServer((req, res) => {
      seenAuth = req.headers.authorization;
      seenMethod = req.method;
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => {
        seenBody = data;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    const upstreamUrl = await listen(upstream);
    const config = baseConfig(upstreamUrl);
    studio = createServer((req, res) => {
      void proxyToGateway(req, res, config, "/v1/execute");
    });
    const studioUrl = await listen(studio);

    const res = await fetch(`${studioUrl}/studio-api/execute`, {
      method: "POST",
      body: JSON.stringify({ task: "x" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(seenMethod).toBe("POST");
    expect(seenAuth).toBe("Bearer test-gateway-key");
    expect(seenBody).toBe(JSON.stringify({ task: "x" }));
  });

  it("never sends the gateway API key back to the calling client", async () => {
    upstream = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    const upstreamUrl = await listen(upstream);
    studio = createServer((req, res) => {
      void proxyToGateway(req, res, baseConfig(upstreamUrl), "/v1/execute");
    });
    const studioUrl = await listen(studio);

    const res = await fetch(`${studioUrl}/studio-api/execute`, { method: "POST" });
    expect(res.headers.get("authorization")).toBeNull();
    expect(JSON.stringify(await res.json())).not.toContain("test-gateway-key");
  });

  it("mirrors the upstream status and content-type for an ordinary JSON response", async () => {
    upstream = createServer((_req, res) => {
      res.writeHead(201, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ created: true }));
    });
    const upstreamUrl = await listen(upstream);
    studio = createServer((req, res) => {
      void proxyToGateway(req, res, baseConfig(upstreamUrl), "/v1/execute");
    });
    const studioUrl = await listen(studio);

    const res = await fetch(`${studioUrl}/studio-api/execute`, { method: "POST" });
    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await res.json()).toEqual({ created: true });
  });

  it("adds no-buffering headers, forwards retry-after, and streams an SSE response chunk by chunk", async () => {
    upstream = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream", "retry-after": "5" });
      res.write("data: one\n\n");
      setTimeout(() => {
        res.write("data: two\n\n");
        res.end();
      }, 10);
    });
    const upstreamUrl = await listen(upstream);
    studio = createServer((req, res) => {
      void proxyToGateway(req, res, baseConfig(upstreamUrl), "/v1/execute/stream");
    });
    const studioUrl = await listen(studio);

    const res = await fetch(`${studioUrl}/studio-api/execute/stream`, { method: "POST" });
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("connection")).toBe("keep-alive");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    expect(res.headers.get("retry-after")).toBe("5");
    expect(await res.text()).toBe("data: one\n\ndata: two\n\n");
  });

  it("returns a 502 GATEWAY_UNREACHABLE error when the upstream gateway cannot be reached", async () => {
    // Port 1 is a reserved, never-listening port — nothing to close afterward.
    const config = baseConfig("http://127.0.0.1:1");
    studio = createServer((req, res) => {
      void proxyToGateway(req, res, config, "/v1/execute");
    });
    const studioUrl = await listen(studio);

    const res = await fetch(`${studioUrl}/studio-api/execute`, { method: "POST" });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("GATEWAY_UNREACHABLE");
    expect(body.error.retryable).toBe(true);
  });

  it("ends the response with no body when the upstream response has none", async () => {
    upstream = createServer((_req, res) => {
      res.writeHead(204);
      res.end();
    });
    const upstreamUrl = await listen(upstream);
    studio = createServer((req, res) => {
      void proxyToGateway(req, res, baseConfig(upstreamUrl), "/v1/health");
    });
    const studioUrl = await listen(studio);

    const res = await fetch(`${studioUrl}/studio-api/health`);
    expect(res.status).toBe(204);
  });

  it("aborts the in-flight upstream call and writes nothing when the client disconnects first", async () => {
    let upstreamReceivedRequest = false;
    upstream = createServer((_req, res) => {
      upstreamReceivedRequest = true;
      // Never actually responds within the test's lifetime — the point
      // is to catch proxyToGateway with its own fetch to this server
      // still in flight when the simulated client disconnects.
      const timer = setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      }, 5000);
      res.on("close", () => clearTimeout(timer));
    });
    const upstreamUrl = await listen(upstream);

    // A minimal fake IncomingMessage: async-iterable (empty body) and an
    // EventEmitter so `req.on("close", ...)` behaves exactly as
    // proxyToGateway expects, but under this test's direct control
    // rather than depending on real socket-teardown timing between two
    // separate HTTP servers.
    const fakeReq = new EventEmitter() as EventEmitter & {
      method?: string;
      [Symbol.asyncIterator]: () => AsyncIterableIterator<Buffer>;
    };
    fakeReq.method = "POST";
    fakeReq[Symbol.asyncIterator] = async function* () {
      // empty body
    };

    let statusWritten: number | undefined;
    const fakeRes = {
      writeHead: (status: number) => {
        statusWritten = status;
      },
      write: () => undefined,
      end: () => undefined,
    };

    const proxyPromise = proxyToGateway(
      fakeReq as unknown as Parameters<typeof proxyToGateway>[0],
      fakeRes as unknown as Parameters<typeof proxyToGateway>[1],
      baseConfig(upstreamUrl),
      "/v1/execute",
    );
    // Give proxyToGateway time to start its own fetch to `upstream`
    // (and for `upstream` to confirm it actually received the request)
    // before simulating the client disconnecting.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(upstreamReceivedRequest).toBe(true);
    fakeReq.emit("close");
    await proxyPromise;

    // The documented behavior (src/proxy.ts): once the client has
    // disconnected, there is nothing left to write to `res` — no 502,
    // no anything.
    expect(statusWritten).toBeUndefined();
  });
});
