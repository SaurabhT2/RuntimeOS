import { describe, expect, it } from "vitest";
import type { NormalizedChunk } from "@ai-gateway/provider-sdk";
import {
  decodeSseChunk,
  encodeSseChunk,
  toSseByteStream,
  toSseFrames,
  toStreamChunk,
} from "../src/sse.js";

describe("toStreamChunk", () => {
  it("attaches the requestId and carries delta/done through unchanged", () => {
    const chunk: NormalizedChunk = { delta: { text: "hi" }, done: false };
    expect(toStreamChunk(chunk, "req-1")).toEqual({
      requestId: "req-1",
      delta: { text: "hi" },
      done: false,
    });
  });

  it("includes finishReason only when the NormalizedChunk has one", () => {
    const withReason = toStreamChunk({ delta: {}, done: true, finishReason: "stop" }, "req-1");
    expect(withReason.finishReason).toBe("stop");
    const withoutReason = toStreamChunk({ delta: { text: "x" }, done: false }, "req-1");
    expect("finishReason" in withoutReason).toBe(false);
  });
});

describe("encodeSseChunk / decodeSseChunk", () => {
  it("round-trips a chunk through the wire format", () => {
    const chunk = toStreamChunk({ delta: { text: "hello" }, done: false }, "req-42");
    const decoded = decodeSseChunk(encodeSseChunk(chunk));
    expect(decoded).toEqual(chunk);
  });

  it("round-trips a terminal chunk with finishReason", () => {
    const chunk = toStreamChunk({ delta: {}, done: true, finishReason: "stop" }, "req-42");
    expect(decodeSseChunk(encodeSseChunk(chunk))).toEqual(chunk);
  });

  it("produces a well-formed data: frame terminated by a blank line", () => {
    const frame = encodeSseChunk(
      toStreamChunk({ delta: {}, done: true, finishReason: "stop" }, "req-1"),
    );
    expect(frame.startsWith("data: ")).toBe(true);
    expect(frame.endsWith("\n\n")).toBe(true);
  });

  it("throws on a non-data: frame", () => {
    expect(() => decodeSseChunk("event: ping\n\n")).toThrow();
  });

  it("throws on a data: frame whose payload fails schema validation", () => {
    expect(() => decodeSseChunk('data: {"requestId":""}\n\n')).toThrow();
  });
});

describe("toSseFrames", () => {
  async function* chunks(items: NormalizedChunk[]): AsyncIterable<NormalizedChunk> {
    for (const item of items) yield item;
  }

  it("preserves chunk order end-to-end (Blueprint's 'streaming chunk-ordering tests')", async () => {
    const input: NormalizedChunk[] = [
      { delta: { text: "He" }, done: false },
      { delta: { text: "llo" }, done: false },
      { delta: { text: " world" }, done: false },
      { delta: {}, done: true, finishReason: "stop" },
    ];

    const frames: string[] = [];
    for await (const frame of toSseFrames(chunks(input), "req-order")) {
      frames.push(frame);
    }

    expect(frames).toHaveLength(4);
    const decoded = frames.map(decodeSseChunk);
    expect(decoded.map((c) => c.delta.text ?? null)).toEqual(["He", "llo", " world", null]);
    expect(decoded.every((c) => c.requestId === "req-order")).toBe(true);
    expect(decoded[3]!.done).toBe(true);
    expect(decoded[3]!.finishReason).toBe("stop");
  });

  it("produces no frames for an empty chunk stream", async () => {
    const frames: string[] = [];
    for await (const frame of toSseFrames(chunks([]), "req-empty")) {
      frames.push(frame);
    }
    expect(frames).toEqual([]);
  });
});

describe("toSseByteStream", () => {
  it("encodes each frame as UTF-8 bytes, preserving order", async () => {
    async function* frames(): AsyncIterable<string> {
      yield 'data: {"a":1}\n\n';
      yield 'data: {"a":2}\n\n';
    }

    const decoder = new TextDecoder();
    const decoded: string[] = [];
    for await (const bytes of toSseByteStream(frames())) {
      expect(bytes).toBeInstanceOf(Uint8Array);
      decoded.push(decoder.decode(bytes));
    }
    expect(decoded).toEqual(['data: {"a":1}\n\n', 'data: {"a":2}\n\n']);
  });
});
