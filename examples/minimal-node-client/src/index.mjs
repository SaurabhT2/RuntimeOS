#!/usr/bin/env node
/**
 * A minimal external client for AI Gateway's `/v1/execute` endpoint
 * (architecture §9/§10.2; Blueprint §7 EM-5's own named deliverable).
 * Deliberately has **no** dependency on any `@ai-gateway/*` workspace
 * package — this is what a real, external caller writes against a
 * deployed instance, using nothing but the public REST contract and
 * Node's built-in `fetch`.
 *
 * Usage:
 *   GATEWAY_URL=http://localhost:3000 GATEWAY_API_KEY=your-key node src/index.mjs
 *
 * (This milestone's own acceptance criterion: "External example client
 * completes a real request against a deployed instance.")
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
  const response = await fetch(`${gatewayUrl}/v1/execute`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      task: "summarization",
      input: { text: "AI Gateway is a unified runtime for calling multiple LLM providers." },
      tenant: { organizationId: "example-org" },
    }),
  });

  const body = await response.json();

  if (!response.ok) {
    console.error(`Request failed (${response.status}):`, body.error);
    process.exitCode = 1;
    return;
  }

  console.log(`Provider: ${body.execution.providerId} (model class: ${body.execution.modelClass})`);
  console.log(`Failed over: ${body.execution.failedOver}, retries: ${body.execution.retries}`);
  console.log("Output:", body.output.text);
}

main().catch((error) => {
  console.error("Unexpected error:", error);
  process.exitCode = 1;
});
