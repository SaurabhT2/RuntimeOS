import { describe, expect, it } from "vitest";
import { contextTrimmedTransformer } from "../../src/transformers/context-trimmed.js";
import { msg } from "../fixtures.js";

describe("contextTrimmedTransformer", () => {
  it("is a no-op when the array already fits the budget", () => {
    const messages = [msg("system", "sys"), msg("user", "short")];
    const result = contextTrimmedTransformer.apply(messages, {
      budget: { maxInputTokens: 10_000, reservedForOutput: 100 },
    });
    expect(result).toEqual(messages);
  });

  it("drops the oldest non-system turns first when over budget", () => {
    const messages = [
      msg("system", "sys"),
      msg("user", "old turn ".repeat(200)),
      msg("assistant", "old reply ".repeat(200)),
      msg("user", "most recent question"),
    ];
    const result = contextTrimmedTransformer.apply(messages, {
      budget: { maxInputTokens: 50, reservedForOutput: 100 },
    });
    // System message is always kept.
    expect(result.some((m) => m.role === "system")).toBe(true);
    // The most recent user turn survives.
    expect(result.at(-1)?.content).toBe("most recent question");
    // At least one older turn was dropped.
    expect(result.length).toBeLessThan(messages.length);
  });

  it("never drops the single most recent non-system message, even if still over budget", () => {
    const messages = [msg("system", "sys"), msg("user", "x".repeat(10_000))];
    const result = contextTrimmedTransformer.apply(messages, {
      budget: { maxInputTokens: 5, reservedForOutput: 10 },
    });
    expect(result.some((m) => m.role === "user")).toBe(true);
  });

  it("keeps all system messages regardless of budget pressure", () => {
    const messages = [
      msg("system", "sys A"),
      msg("system", "sys B"),
      msg("user", "old ".repeat(500)),
      msg("user", "recent"),
    ];
    const result = contextTrimmedTransformer.apply(messages, {
      budget: { maxInputTokens: 20, reservedForOutput: 10 },
    });
    expect(result.filter((m) => m.role === "system")).toHaveLength(2);
  });
});
