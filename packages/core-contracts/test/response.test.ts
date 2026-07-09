import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { executeResponseSchema, finishReasonSchema, toolCallSchema } from "../src/response.js";

function loadFixture(name: string): unknown {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf-8"));
}

describe("executeResponseSchema", () => {
  it("parses the hand-written valid ExecuteResponse fixture", () => {
    const fixture = loadFixture("execute-response.valid.json");
    expect(executeResponseSchema.safeParse(fixture).success).toBe(true);
  });

  it("parses a response containing a tool call and json output", () => {
    const fixture = loadFixture("execute-response.with-tool-call.json");
    expect(executeResponseSchema.safeParse(fixture).success).toBe(true);
  });

  it("rejects a response with a negative token count", () => {
    const fixture = loadFixture("execute-response.valid.json") as Record<string, unknown>;
    const invalid = {
      ...fixture,
      usage: { ...(fixture.usage as object), inputTokens: -5 },
    };
    expect(executeResponseSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a response with an invalid finishReason", () => {
    const fixture = loadFixture("execute-response.valid.json") as Record<string, unknown>;
    const invalid = { ...fixture, finishReason: "timeout" };
    expect(executeResponseSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a response missing execution.providerId", () => {
    const fixture = loadFixture("execute-response.valid.json") as Record<string, unknown>;
    const { providerId: _omit, ...rest } = fixture.execution as Record<string, unknown>;
    const invalid = { ...fixture, execution: rest };
    expect(executeResponseSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("toolCallSchema", () => {
  it("parses a valid tool call", () => {
    expect(
      toolCallSchema.safeParse({ id: "call_1", name: "lookup", arguments: "{}" }).success,
    ).toBe(true);
  });

  it("rejects a tool call with an empty name", () => {
    expect(toolCallSchema.safeParse({ id: "call_1", name: "", arguments: "{}" }).success).toBe(
      false,
    );
  });
});

describe("finishReasonSchema", () => {
  it.each(["stop", "length", "content_filter", "tool_call", "cancelled"])("accepts %s", (value) => {
    expect(finishReasonSchema.safeParse(value).success).toBe(true);
  });

  it("rejects an unrecognized finish reason", () => {
    expect(finishReasonSchema.safeParse("exploded").success).toBe(false);
  });
});
