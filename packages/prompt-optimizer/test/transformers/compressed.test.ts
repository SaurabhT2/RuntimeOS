import { describe, expect, it } from "vitest";
import { compressedTransformer } from "../../src/transformers/compressed.js";
import { estimateTokens } from "../../src/token-estimator.js";
import { generousBudget, msg } from "../fixtures.js";

describe("compressedTransformer — token reduction", () => {
  it("measurably reduces token count on a fixture with redundant/filler phrasing", () => {
    const original = [
      msg(
        "user",
        "I would like you to please kindly just basically summarize this document, and I really want you to be very thorough.",
      ),
    ];
    const compressed = compressedTransformer.apply(original, { budget: generousBudget() });
    expect(estimateTokens(compressed)).toBeLessThan(estimateTokens(original));
  });

  it("strips 'in order to' down to 'to' rather than deleting the clause", () => {
    const [result] = compressedTransformer.apply(
      [msg("user", "Read the file in order to extract the summary.")],
      { budget: generousBudget() },
    );
    expect(result?.content).toContain("to extract the summary");
    expect(result?.content).not.toContain("in order to");
  });
});

describe("compressedTransformer — semantic preservation", () => {
  it("preserves every content word (numbers, identifiers, task-relevant nouns/verbs) — only filler words are removed", () => {
    const original = "Summarize the quarterly report and highlight revenue growth of 12 percent.";
    const [result] = compressedTransformer.apply([msg("user", original)], {
      budget: generousBudget(),
    });
    for (const word of ["Summarize", "quarterly", "report", "revenue", "growth", "12", "percent"]) {
      expect(result?.content).toContain(word);
    }
  });

  it("is a no-op on content with no filler phrases", () => {
    const original = "Translate this sentence to French.";
    const [result] = compressedTransformer.apply([msg("user", original)], {
      budget: generousBudget(),
    });
    expect(result?.content).toBe(original);
  });
});
