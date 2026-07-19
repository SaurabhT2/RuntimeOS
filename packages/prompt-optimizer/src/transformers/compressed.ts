import type { PromptTransformer } from "../types.js";

/**
 * architecture §34.3: "Lossy-but-safe compression of verbose input phrasing
 * where the task's `CapabilitySet` tolerates it (never applied to profiles
 * like `coding` or `json_generation` where exact wording may matter)."
 *
 * The profile-level exclusion is enforced by the orchestrating
 * `PromptOptimizer` (`prompt-optimizer.ts`'s `EXACT_WORDING_PROFILE_IDS`),
 * not by this transformer itself — `PromptTransformer.apply` (architecture
 * §34.2) is never given the `ResolvedExecutionProfile`, only the budget, so
 * profile-based exclusion has to happen one level up, in the pipeline
 * orchestration.
 *
 * "Lossy-but-safe" here means: strips common filler/hedging phrases that
 * carry no task-relevant meaning (politeness markers, redundant
 * intensifiers, verbose connective phrasing) without touching any content
 * word, number, identifier, or code-like token. This is deliberately
 * narrow — a small, fixed, reviewable list rather than an open-ended
 * paraphraser, so its output stays predictable and testable.
 */
const FILLER_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bin order to\b/gi, "to"],
  [/\bI would like you to\b/gi, ""],
  [/\bI want you to\b/gi, ""],
  [/\bkindly\b/gi, ""],
  [/\bplease\b/gi, ""],
  [/\bbasically\b/gi, ""],
  [/\bactually\b/gi, ""],
  [/\bjust\b/gi, ""],
  [/\breally\b/gi, ""],
  [/\bvery\b/gi, ""],
];

export const compressedTransformer: PromptTransformer = {
  id: "compressed",
  apply(messages) {
    return messages.map((message) => {
      let content = message.content;
      for (const [pattern, replacement] of FILLER_REPLACEMENTS) {
        content = content.replace(pattern, replacement);
      }
      content = content.replace(/\s+/g, " ").trim();
      return { ...message, content };
    });
  },
};
