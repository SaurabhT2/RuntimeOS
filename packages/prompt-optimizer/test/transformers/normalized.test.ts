import { describe, expect, it } from "vitest";
import { normalizedTransformer } from "../../src/transformers/normalized.js";
import { generousBudget, msg } from "../fixtures.js";

describe("normalizedTransformer", () => {
  it("collapses internal whitespace runs into a single space", () => {
    const [result] = normalizedTransformer.apply([msg("user", "hello    world\n\n\tfoo")], {
      budget: generousBudget(),
    });
    expect(result?.content).toBe("hello world foo");
  });

  it("trims leading/trailing whitespace", () => {
    const [result] = normalizedTransformer.apply([msg("user", "  hi  ")], {
      budget: generousBudget(),
    });
    expect(result?.content).toBe("hi");
  });

  it("never removes any word — only whitespace", () => {
    const original = "The quick brown fox jumps over the lazy dog";
    const [result] = normalizedTransformer.apply([msg("user", original)], {
      budget: generousBudget(),
    });
    expect(result?.content.split(" ").sort()).toEqual(original.split(" ").sort());
  });

  it("preserves message role and count", () => {
    const messages = [msg("system", "sys"), msg("user", "u1"), msg("assistant", "a1")];
    const result = normalizedTransformer.apply(messages, { budget: generousBudget() });
    expect(result.map((m) => m.role)).toEqual(["system", "user", "assistant"]);
  });
});
