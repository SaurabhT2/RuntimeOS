import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { streamChunkSchema } from "../src/streaming.js";

function loadFixture(name: string): unknown {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf-8"));
}

describe("streamChunkSchema", () => {
  it("parses an in-progress chunk fixture", () => {
    expect(streamChunkSchema.safeParse(loadFixture("stream-chunk.valid.json")).success).toBe(true);
  });

  it("parses a final (done=true) chunk fixture with finishReason", () => {
    expect(streamChunkSchema.safeParse(loadFixture("stream-chunk.final.json")).success).toBe(true);
  });

  it("rejects a chunk missing the done flag", () => {
    const invalid = { requestId: "req_1", delta: { text: "hi" } };
    expect(streamChunkSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a chunk with an invalid finishReason", () => {
    const invalid = { requestId: "req_1", delta: {}, done: true, finishReason: "oops" };
    expect(streamChunkSchema.safeParse(invalid).success).toBe(false);
  });
});
