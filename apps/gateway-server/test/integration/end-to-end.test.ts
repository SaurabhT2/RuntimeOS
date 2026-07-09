import { afterEach, describe, expect, it } from "vitest";
import { fakeAdapter } from "../fixtures.js";
import { startTestServer, type TestServer } from "../test-server.js";

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

/**
 * Exercises this milestone's own named Runtime Integration flow —
 * Client -> Gateway API -> Middleware -> Orchestrator -> Policy Engine ->
 * Credential Resolution -> Provider Resolution -> Provider Execution ->
 * Retry/Failover -> Streaming (if applicable) -> Client Response — as one
 * real, end-to-end HTTP round trip per scenario, against a real
 * bootstrapped `GatewayApp` (not a mocked orchestrator/middleware).
 */
describe("end-to-end runtime integration", () => {
  it("a healthy request completes the full non-streaming lifecycle", async () => {
    server = await startTestServer();
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
    server = await startTestServer(
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
    server = await startTestServer();
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
    server = await startTestServer();
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
    server = await startTestServer();
    const res = await fetch(`${server.baseUrl}/v1/health`);
    const body = await res.json();
    expect(body.providers).toHaveLength(2);
  });
});
