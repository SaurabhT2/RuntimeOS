#!/usr/bin/env node
/**
 * A minimal external client for AI Gateway's `/v1/execute/pipeline`
 * endpoint (v1.2, EM-10; architecture §41.3). Deliberately has **no**
 * dependency on any `@ai-gateway/*` workspace package — like
 * `examples/minimal-node-client` and `examples/streaming-client`, this
 * is what a real, external caller writes against a deployed instance,
 * using nothing but the public REST contract and Node's built-in
 * `fetch`.
 *
 * This example runs a 2-step pipeline: step 1 summarizes a piece of
 * text; step 2 takes step 1's output as its own input (via `inputFrom`,
 * not a literal `input`) and expands on it. This demonstrates both ways
 * a step can source its input, and the aggregate `totalCostUsd`/
 * `durationMs` fields `PipelineResult` reports across the whole call.
 *
 * Usage:
 *   GATEWAY_URL=http://localhost:3000 GATEWAY_API_KEY=your-key node src/index.mjs
 */

const gatewayUrl = process.env.GATEWAY_URL ?? "http://localhost:3000";
const apiKey = process.env.GATEWAY_API_KEY;

if (!apiKey) {
  console.error(
    "Set GATEWAY_API_KEY to a valid gateway API key before running this example " +
      "(see apps/gateway-server's README for how to configure one).",
  );
  process.exit(1);
}

async function main() {
  const response = await fetch(`${gatewayUrl}/v1/execute/pipeline`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      id: "pipeline-example-1",
      tenant: { organizationId: "example-org" },
      steps: [
        {
          id: "summarize",
          task: "summarization",
          input: {
            text: "AI Gateway is a unified runtime for calling multiple LLM providers. It routes requests by task type rather than by model name, retries transient failures, and fails over across providers automatically.",
          },
        },
        {
          id: "expand",
          task: "complex_reasoning",
          // No literal `input` here — this step's input is step
          // "summarize"'s ExecuteResponse.output instead.
          inputFrom: "summarize",
        },
      ],
    }),
  });

  const body = await response.json();

  if (!response.ok) {
    console.error(`Request failed (${response.status}):`, body.error);
    process.exitCode = 1;
    return;
  }

  console.log(`Pipeline ${body.pipelineId} finished in ${body.durationMs}ms`);
  console.log(`Total cost: $${body.totalCostUsd.toFixed(4)}`);

  for (const [stepId, result] of Object.entries(body.stepResults)) {
    // A failed/skipped step's entry is a serialized GatewayError — a flat
    // { name: "GatewayError", code, message, retryable, details } object,
    // not nested under an `.error` key. A successful step's entry is a
    // normal ExecuteResponse, which never has a top-level `code` field.
    if (result?.code) {
      console.log(`Step "${stepId}" failed (${result.code}):`, result.message);
      continue;
    }
    console.log(`Step "${stepId}" output:`, result.output?.text ?? result.output);
  }
}

main().catch((error) => {
  console.error("Unexpected error:", error);
  process.exitCode = 1;
});
