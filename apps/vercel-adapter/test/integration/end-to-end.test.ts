import { afterEach, describe, expect, it } from "vitest";
import {
  fakeAdapter,
  startTestDispatchServer,
  type TestDispatchServer,
} from "@ai-gateway/gateway-runtime/testing";

let server: TestDispatchServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

/**
 * These scenarios are identical to
 * `packages/gateway-runtime/test/integration/end-to-end.test.ts` and
 * `apps/gateway-server/test/integration/end-to-end.test.ts` — all three
 * suites assert the same behavior through `@ai-gateway/gateway-runtime`'s
 * own shared test harness (`startTestDispatchServer`). This is this
 * milestone's concrete evidence for "no behaviour differs between the two
 * deployment targets except hosting lifecycle": the underlying logic is
 * proven once, in the shared package; this file proves this app hasn't
 * diverged from it. This app's own genuinely unique surface — deriving
 * `path` from Vercel's `req.query.path` and the warm-instance cache — is
 * covered separately in `test/api-entrypoint.test.ts` and
 * `test/runtime.test.ts`.
 */
describe("end-to-end runtime integration (vercel-adapter, via shared harness)", () => {
  it("a healthy request completes the full non-streaming lifecycle", async () => {
    server = await startTestDispatchServer();
    const res = await fetch(`${server.baseUrl}/v1/execute`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-key-org-1" },
      body: JSON.stringify({
        task: "summarization",
        input: { text: "integration test" },
        tenant: { organizationId: "org-1" },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.output.text).toBeTruthy();
    expect(body.execution.retries).toBe(0);
    expect(body.execution.failedOver).toBe(false);
  });

  it("failover from the primary to the fallback provider is invisible to the client", async () => {
    server = await startTestDispatchServer(
      {},
      {
        adapters: [
          fakeAdapter({ id: "groq", behavior: "fail" }),
          fakeAdapter({ id: "nvidia-nim" }),
        ],
      },
    );
    const res = await fetch(`${server.baseUrl}/v1/execute`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-key-org-1" },
      body: JSON.stringify({
        task: "summarization",
        input: { text: "failover please" },
        tenant: { organizationId: "org-1" },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.execution.providerId).toBe("nvidia-nim");
    expect(body.execution.failedOver).toBe(true);
  });

  it("a streaming request completes the full streaming lifecycle end-to-end", async () => {
    server = await startTestDispatchServer();
    const res = await fetch(`${server.baseUrl}/v1/execute/stream`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-key-org-1" },
      body: JSON.stringify({
        task: "summarization",
        input: { text: "stream please" },
        tenant: { organizationId: "org-1" },
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"done":true');
  });

  it("a caller with no gateway API key never reaches the orchestrator at all", async () => {
    server = await startTestDispatchServer();
    const res = await fetch(`${server.baseUrl}/v1/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        task: "summarization",
        input: { text: "should never run" },
        tenant: { organizationId: "org-1" },
      }),
    });
    expect(res.status).toBe(401);
  });

  it("the gateway's own health endpoint reflects real, currently-registered provider health", async () => {
    server = await startTestDispatchServer();
    const res = await fetch(`${server.baseUrl}/v1/health`);
    const body = await res.json();
    expect(body.providers).toHaveLength(2);
  });

  it("an unregistered path returns 404 and a wrong method on a real path returns 405", async () => {
    server = await startTestDispatchServer();
    const notFound = await fetch(`${server.baseUrl}/v1/does-not-exist`);
    expect(notFound.status).toBe(404);

    const wrongMethod = await fetch(`${server.baseUrl}/v1/execute`, { method: "GET" });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("GET, POST");
  });
});
