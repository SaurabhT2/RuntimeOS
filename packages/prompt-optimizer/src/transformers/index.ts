import type { PromptTransformer } from "../types.js";
import { compressedTransformer } from "./compressed.js";
import { contextTrimmedTransformer } from "./context-trimmed.js";
import { duplicatesRemovedTransformer } from "./duplicates-removed.js";
import { longContextWindowedTransformer } from "./long-context-windowed.js";
import { normalizedTransformer } from "./normalized.js";
import { systemPromptDedupedTransformer } from "./system-prompt-deduped.js";

export {
  normalizedTransformer,
  systemPromptDedupedTransformer,
  duplicatesRemovedTransformer,
  contextTrimmedTransformer,
  longContextWindowedTransformer,
  compressedTransformer,
};

/**
 * architecture §34.3's pipeline table, in table order: `normalized` always
 * first ("so every later transformer sees a canonical shape"), `compressed`
 * last (operates on already-deduped, already-trimmed content).
 */
export const DEFAULT_TRANSFORMER_PIPELINE: readonly PromptTransformer[] = [
  normalizedTransformer,
  systemPromptDedupedTransformer,
  duplicatesRemovedTransformer,
  contextTrimmedTransformer,
  longContextWindowedTransformer,
  compressedTransformer,
];
