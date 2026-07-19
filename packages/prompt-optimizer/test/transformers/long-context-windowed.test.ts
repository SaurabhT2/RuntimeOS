import { describe, expect, it } from "vitest";
import { longContextWindowedTransformer } from "../../src/transformers/long-context-windowed.js";
import { generousBudget, msg } from "../fixtures.js";

describe("longContextWindowedTransformer", () => {
  it("is a no-op for ordinary-sized messages", () => {
    const messages = [msg("user", "a normal length message")];
    const result = longContextWindowedTransformer.apply(messages, { budget: generousBudget() });
    expect(result).toEqual(messages);
  });

  it("windows a very large message, preserving head and tail content", () => {
    const head = "BEGINNING-MARKER ";
    const tail = " ENDING-MARKER";
    const filler = "x".repeat(30_000);
    const messages = [msg("user", `${head}${filler}${tail}`)];
    const result = longContextWindowedTransformer.apply(messages, { budget: generousBudget() });
    const content = result[0]?.content ?? "";
    expect(content).toContain("BEGINNING-MARKER");
    expect(content).toContain("ENDING-MARKER");
    expect(content.length).toBeLessThan(messages[0]!.content.length);
  });

  it("inserts a visible omission marker rather than a silent truncation", () => {
    const messages = [msg("user", "y".repeat(25_000))];
    const result = longContextWindowedTransformer.apply(messages, { budget: generousBudget() });
    expect(result[0]?.content).toContain("omitted");
  });

  it("leaves short messages in a mixed array untouched while windowing only the long one", () => {
    const messages = [msg("system", "short system prompt"), msg("user", "z".repeat(25_000))];
    const result = longContextWindowedTransformer.apply(messages, { budget: generousBudget() });
    expect(result[0]?.content).toBe("short system prompt");
    expect(result[1]?.content).toContain("omitted");
  });
});
