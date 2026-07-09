import { describe, expect, it } from "vitest";
import { parseSseDataLines } from "../src/sse-parser.js";

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]!));
        i++;
      } else {
        controller.close();
      }
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  for await (const payload of parseSseDataLines(stream)) {
    out.push(payload);
  }
  return out;
}

describe("parseSseDataLines", () => {
  it("parses multiple complete frames delivered in one chunk", async () => {
    const stream = streamFromChunks(['data: {"a":1}\n\ndata: {"a":2}\n\n']);
    expect(await collect(stream)).toEqual(['{"a":1}', '{"a":2}']);
  });

  it("buffers correctly when a frame is split across chunk boundaries, including mid-line", async () => {
    const stream = streamFromChunks(['data: {"a":1', "}\n", '\ndata: {"a":2}\n\n']);
    expect(await collect(stream)).toEqual(['{"a":1}', '{"a":2}']);
  });

  it("stops at a literal [DONE] frame without yielding it", async () => {
    const stream = streamFromChunks(['data: {"a":1}\n\ndata: [DONE]\n\ndata: {"a":2}\n\n']);
    expect(await collect(stream)).toEqual(['{"a":1}']);
  });

  it("ignores a frame with no data: field", async () => {
    const stream = streamFromChunks(["event: ping\n\n", 'data: {"a":1}\n\n']);
    expect(await collect(stream)).toEqual(['{"a":1}']);
  });

  it("returns an empty array for an empty stream", async () => {
    expect(await collect(streamFromChunks([]))).toEqual([]);
  });

  it("handles a stream that ends without a trailing terminator gracefully (partial frame is simply dropped)", async () => {
    const stream = streamFromChunks(['data: {"a":1}\n\ndata: {"incomplete"']);
    expect(await collect(stream)).toEqual(['{"a":1}']);
  });
});
