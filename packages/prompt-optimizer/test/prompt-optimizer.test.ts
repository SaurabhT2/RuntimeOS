import { describe, expect, it } from "vitest";
import { DefaultPromptOptimizer } from "../src/prompt-optimizer.js";
import { estimateTokens } from "../src/token-estimator.js";
import { generousBudget, msg, profile } from "./fixtures.js";

describe("DefaultPromptOptimizer.optimize — token reduction (Blueprint §7 EM-7 acceptance criterion)", () => {
  it("measurably reduces token count on a fixture with redundant content", async () => {
    const optimizer = new DefaultPromptOptimizer();
    const messages = [
      msg("system", "You are a helpful assistant."),
      msg("system", "You are a helpful assistant."), // duplicated system prompt
      msg("user", "context chunk A"),
      msg("user", "context chunk A"), // duplicated content block
      msg(
        "user",
        "I would like you to please kindly just summarize this   document   with   extra   whitespace.",
      ),
    ];
    const before = estimateTokens(messages);
    const result = await optimizer.optimize(messages, generousBudget(), profile("summarization"));
    expect(result.estimatedTokens).toBeLessThan(before);
    expect(result.transformationsApplied).toEqual(
      expect.arrayContaining([
        "normalized",
        "system_prompt_deduped",
        "duplicates_removed",
        "compressed",
      ]),
    );
  });
});

describe("DefaultPromptOptimizer.optimize — coding profile bypass", () => {
  it("bypasses the compressed transformer for the coding profile", async () => {
    const optimizer = new DefaultPromptOptimizer();
    const messages = [msg("user", "Please kindly just refactor this function.")];
    const result = await optimizer.optimize(messages, generousBudget(), profile("coding"));
    expect(result.transformationsApplied).not.toContain("compressed");
    expect(result.messages[0]?.content).toContain("Please kindly just refactor this function");
  });
});

describe("DefaultPromptOptimizer.optimize — json_generation bypass", () => {
  it("bypasses the compressed transformer for the json_generation profile", async () => {
    const optimizer = new DefaultPromptOptimizer();
    const messages = [msg("user", "Please kindly just extract the fields as JSON.")];
    const result = await optimizer.optimize(messages, generousBudget(), profile("json_generation"));
    expect(result.transformationsApplied).not.toContain("compressed");
    expect(result.messages[0]?.content).toContain("Please kindly just extract the fields as JSON");
  });

  it("still applies non-compression transformers (normalized, dedup) even for json_generation", async () => {
    const optimizer = new DefaultPromptOptimizer();
    const messages = [
      msg("user", "extra    whitespace"),
      msg("user", "extra    whitespace"), // exact duplicate, pre-normalization
    ];
    const result = await optimizer.optimize(messages, generousBudget(), profile("json_generation"));
    expect(result.transformationsApplied).toContain("normalized");
  });
});

describe("DefaultPromptOptimizer.optimize — exact-output preservation where required", () => {
  it("leaves an exact-wording fixture (coding) byte-for-byte identical aside from whitespace normalization", async () => {
    const optimizer = new DefaultPromptOptimizer();
    const exactSnippet = "function add(a, b) { return a + b; } // please do not touch this comment";
    const messages = [msg("user", exactSnippet)];
    const result = await optimizer.optimize(messages, generousBudget(), profile("coding"));
    // normalized still runs (whitespace-only, safe for every profile) but compressed does not,
    // so every content word — including "please", which compressed would otherwise strip — survives.
    expect(result.messages[0]?.content).toBe(exactSnippet);
  });

  it("applies compression for a non-exact-wording profile given the identical fixture", async () => {
    const optimizer = new DefaultPromptOptimizer();
    const exactSnippet = "please just summarize this for me";
    const messages = [msg("user", exactSnippet)];
    const result = await optimizer.optimize(messages, generousBudget(), profile("summarization"));
    expect(result.messages[0]?.content).not.toBe(exactSnippet);
    expect(result.messages[0]?.content).not.toContain("please");
  });
});

describe("DefaultPromptOptimizer.optimize — general behavior", () => {
  it("reports estimatedTokens consistent with estimateTokens on the final messages", async () => {
    const optimizer = new DefaultPromptOptimizer();
    const messages = [msg("user", "hello there")];
    const result = await optimizer.optimize(messages, generousBudget(), profile("summarization"));
    expect(result.estimatedTokens).toBe(estimateTokens(result.messages));
  });

  it("transformationsApplied is empty for an already-canonical, non-redundant, in-budget input on an exact-wording profile", async () => {
    const optimizer = new DefaultPromptOptimizer();
    const messages = [msg("user", "concise input")];
    const result = await optimizer.optimize(messages, generousBudget(), profile("coding"));
    expect(result.transformationsApplied).toEqual([]);
  });
});
