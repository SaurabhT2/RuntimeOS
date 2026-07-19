import { describe, expect, it } from "vitest";
import { duplicatesRemovedTransformer } from "../../src/transformers/duplicates-removed.js";
import { generousBudget, msg } from "../fixtures.js";

describe("duplicatesRemovedTransformer", () => {
  it("removes an exact duplicate (role + content) content block", () => {
    const messages = [
      msg("user", "context chunk A"),
      msg("user", "context chunk A"),
      msg("user", "context chunk B"),
    ];
    const result = duplicatesRemovedTransformer.apply(messages, { budget: generousBudget() });
    expect(result).toHaveLength(2);
    expect(result.map((m) => m.content)).toEqual(["context chunk A", "context chunk B"]);
  });

  it("does not treat same content with a different role as a duplicate", () => {
    const messages = [msg("user", "same text"), msg("assistant", "same text")];
    const result = duplicatesRemovedTransformer.apply(messages, { budget: generousBudget() });
    expect(result).toHaveLength(2);
  });

  it("is a no-op when there are no duplicates", () => {
    const messages = [msg("user", "a"), msg("assistant", "b"), msg("user", "c")];
    const result = duplicatesRemovedTransformer.apply(messages, { budget: generousBudget() });
    expect(result).toEqual(messages);
  });
});
