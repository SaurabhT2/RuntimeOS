import { afterEach, describe, expect, it } from "vitest";
import { fakeAdapter } from "../../../src/testing/fixtures.js";
import {
  startTestDispatchServer,
  type TestDispatchServer,
} from "../../../src/testing/test-server.js";

let server: TestDispatchServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("POST /v1/execute", () => {
  it("executes a request end-to-end and returns a typed ExecuteResponse", async () => {
    server = await startTestDispatchServer();
    const res = await fetch(`${server.baseUrl}/v1/execute`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-key-org-1" },
      body: JSON.stringify({
        task: "summarization",
        input: { text: "hello" },
        tenant: { organizationId: "org-1" },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.output.text).toContain("response from");
    expect(body.execution.providerId).toMatch(/^(groq|nvidia-nim)$/);
    expect(typeof body.requestId).toBe("string");
  });

  it("returns 401 for a missing API key", async () => {
    server = await startTestDispatchServer();
    const res = await fetch(`${server.baseUrl}/v1/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        task: "summarization",
        input: { text: "hello" },
        tenant: { organizationId: "org-1" },
      }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("CREDENTIAL_INVALID");
  });

  it("returns 401 for an unknown API key", async () => {
    server = await startTestDispatchServer();
    const res = await fetch(`${server.baseUrl}/v1/execute`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer not-a-real-key" },
      body: JSON.stringify({
        task: "summarization",
        input: { text: "hello" },
        tenant: { organizationId: "org-1" },
      }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 for malformed JSON", async () => {
    server = await startTestDispatchServer();
    const res = await fetch(`${server.baseUrl}/v1/execute`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-key-org-1" },
      body: "{not valid json",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_SCHEMA");
  });

  it("returns 400 for a schema-invalid ExecuteRequest (missing tenant)", async () => {
    server = await startTestDispatchServer();
    const res = await fetch(`${server.baseUrl}/v1/execute`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-key-org-1" },
      body: JSON.stringify({ task: "summarization", input: { text: "hello" } }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 429 once the tenant's rate limit is exhausted", async () => {
    server = await startTestDispatchServer({
      rateLimit: { requestsPerWindow: 1, windowMs: 60_000 },
    });
    const requestBody = JSON.stringify({
      task: "summarization",
      input: { text: "hello" },
      tenant: { organizationId: "org-1" },
    });
    const headers = { "content-type": "application/json", authorization: "Bearer test-key-org-1" };

    const first = await fetch(`${server.baseUrl}/v1/execute`, {
      method: "POST",
      headers,
      body: requestBody,
    });
    expect(first.status).toBe(200);

    const second = await fetch(`${server.baseUrl}/v1/execute`, {
      method: "POST",
      headers,
      body: requestBody,
    });
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBeTruthy();
    const body = await second.json();
    expect(body.error.code).toBe("RATE_LIMITED");
  });

  it("returns a cached response on the second identical request", async () => {
    server = await startTestDispatchServer();
    const requestBody = JSON.stringify({
      task: "summarization",
      input: { text: "cache me" },
      tenant: { organizationId: "org-1" },
    });
    const headers = { "content-type": "application/json", authorization: "Bearer test-key-org-1" };

    const first = await fetch(`${server.baseUrl}/v1/execute`, {
      method: "POST",
      headers,
      body: requestBody,
    });
    const firstBody = await first.json();

    const second = await fetch(`${server.baseUrl}/v1/execute`, {
      method: "POST",
      headers,
      body: requestBody,
    });
    const secondBody = await second.json();

    // Same cached ExecuteResponse (including requestId) returned verbatim.
    expect(secondBody).toEqual(firstBody);
  });

  it("surfaces ALL_PROVIDERS_UNAVAILABLE as 503 when every adapter fails", async () => {
    server = await startTestDispatchServer(
      {},
      {
        adapters: [
          fakeAdapter({ id: "groq", behavior: "fail" }),
          fakeAdapter({ id: "nvidia-nim", behavior: "fail" }),
        ],
      },
    );
    const res = await fetch(`${server.baseUrl}/v1/execute`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-key-org-1" },
      body: JSON.stringify({
        task: "summarization",
        input: { text: "hello" },
        tenant: { organizationId: "org-1" },
      }),
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("ALL_PROVIDERS_UNAVAILABLE");
  });

  it("returns 405 for an unsupported method on a known path", async () => {
    server = await startTestDispatchServer();
    const res = await fetch(`${server.baseUrl}/v1/execute`, { method: "GET" });
    expect(res.status).toBe(405);
  });

  it("returns 404 for an unknown path", async () => {
    server = await startTestDispatchServer();
    const res = await fetch(`${server.baseUrl}/v1/nope`);
    expect(res.status).toBe(404);
  });
});
