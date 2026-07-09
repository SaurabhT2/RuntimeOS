import { runConformanceSuite } from "@ai-gateway/provider-sdk";
import { NimAdapter } from "../src/nim-adapter.js";

/**
 * Runs `provider-sdk`'s shared conformance suite (architecture §12.4,
 * §24) against a real `NimAdapter`. `configureBehavior` is omitted for
 * the same reason as `@ai-gateway/groq`'s `conformance.test.ts` — see
 * that package's own comment for the rationale, which applies identically
 * here.
 */
function conformanceFetch(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/models")) {
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }

    const body = init?.body ? (JSON.parse(init.body as string) as { stream?: boolean }) : {};
    if (body.stream) {
      const encoder = new TextEncoder();
      const frames = [
        'data: {"id":"1","choices":[{"index":0,"delta":{"content":"conformance"},"finish_reason":null}]}\n\n',
        'data: {"id":"1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}\n\n',
        "data: [DONE]\n\n",
      ];
      let i = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (i < frames.length) {
            controller.enqueue(encoder.encode(frames[i]!));
            i++;
          } else {
            controller.close();
          }
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }

    return new Response(
      JSON.stringify({
        id: "chatcmpl-conformance",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "conformance response" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 4, completion_tokens: 4, total_tokens: 8 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
}

runConformanceSuite({
  createAdapter: () => new NimAdapter({ fetchImpl: conformanceFetch() }),
  credential: { key: "test-key", scope: "workspace" },
  invocation: {
    modelId: "meta/llama3-70b-instruct",
    messages: [{ role: "user", content: "hello" }],
    temperature: 0.5,
    maxOutputTokens: 64,
    stream: false,
    timeoutMs: 5000,
  },
});
