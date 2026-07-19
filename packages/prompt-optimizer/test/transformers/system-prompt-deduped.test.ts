import { describe, expect, it } from "vitest";
import { systemPromptDedupedTransformer } from "../../src/transformers/system-prompt-deduped.js";
import { generousBudget, msg } from "../fixtures.js";

describe("systemPromptDedupedTransformer", () => {
  it("removes a repeated identical system prompt, keeping only the first", () => {
    const messages = [
      msg("system", "You are a helpful assistant."),
      msg("user", "hi"),
      msg("system", "You are a helpful assistant."),
      msg("user", "again"),
    ];
    const result = systemPromptDedupedTransformer.apply(messages, { budget: generousBudget() });
    expect(result.filter((m) => m.role === "system")).toHaveLength(1);
    expect(result).toHaveLength(3);
  });

  it("keeps distinct system prompts, even multiple", () => {
    const messages = [msg("system", "prompt A"), msg("system", "prompt B"), msg("user", "hi")];
    const result = systemPromptDedupedTransformer.apply(messages, { budget: generousBudget() });
    expect(result.filter((m) => m.role === "system")).toHaveLength(2);
  });

  it("never touches non-system messages, even if duplicated", () => {
    const messages = [msg("user", "hi"), msg("user", "hi")];
    const result = systemPromptDedupedTransformer.apply(messages, { budget: generousBudget() });
    expect(result).toHaveLength(2);
  });

  it("is a no-op for an array with no system messages", () => {
    const messages = [msg("user", "hi"), msg("assistant", "hello")];
    const result = systemPromptDedupedTransformer.apply(messages, { budget: generousBudget() });
    expect(result).toEqual(messages);
  });
});
