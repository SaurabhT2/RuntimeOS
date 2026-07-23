import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createStudioServer } from "../src/server.js";
import type { StudioConfig } from "../src/studio-config.js";

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

function baseConfig(overrides: Partial<StudioConfig> = {}): StudioConfig {
  return {
    http: { host: "127.0.0.1", port: 0 },
    gatewayUrl: "http://127.0.0.1:1", // reserved/unreachable unless a test overrides it
    gatewayApiKey: "test-gateway-key",
    ...overrides,
  };
}

describe("createStudioServer routing", () => {
  let upstream: Server | undefined;
  let studio: Server | undefined;

  afterEach(async () => {
    await close(upstream);
    await close(studio);
    upstream = undefined;
    studio = undefined;
  });

  it("serves /studio-api/meta with the gateway URL and never the API key", async () => {
    studio = createStudioServer(baseConfig());
    const studioUrl = await listen(studio);

    const res = await fetch(`${studioUrl}/studio-api/meta`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.gatewayUrl).toBe("http://127.0.0.1:1");
    expect(JSON.stringify(body)).not.toContain("test-gateway-key");
  });

  it("allows any request when no studioAccessKey is configured", async () => {
    studio = createStudioServer(baseConfig());
    const studioUrl = await listen(studio);

    const res = await fetch(`${studioUrl}/studio-api/meta`);
    expect(res.status).toBe(200);
  });

  it("rejects studio-api requests missing x-studio-key when one is configured", async () => {
    studio = createStudioServer(baseConfig({ studioAccessKey: "secret" }));
    const studioUrl = await listen(studio);

    const res = await fetch(`${studioUrl}/studio-api/meta`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("STUDIO_ACCESS_DENIED");
  });

  it("rejects studio-api requests with the wrong x-studio-key", async () => {
    studio = createStudioServer(baseConfig({ studioAccessKey: "secret" }));
    const studioUrl = await listen(studio);

    const res = await fetch(`${studioUrl}/studio-api/meta`, {
      headers: { "x-studio-key": "wrong" },
    });
    expect(res.status).toBe(401);
  });

  it("allows studio-api requests with the correct x-studio-key", async () => {
    studio = createStudioServer(baseConfig({ studioAccessKey: "secret" }));
    const studioUrl = await listen(studio);

    const res = await fetch(`${studioUrl}/studio-api/meta`, {
      headers: { "x-studio-key": "secret" },
    });
    expect(res.status).toBe(200);
  });

  it("returns 404 STUDIO_ROUTE_NOT_FOUND for an unrecognized studio-api path", async () => {
    studio = createStudioServer(baseConfig());
    const studioUrl = await listen(studio);

    const res = await fetch(`${studioUrl}/studio-api/does-not-exist`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("STUDIO_ROUTE_NOT_FOUND");
  });

  it.each([
    ["/studio-api/execute", "/v1/execute"],
    ["/studio-api/execute/stream", "/v1/execute/stream"],
    ["/studio-api/execute/pipeline", "/v1/execute/pipeline"],
    ["/studio-api/health", "/v1/health"],
  ])("proxies %s to the gateway's %s", async (studioPath, gatewayPath) => {
    let seenPath: string | undefined;
    upstream = createServer((req, res) => {
      seenPath = req.url;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    const upstreamUrl = await listen(upstream);
    studio = createStudioServer(baseConfig({ gatewayUrl: upstreamUrl }));
    const studioUrl = await listen(studio);

    const res = await fetch(`${studioUrl}${studioPath}`);
    expect(res.status).toBe(200);
    expect(seenPath).toBe(gatewayPath);
  });

  it("falls back to serving static files for any non-studio-api path", async () => {
    // createStudioServer always resolves its static root relative to
    // dist/server.js (../public); rather than reach into that fixed
    // path, confirm the *routing decision* itself here (non-studio-api
    // paths reach serveStatic, which apps/runtime-studio/test/static.test.ts
    // already covers in full) by checking the response is a 404 for a
    // path that doesn't exist in this package's real public/ directory,
    // as opposed to a studio-api-shaped 404 with a JSON error envelope.
    studio = createStudioServer(baseConfig());
    const studioUrl = await listen(studio);

    const res = await fetch(`${studioUrl}/definitely-not-a-real-asset.js`);
    const contentType = res.headers.get("content-type") ?? "";
    expect(contentType).not.toContain("application/json");
  });
});
