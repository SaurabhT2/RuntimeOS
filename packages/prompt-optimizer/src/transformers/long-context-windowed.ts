import type { PromptTransformer } from "../types.js";

/**
 * architecture §34.3: "For very large inputs, applies a sliding-window or
 * hierarchical-summarization strategy rather than a hard truncation." This
 * is a distinct concern from `context_trimmed`: that transformer drops
 * whole *messages* to fit a token budget; this one windows the *content of
 * a single very-long message* that would dominate the budget on its own
 * (e.g. a large pasted document) — a hard truncation would silently lose
 * whatever came after the cut point, whereas a head+tail window preserves
 * the framing (start) and the most recent/conclusive content (end) with an
 * explicit, visible marker showing where content was omitted.
 *
 * Designed, not specified: the exact character threshold and head/tail
 * split ratios below aren't named by the architecture. `VERY_LARGE_...`
 * is set well above ordinary conversational message sizes specifically so
 * this transformer only fires for the "very large inputs" case §34.3
 * names, leaving ordinary-sized messages to `context_trimmed`/`compressed`.
 */
const VERY_LARGE_MESSAGE_CHAR_THRESHOLD = 20_000;
const HEAD_FRACTION = 0.2;
const TAIL_FRACTION = 0.6;
const WINDOW_MARKER = "\n\n[... content omitted by long_context_windowed ...]\n\n";

export const longContextWindowedTransformer: PromptTransformer = {
  id: "long_context_windowed",
  apply(messages) {
    return messages.map((message) => {
      if (message.content.length <= VERY_LARGE_MESSAGE_CHAR_THRESHOLD) {
        return message;
      }
      const headLength = Math.floor(message.content.length * HEAD_FRACTION);
      const tailLength = Math.floor(message.content.length * TAIL_FRACTION);
      const head = message.content.slice(0, headLength);
      const tail = message.content.slice(message.content.length - tailLength);
      return { ...message, content: `${head}${WINDOW_MARKER}${tail}` };
    });
  },
};
