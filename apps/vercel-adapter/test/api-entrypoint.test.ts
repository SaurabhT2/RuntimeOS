import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `packages/gateway-runtime`'s own integration suite (reused by both apps
 * via `startTestDispatchServer`) already proves the *shared* dispatch
 * logic end-to-end. What it cannot prove is that `api/v1/[...path].ts`
 * itself — this app's one genuinely unique file — correctly derives
 * `path` from Vercel's `req.query.path` capture and correctly wires
 * through `runtime.ts`'s warm-instance cache. This file drives the real,
 * exported `handler` directly (not `dispatchGatewayRequest` in isolation),
 * with a thin test-only shim that attaches `.query.path` the way Vercel's
 * platform would before invoking it — the one piece of Vercel-specific
 * behavior nothing else in this test suite exercises.
 */
const VALID_ENV = {
  GATEWAY_API_KEYS_JSON: JSON.stringify([
    { apiKey: "k1", tenant: { organizationId: "org-1" }, role: "member" },
  ]),
  TEST_GROQ_PLATFORM_API_KEY: "test-key",
  TEST_NIM_PLATFORM_API_KEY: "test-key",
  GROQ_PLATFORM_API_KEY_ENV_VAR: "TEST_GROQ_PLATFORM_API_KEY",
  NVIDIA_NIM_PLATFORM_API_KEY_ENV_VAR: "TEST_NIM_PLATFORM_API_KEY",
};

let originalEnv: NodeJS.ProcessEnv;
let server: Server | undefined;

// This file is the only one in either app's test suite that constructs
// the *real* GroqAdapter/NimAdapter (via the real, unmocked `bootstrap()`
// — deliberately, since there is no test seam reachable from the real
// Vercel entrypoint to substitute fakes through). That's real
// construction work every other test in this repo skips via
// `fakeAdapter`, and it can occasionally run slower than vitest's default
// 5s timeout under heavy parallel load (e.g. `turbo run test` across many
// packages at once) even though each request itself never makes network
// I/O (see the network-free design note below). A longer, explicit
// timeout reflects that real cost rather than papering over it.
const REAL_BOOTSTRAP_TEST_TIMEOUT_MS = 20_000;

beforeEach(() => {
  originalEnv = { ...process.env };
  vi.resetModules();
});

afterEach(async () => {
  process.env = originalEnv;
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  }
});

/** Wraps the real, dynamically-imported api handler in a test-only ephemeral server that simulates Vercel's `req.query.path` capture from the real incoming URL. */
async function startRealHandlerServer(): Promise<string> {
  const mod = await import("../api/v1/[...path].js");
  const handler = mod.default;

  server = createServer((req, res) => {
    const rawPath = (req.url ?? "/").split("?")[0] ?? "/";
    const segments = rawPath
      .replace(/^\/v1\//, "")
      .split("/")
      .filter(Boolean);
    (req as typeof req & { query: { path: string[] } }).query = { path: segments };
    handler(req, res).catch((error: unknown) => {
      if (!res.headersSent) res.writeHead(500);
      res.end(String(error));
    });
  });

  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", () => resolve()));
  const address = server?.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

describe("the real Vercel entrypoint (api/v1/[...path].ts)", () => {
  it(
    "derives the path from a simulated Vercel query.path capture and reaches the correct handler",
    async () => {
      process.env = { ...process.env, ...VALID_ENV };
      const baseUrl = await startRealHandlerServer();

      // This exercises the *real* bootstrap() with the real GroqAdapter/
      // NimAdapter (no test-seam override reachable from the real Vercel
      // entrypoint — correctly; a real deployment shouldn't have one). To
      // stay network-free (this codebase's tests never make a live network
      // call — see `fakeAdapter`'s own doc comment), this sends an
      // unauthenticated `POST /v1/execute`: `AuthMiddleware.authenticate`
      // rejects it synchronously, before `pipeline.run` ever reaches the
      // orchestrator or any provider adapter. A 401 (not a 404) proves
      // `resolvePath` correctly derived `/v1/execute` from the simulated
      // `query.path` capture and dispatched to `handleExecute`.
      const res = await fetch(`${baseUrl}/v1/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task: "summarization",
          input: { text: "routing check only" },
          tenant: { organizationId: "org-1" },
        }),
      });
      expect(res.status).toBe(401);
    },
    REAL_BOOTSTRAP_TEST_TIMEOUT_MS,
  );

  it(
    "reuses the same warm instance across two requests (no rebootstrap per request)",
    async () => {
      process.env = { ...process.env, ...VALID_ENV };
      const baseUrl = await startRealHandlerServer();

      const request = () =>
        fetch(`${baseUrl}/v1/execute`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            task: "summarization",
            input: { text: "routing check only" },
            tenant: { organizationId: "org-1" },
          }),
        });

      const first = await request();
      const second = await request();
      expect(first.status).toBe(401);
      expect(second.status).toBe(401);
    },
    REAL_BOOTSTRAP_TEST_TIMEOUT_MS,
  );

  it(
    "returns 404 for a path with no matching route",
    async () => {
      process.env = { ...process.env, ...VALID_ENV };
      const baseUrl = await startRealHandlerServer();

      const res = await fetch(`${baseUrl}/v1/does-not-exist`);
      expect(res.status).toBe(404);
    },
    REAL_BOOTSTRAP_TEST_TIMEOUT_MS,
  );

  it(
    "surfaces a bootstrap configuration failure as a clean error response, not an unhandled rejection",
    async () => {
      process.env = { ...process.env, GATEWAY_API_KEYS_JSON: "" };
      const baseUrl = await startRealHandlerServer();

      const res = await fetch(`${baseUrl}/v1/health`);
      expect(res.status).toBe(500);
    },
    REAL_BOOTSTRAP_TEST_TIMEOUT_MS,
  );
});
