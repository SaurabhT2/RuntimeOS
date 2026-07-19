import type { PromptTransformer } from "../types.js";

/**
 * architecture §34.3: "Detects a repeated/boilerplate system prompt across
 * a multi-turn `messages` array (or across requests, via a short-lived
 * system-prompt cache keyed by hash) and reuses it instead of re-sending/
 * re-tokenizing identical instructions." This implementation covers the
 * within-request case (a `messages` array with more than one identical
 * `role: "system"` entry, keeping only the first) — the cross-request
 * cache variant the same sentence mentions as an alternative requires
 * cross-request state this package deliberately doesn't hold (it is a
 * pure, stateless transformer pipeline, matching every other transformer
 * in this file); a stateful cross-request cache is a documented, not-yet-
 * built enhancement (see this package's README, Deferred Work), the same
 * "designed, not specified, safe default now" stance this codebase takes
 * elsewhere (e.g. `runtime-profiles`' TTL caches).
 */
export const systemPromptDedupedTransformer: PromptTransformer = {
  id: "system_prompt_deduped",
  apply(messages) {
    const seenSystemContent = new Set<string>();
    const result: typeof messages = [];
    for (const message of messages) {
      if (message.role === "system") {
        if (seenSystemContent.has(message.content)) {
          continue;
        }
        seenSystemContent.add(message.content);
      }
      result.push(message);
    }
    return result;
  },
};
