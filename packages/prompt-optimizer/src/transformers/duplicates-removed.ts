import type { PromptTransformer } from "../types.js";

/**
 * architecture §34.3: "Strips duplicated content blocks within a single
 * request (e.g., accidentally repeated context chunks from an upstream RAG
 * layer — AI Gateway doesn't own RAG per Section 'Philosophy,' but it can
 * defensively dedupe whatever content arrives)." Removes any message whose
 * exact `(role, content)` pair already occurred earlier in the array,
 * keeping the first occurrence and its original position. Runs after
 * `system_prompt_deduped` in the default pipeline, so a duplicated system
 * prompt is already gone by the time this transformer sees the array — this
 * transformer's own scope is any role, covering the RAG-duplication case
 * the architecture names explicitly.
 */
export const duplicatesRemovedTransformer: PromptTransformer = {
  id: "duplicates_removed",
  apply(messages) {
    const seen = new Set<string>();
    const result: typeof messages = [];
    for (const message of messages) {
      const key = `${message.role}\u0000${message.content}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(message);
    }
    return result;
  },
};
