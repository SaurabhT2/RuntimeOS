/** Records every request the adapter under test made, for assertions. */
export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  signal?: AbortSignal;
}

export type FakeFetchScript = Array<
  | { kind: "json"; status: number; body: unknown }
  | { kind: "sse"; status: number; frames: string[] }
  | { kind: "hang" }
  | { kind: "throw"; error: Error }
>;

/**
 * A minimal `fetch`-compatible fake, scripted with a queue of canned
 * responses (one consumed per call) — this package's own tests never make
 * a live network call (this package's README, Testing strategy: "recorded
 * fixtures, not live calls, in CI").
 */
export function createFakeFetch(script: FakeFetchScript): {
  fetch: typeof fetch;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  let callIndex = 0;

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const step = script[callIndex];
    callIndex++;
    if (!step) {
      throw new Error(
        `Fake fetch called more times (${callIndex}) than the script has steps (${script.length}).`,
      );
    }

    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        headers[k] = v;
      }
    }
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
      signal: init?.signal ?? undefined,
    });

    if (step.kind === "throw") {
      throw step.error;
    }

    if (step.kind === "hang") {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("The operation was aborted.");
          error.name = "AbortError";
          reject(error);
        });
      });
    }

    if (step.kind === "json") {
      return new Response(JSON.stringify(step.body), {
        status: step.status,
        headers: { "content-type": "application/json" },
      });
    }

    // kind === "sse"
    const encoder = new TextEncoder();
    const frames = step.frames;
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
      status: step.status,
      headers: { "content-type": "text/event-stream" },
    });
  }) as typeof fetch;

  return { fetch: fetchImpl, requests };
}
