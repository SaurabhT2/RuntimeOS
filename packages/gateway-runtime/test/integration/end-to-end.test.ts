import { afterEach, describe, expect, it } from "vitest";
import { fakeAdapter } from "../../src/testing/fixtures.js";
import { startTestDispatchServer, type TestDispatchServer } from "../../src/testing/test-server.js";

let server: TestDispatchServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

/**
 * The canonical end-to-end suite for the shared RuntimeOS composition
 * layer. `apps/gateway-server/test/integration/end-to-end.test.ts` and
 * `apps/vercel-adapter/test/integration/end-to-end.test.ts` each assert
 * these same scenarios again, through their own real hosting-layer
 * entrypoint (a real `http.Server` / a real Vercel Function handler) —
 * this file is the one place the underlying behavior itself is proven;
 * the two app-level suites are proving correct *assembly*, not
 * re-deriving correctness from scratch.
 */
describe("end-to-end runtime integration (shared gateway-runtime)", () => {
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

  describe("EM-8 Pass-through Regression: enableStrategyLayer OFF vs ON, full HTTP stack", () => {
    const requestBody = {
      task: "summarization",
      input: { text: "integration test for the strategy layer regression" },
      tenant: { organizationId: "org-1" },
    };

    it("produces an identical execution result (provider, retries, failedOver, finishReason) whether the Strategy Layer is enabled or not", async () => {
      const offServer = await startTestDispatchServer({ enableStrategyLayer: false });
      const offRes = await fetch(`${offServer.baseUrl}/v1/execute`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer test-key-org-1" },
        body: JSON.stringify(requestBody),
      });
      const offBody = (await offRes.json()) as {
        execution: { providerId: string; retries: number; failedOver: boolean };
        finishReason: string;
      };
      await offServer.close();

      const onServer = await startTestDispatchServer({ enableStrategyLayer: true });
      const onRes = await fetch(`${onServer.baseUrl}/v1/execute`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer test-key-org-1" },
        body: JSON.stringify(requestBody),
      });
      const onBody = (await onRes.json()) as {
        execution: { providerId: string; retries: number; failedOver: boolean };
        finishReason: string;
      };
      await onServer.close();
      server = undefined;

      expect(onRes.status).toBe(offRes.status);
      expect(onBody.execution.providerId).toBe(offBody.execution.providerId);
      expect(onBody.execution.retries).toBe(offBody.execution.retries);
      expect(onBody.execution.failedOver).toBe(offBody.execution.failedOver);
      expect(onBody.finishReason).toBe(offBody.finishReason);
    });

    it("failover behavior is identical with the Strategy Layer enabled", async () => {
      server = await startTestDispatchServer(
        { enableStrategyLayer: true },
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
        body: JSON.stringify(requestBody),
      });
      const body = (await res.json()) as {
        execution: { providerId: string; failedOver: boolean };
      };
      expect(body.execution.providerId).toBe("nvidia-nim");
      expect(body.execution.failedOver).toBe(true);
    });
  });
});
