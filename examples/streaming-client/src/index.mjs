#!/usr/bin/env node
/**
 * A minimal external client for AI Gateway's `/v1/execute/stream`
 * endpoint (architecture §9/§10.2/§10.4). No `@ai-gateway/*` dependency —
 * an SSE `data: {json}\n\n` frame is parsed here using nothing but the
 * wire format itself, exactly as a real external caller (or a browser's
 * native `EventSource`, for a GET-based variant) would.
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
  const response = await fetch(`${gatewayUrl}/v1/execute/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      task: "summarization",
      input: { text: "Stream this response back to me, one chunk at a time." },
      tenant: { organizationId: "example-org" },
    }),
  });

  if (!response.ok) {
    const body = await response.json();
    console.error(`Request failed (${response.status}):`, body.error);
    process.exitCode = 1;
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, boundary).trim();
      buffer = buffer.slice(boundary + 2);
      if (!frame.startsWith("data:")) continue;

      const payload = JSON.parse(frame.slice("data:".length).trim());

      if (payload.error) {
        // A mid-stream failure surfaces as one final SSE frame shaped
        // like `{ error: GatewayError }` rather than a StreamChunk — see
        // apps/gateway-server's execute-stream.ts.
        console.error("Stream failed:", payload.error);
        process.exitCode = 1;
        return;
      }

      if (payload.delta?.text) {
        process.stdout.write(payload.delta.text);
      }
      if (payload.done) {
        process.stdout.write("\n");
        console.log(`(finishReason: ${payload.finishReason})`);
      }
    }
  }
}

main().catch((error) => {
  console.error("Unexpected error:", error);
  process.exitCode = 1;
});
