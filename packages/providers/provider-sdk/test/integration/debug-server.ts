import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { ProviderAdapter } from "../../src/provider-adapter.js";
import type { ScopedCredential } from "../../src/credential.js";

/**
 * A temporary, non-public HTTP harness for EM-1's demonstrable vertical
 * slice only (Blueprint §7: "a trivial orchestrator stub that calls the
 * Mock Adapter directly ... and returns a canned response through a bare
 * HTTP endpoint" / "POST /debug/execute ... returns a Mock Adapter response
 * end-to-end").
 *
 * Deliberately **not** `packages/orchestrator` or `apps/gateway-server`:
 *
 * - `packages/orchestrator`'s own dependency edges (Section 4.1's
 *   `DEPENDENCY_TABLE`) are frozen at EM-0 to `policy-engine`,
 *   `credential-resolver`, `reliability`, `streaming`, `telemetry`,
 *   `core-contracts` — deliberately *not* `provider-sdk` — because the real
 *   orchestrator (Wave 4/EM-4) never talks to a provider adapter directly;
 *   it always goes through `streaming`. Giving the real orchestrator
 *   package a direct `provider-sdk` edge just for this EM-1 demo would mean
 *   either violating that frozen graph or amending EM-0 — both against the
 *   "never modify EM-0 / never redesign architecture" rule for this
 *   milestone. See `docs/adr/` (flagged for review) — this is the one
 *   genuine EM-0/EM-1 scope tension found during implementation; resolved
 *   here by keeping the demo entirely inside `provider-sdk` (the one
 *   package EM-1 actually implements) instead of touching `orchestrator`.
 * - `apps/gateway-server` is explicitly out of scope until EM-5
 *   (`apps/README.md`).
 *
 * This module is test-only scaffolding (`test/integration/`), not part of
 * `provider-sdk`'s public API (`src/index.ts` does not export it), and
 * exists solely so `debug-endpoint.test.ts` can assert the acceptance
 * criterion above with a real HTTP round-trip.
 */
export function createDebugServer(adapter: ProviderAdapter, credential: ScopedCredential): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST" || req.url !== "/debug/execute") {
      res
        .writeHead(404, { "content-type": "application/json" })
        .end(JSON.stringify({ error: "not found" }));
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      void handleExecute(adapter, credential, Buffer.concat(chunks).toString("utf-8"), res);
    });
  });
}

async function handleExecute(
  adapter: ProviderAdapter,
  credential: ScopedCredential,
  rawBody: string,
  res: ServerResponse,
): Promise<void> {
  const startedAt = Date.now();
  try {
    const body: { task?: string; text?: string } = rawBody ? JSON.parse(rawBody) : {};
    const invocation = {
      modelId: "mock-fast-extraction",
      messages: [{ role: "user" as const, content: body.text ?? "" }],
      temperature: 0.2,
      maxOutputTokens: 128,
      stream: false,
      timeoutMs: 5000,
    };

    const result = await adapter.invoke(invocation, credential);

    const responseBody = {
      requestId: "debug-request",
      output: { text: result.text, json: result.json, toolCalls: result.toolCalls },
      usage: {
        ...result.usage,
        estimatedCostUsd: adapter.estimateCost(invocation).estimatedCostUsd,
      },
      execution: {
        providerId: adapter.id,
        modelClass: body.task ?? "unspecified",
        latencyMs: Date.now() - startedAt,
        retries: 0,
        failedOver: false,
      },
      finishReason: result.finishReason,
    };

    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(responseBody));
  } catch (error) {
    res
      .writeHead(500, { "content-type": "application/json" })
      .end(JSON.stringify({ error: error instanceof Error ? error.message : "unknown error" }));
  }
}
