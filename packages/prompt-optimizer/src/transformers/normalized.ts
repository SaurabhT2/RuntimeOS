import type { PromptTransformer } from "../types.js";

/**
 * architecture §34.3: "Whitespace/encoding normalization, consistent role
 * formatting — always runs first so every later transformer sees a
 * canonical shape." Collapses any run of whitespace (spaces, tabs,
 * newlines, carriage returns) into a single space and trims leading/
 * trailing whitespace. Deliberately conservative: it never removes words,
 * only redundant whitespace, so it is always safe regardless of
 * `ResolvedExecutionProfile` (unlike `compressed`, this transformer has no
 * profile-level opt-out — see this package's README).
 */
export const normalizedTransformer: PromptTransformer = {
  id: "normalized",
  apply(messages) {
    return messages.map((message) => ({
      ...message,
      content: message.content.replace(/\s+/g, " ").trim(),
    }));
  },
};
