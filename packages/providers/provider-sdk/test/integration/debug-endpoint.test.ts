import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockAdapter } from "../../src/mock-adapter.js";
import { createDebugServer } from "./debug-server.js";

describe("EM-1 vertical slice: POST /debug/execute", () => {
  const adapter = new MockAdapter();
  const credential = { key: "debug-key", scope: "workspace" as const };
  const server = createDebugServer(adapter, credential);
  let baseUrl: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected server to bind to a TCP address");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it("returns a Mock Adapter response end-to-end", async () => {
    const response = await fetch(`${baseUrl}/debug/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        task: "summarization",
        text: "Please summarize the quarterly report.",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.output.text).toContain("mock response for model mock-fast-extraction");
    expect(body.finishReason).toBe("stop");
    expect(body.execution.providerId).toBe("mock");
    expect(body.execution.modelClass).toBe("summarization");
    expect(body.usage.inputTokens).toBeGreaterThan(0);
    expect(body.usage.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("still returns end-to-end when the Mock Adapter is configured with simulated latency", async () => {
    adapter.setBehavior({ mode: "success", latencyMs: 20 });
    try {
      const response = await fetch(`${baseUrl}/debug/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task: "classification", text: "Is this spam?" }),
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      // Confirms the simulated latency actually elapsed end-to-end (as
      // opposed to being bypassed entirely, which would read ~0ms) —
      // not a precision claim. Date.now()-based measurement around a
      // setTimeout-based delay() can read a millisecond or two under
      // the configured value on some CI runners' clock resolution, so
      // this allows a small tolerance rather than asserting the exact
      // configured floor.
      expect(body.execution.latencyMs).toBeGreaterThanOrEqual(15);
    } finally {
      adapter.reset();
    }
  });

  it("returns a 404 for unrelated routes", async () => {
    const response = await fetch(`${baseUrl}/not-a-real-route`);
    expect(response.status).toBe(404);
  });

  it("surfaces adapter failures as a 500 rather than hanging or crashing the server", async () => {
    adapter.setBehavior({ mode: "error", errorCode: "INTERNAL_ERROR", errorMessage: "boom" });
    try {
      const response = await fetch(`${baseUrl}/debug/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task: "summarization", text: "hi" }),
      });
      expect(response.status).toBe(500);
    } finally {
      adapter.reset();
    }
  });
});
