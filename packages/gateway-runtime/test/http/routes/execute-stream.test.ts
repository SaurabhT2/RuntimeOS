import { afterEach, describe, expect, it } from "vitest";
import type { StreamChunk } from "@ai-gateway/core-contracts";
import { decodeSseChunk } from "@ai-gateway/streaming";
import { fakeAdapter, fakeSlowStreamAdapter } from "../../../src/testing/fixtures.js";
import {
  startTestDispatchServer,
  type TestDispatchServer,
} from "../../../src/testing/test-server.js";

let server: TestDispatchServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function collectSseChunks(res: Response): Promise<StreamChunk[]> {
  const body = res.body;
  if (!body) throw new Error("Response has no body");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const chunks: StreamChunk[] = [];

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (frame.trim().length > 0) {
        chunks.push(decodeSseChunk(frame));
      }
    }
  }
  return chunks;
}

describe("POST /v1/execute/stream", () => {
  it("streams SSE chunks ending in a done:true frame", async () => {
    server = await startTestDispatchServer();
    const res = await fetch(`${server.baseUrl}/v1/execute/stream`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-key-org-1" },
      body: JSON.stringify({
        task: "summarization",
        input: { text: "hello" },
        tenant: { organizationId: "org-1" },
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const chunks = await collectSseChunks(res);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[chunks.length - 1]?.done).toBe(true);
    expect(chunks.every((c) => c.requestId === chunks[0]?.requestId)).toBe(true);
  });

  it("returns 401 (as a normal JSON response, not SSE) for a missing API key", async () => {
    server = await startTestDispatchServer();
    const res = await fetch(`${server.baseUrl}/v1/execute/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        task: "summarization",
        input: { text: "hello" },
        tenant: { organizationId: "org-1" },
      }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("returns 400 (as JSON, not SSE) for a schema-invalid request", async () => {
    server = await startTestDispatchServer();
    const res = await fetch(`${server.baseUrl}/v1/execute/stream`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-key-org-1" },
      body: JSON.stringify({ task: "summarization", input: { text: "hello" } }),
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("surfaces a mid-stream provider failure as a final SSE error frame, not a raw disconnect", async () => {
    server = await startTestDispatchServer(
      {},
      {
        adapters: [
          fakeAdapter({ id: "groq", behavior: "fail" }),
          fakeAdapter({ id: "nvidia-nim", behavior: "fail" }),
        ],
      },
    );
    const res = await fetch(`${server.baseUrl}/v1/execute/stream`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-key-org-1" },
      body: JSON.stringify({
        task: "summarization",
        input: { text: "hello" },
        tenant: { organizationId: "org-1" },
      }),
    });
    // `writeHead(200, ...)` already ran before `executeStream` starts
    // producing anything, so a failure here — even one on the very first
    // chunk — is always after headers are sent. It surfaces as a normal
    // 200 SSE response containing one final error frame, per this route's
    // own documented "headers already sent -> SSE error frame, not a new
    // status code" behavior (see execute-stream.ts).
    expect(res.status).toBe(200);
    const body = res.body;
    if (!body) throw new Error("Response has no body");
    const text = await new Response(body).text();
    const frames = text
      .split("\n\n")
      .map((f) => f.trim())
      .filter((f) => f.length > 0);
    expect(frames).toHaveLength(1);
    const payload = JSON.parse(frames[0]!.slice("data:".length).trim());
    expect(payload.error.code).toBe("ALL_PROVIDERS_UNAVAILABLE");
  });

  it("aborting the client request does not crash the server (exercises the close-triggered cancel path)", async () => {
    server = await startTestDispatchServer(
      {},
      { adapters: [fakeSlowStreamAdapter("groq"), fakeAdapter({ id: "nvidia-nim" })] },
    );
    const controller = new AbortController();
    const fetchPromise = fetch(`${server.baseUrl}/v1/execute/stream`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-key-org-1" },
      body: JSON.stringify({
        task: "summarization",
        input: { text: "hello" },
        tenant: { organizationId: "org-1" },
      }),
      signal: controller.signal,
    });
    controller.abort();
    await expect(fetchPromise).rejects.toThrow();

    // The server itself must still be up and answering other requests —
    // the abort above must not have crashed the process or left the
    // server in a broken state.
    const health = await fetch(`${server.baseUrl}/v1/health`);
    expect(health.status).toBeLessThan(500);
  });
});
