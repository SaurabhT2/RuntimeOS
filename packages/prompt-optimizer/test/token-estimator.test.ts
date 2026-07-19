import { describe, expect, it } from "vitest";
import { estimateTokens } from "../src/token-estimator.js";
import { msg } from "./fixtures.js";

describe("estimateTokens", () => {
  it("returns 0 for an empty message array", () => {
    expect(estimateTokens([])).toBe(0);
  });

  it("increases with longer content", () => {
    const short = estimateTokens([msg("user", "hi")]);
    const long = estimateTokens([msg("user", "hi ".repeat(500))]);
    expect(long).toBeGreaterThan(short);
  });

  it("sums across multiple messages", () => {
    const one = estimateTokens([msg("user", "hello world")]);
    const two = estimateTokens([msg("user", "hello world"), msg("assistant", "hello world")]);
    expect(two).toBeGreaterThan(one);
  });
});
