import { afterEach, describe, expect, it } from "vitest";
import {
  startTestDispatchServer,
  type TestDispatchServer,
} from "../../../src/testing/test-server.js";

let server: TestDispatchServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("POST /v1/execute/pipeline", () => {
  it("executes a multi-step pipeline end-to-end, threading each step's output into the next", async () => {
    server = await startTestDispatchServer();
    const res = await fetch(`${server.baseUrl}/v1/execute/pipeline`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-key-org-1" },
      body: JSON.stringify({
        id: "pipeline-1",
        tenant: { organizationId: "org-1" },
        steps: [
          { id: "extract", task: "knowledge_extraction", input: { text: "raw document" } },
          { id: "summarize", task: "summarization", inputFrom: "extract" },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.completed).toBe(true);
    expect(Object.keys(body.stepResults)).toEqual(["extract", "summarize"]);
    expect(body.stepResults.extract.output.text).toContain("response from");
    expect(body.stepResults.summarize.output.text).toContain("response from");
    expect(typeof body.totalCostUsd).toBe("number");
    expect(typeof body.totalLatencyMs).toBe("number");
  });

  it("returns a serialized GatewayError (not a raw exception) for a required step's failure", async () => {
    server = await startTestDispatchServer(
      {},
      { adapters: [{ id: "groq", invoke: async () => { throw new Error("boom"); }, invokeStream: async function* () {}, healthCheck: async () => ({ providerId: "groq", healthy: true, lastCheckedAt: new Date().toISOString(), consecutiveFailures: 0 }), estimateCost: () => ({ estimatedInputTokens: 1, estimatedOutputTokens: 1, estimatedCostUsd: 0 }) }] },
    );
    const res = await fetch(`${server.baseUrl}/v1/execute/pipeline`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-key-org-1" },
      body: JSON.stringify({
        id: "pipeline-1",
        tenant: { organizationId: "org-1" },
        steps: [{ id: "s1", task: "summarization", input: { text: "x" } }],
      }),
    });
    expect(res.status).toBe(200); // the pipeline endpoint itself succeeded; the step failed
    const body = await res.json();
    expect(body.completed).toBe(false);
    expect(body.stepResults.s1.code).toBeDefined();
  });

  it("returns 401 for a missing API key", async () => {
    server = await startTestDispatchServer();
    const res = await fetch(`${server.baseUrl}/v1/execute/pipeline`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "pipeline-1",
        tenant: { organizationId: "org-1" },
        steps: [{ id: "s1", task: "summarization", input: { text: "x" } }],
      }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 for malformed JSON", async () => {
    server = await startTestDispatchServer();
    const res = await fetch(`${server.baseUrl}/v1/execute/pipeline`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-key-org-1" },
      body: "{not valid json",
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a pipeline with no steps", async () => {
    server = await startTestDispatchServer();
    const res = await fetch(`${server.baseUrl}/v1/execute/pipeline`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-key-org-1" },
      body: JSON.stringify({ id: "pipeline-1", tenant: { organizationId: "org-1" }, steps: [] }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a step with neither input nor inputFrom", async () => {
    server = await startTestDispatchServer();
    const res = await fetch(`${server.baseUrl}/v1/execute/pipeline`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-key-org-1" },
      body: JSON.stringify({
        id: "pipeline-1",
        tenant: { organizationId: "org-1" },
        steps: [{ id: "s1", task: "summarization" }],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for an inputFrom referencing an unknown step", async () => {
    server = await startTestDispatchServer();
    const res = await fetch(`${server.baseUrl}/v1/execute/pipeline`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-key-org-1" },
      body: JSON.stringify({
        id: "pipeline-1",
        tenant: { organizationId: "org-1" },
        steps: [{ id: "s1", task: "summarization", inputFrom: "does-not-exist" }],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a pipeline exceeding the configured maxPipelineSteps", async () => {
    server = await startTestDispatchServer({ maxPipelineSteps: 1 });
    const res = await fetch(`${server.baseUrl}/v1/execute/pipeline`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-key-org-1" },
      body: JSON.stringify({
        id: "pipeline-1",
        tenant: { organizationId: "org-1" },
        steps: [
          { id: "s1", task: "summarization", input: { text: "x" } },
          { id: "s2", task: "summarization", input: { text: "x" } },
        ],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_TASK");
  });

  it("does not affect /v1/execute — the single-request endpoint is unchanged", async () => {
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
  });
});
