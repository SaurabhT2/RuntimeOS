import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { GatewayError } from "@ai-gateway/core-contracts";
import { readJsonBody } from "../../src/http/read-body.js";

function fakeReq(chunks: (string | Buffer)[]): IncomingMessage {
  return Readable.from(chunks.map((c) => Buffer.from(c))) as unknown as IncomingMessage;
}

describe("readJsonBody", () => {
  it("parses a well-formed JSON body", async () => {
    const result = await readJsonBody(fakeReq([JSON.stringify({ hello: "world" })]));
    expect(result).toEqual({ hello: "world" });
  });

  it("parses a body split across multiple chunks", async () => {
    const json = JSON.stringify({ a: 1, b: 2 });
    const result = await readJsonBody(fakeReq([json.slice(0, 5), json.slice(5)]));
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it("rejects with INVALID_SCHEMA for malformed JSON", async () => {
    await expect(readJsonBody(fakeReq(["{not valid json"]))).rejects.toMatchObject({
      code: "INVALID_SCHEMA",
    });
  });

  it("rejects with INVALID_SCHEMA for an empty body", async () => {
    await expect(readJsonBody(fakeReq([""]))).rejects.toMatchObject({ code: "INVALID_SCHEMA" });
  });

  it("rejects with INVALID_SCHEMA (not an unhandled OOM) for an oversized body", async () => {
    const oversized = "x".repeat(3 * 1024 * 1024);
    const rejection = readJsonBody(fakeReq([oversized]));
    await expect(rejection).rejects.toBeInstanceOf(GatewayError);
    await expect(rejection).rejects.toMatchObject({ code: "INVALID_SCHEMA" });
  });
});
