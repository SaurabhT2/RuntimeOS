import { describe, expect, it } from "vitest";
import { resolveMessages } from "../src/messages.js";
import { baseRequest } from "./fixtures.js";

describe("resolveMessages", () => {
  it("wraps req.input.text as a single user message", () => {
    const result = resolveMessages(baseRequest({ input: { text: "hello" } }));
    expect(result).toEqual([{ role: "user", content: "hello" }]);
  });

  it("uses req.input.messages directly when present", () => {
    const messages = [
      { role: "system" as const, content: "sys" },
      { role: "user" as const, content: "hi" },
    ];
    const result = resolveMessages(baseRequest({ input: { messages } }));
    expect(result).toEqual(messages);
  });

  it("prefers messages over text when both are present", () => {
    const messages = [{ role: "user" as const, content: "from messages" }];
    const result = resolveMessages(baseRequest({ input: { text: "from text", messages } }));
    expect(result).toEqual(messages);
  });

  it("returns an empty array when neither text nor messages is present", () => {
    const result = resolveMessages(baseRequest({ input: {} }));
    expect(result).toEqual([]);
  });
});
