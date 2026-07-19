import { streamChunkSchema, type StreamChunk } from "@ai-gateway/core-contracts";
import type { NormalizedChunk } from "@ai-gateway/provider-sdk";

/** Attaches the transport-agnostic `NormalizedChunk` to a specific request, producing the wire-facing `StreamChunk` (architecture §10.4/§12.1: "`streaming` is responsible for framing this as SSE or WebSocket messages"). */
export function toStreamChunk(chunk: NormalizedChunk, requestId: string): StreamChunk {
  return {
    requestId,
    delta: chunk.delta,
    done: chunk.done,
    ...(chunk.finishReason !== undefined ? { finishReason: chunk.finishReason } : {}),
  };
}

/** Encodes one `StreamChunk` as a single SSE `data:` frame (`data: {json}\n\n`), the wire format architecture §10.2 REST contract's `/execute/stream` route emits. */
export function encodeSseChunk(chunk: StreamChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

/** Decodes one SSE `data:` frame's payload back into a `StreamChunk`, validating it against `core-contracts`' schema. Primarily a test/tooling seam (round-tripping the format this package emits) — an SSE *client*, receiving over the wire, is out of this package's scope (`streaming` is server-side transport; a browser's native `EventSource`, or a future `examples/minimal-node-client`, is the consumer). Throws if `raw` is not a well-formed `data:` frame or its payload doesn't validate. */
export function decodeSseChunk(raw: string): StreamChunk {
  const line = raw.trim();
  if (!line.startsWith("data:")) {
    throw new Error(`Not an SSE data frame: ${JSON.stringify(raw)}`);
  }
  const payload = line.slice("data:".length).trim();
  return streamChunkSchema.parse(JSON.parse(payload));
}

/**
 * Frames a full `AsyncIterable<NormalizedChunk>` (e.g. `StreamManager.
 * openStream`'s return value) as an `AsyncIterable` of SSE wire-format
 * strings, one per chunk, in the order produced — this is what "streaming
 * chunk-ordering tests" (Blueprint §7 EM-3) actually exercises: that
 * ordering is preserved end-to-end from provider chunk to wire frame.
 */
export async function* toSseFrames(
  chunks: AsyncIterable<NormalizedChunk>,
  requestId: string,
): AsyncIterable<string> {
  for await (const chunk of chunks) {
    yield encodeSseChunk(toStreamChunk(chunk, requestId));
  }
}

/**
 * Encodes an `AsyncIterable<string>` of SSE frames as UTF-8 bytes, ready
 * to pipe directly into an HTTP response body — a convenience wrapper
 * still squarely inside "transport encoding," not HTTP routing itself
 * (wiring an actual `/execute/stream` HTTP route is `apps/gateway-server`,
 * EM-5).
 */
export async function* toSseByteStream(frames: AsyncIterable<string>): AsyncIterable<Uint8Array> {
  const encoder = new TextEncoder();
  for await (const frame of frames) {
    yield encoder.encode(frame);
  }
}
