import type { CapabilitySet } from "./capability-set.js";

/**
 * Illustrative seed task -> capability mapping, one entry per
 * `core-contracts`' `KNOWN_TASK_TYPES` (architecture §32.2's "config-driven
 * mapping table" — this is that table's seed content, the §32 counterpart
 * to `model-registry`'s `SEED_MODELS` / the Execution Profile Registry's
 * seed profiles). Like both of those, this is seed data an operator can
 * retune via `CapabilityRegistry.registerMapping()`, not compiled logic.
 *
 * Values are designed, not specified — architecture §32 defines the
 * `CapabilitySet` shape but not a seed table — chosen to be the least
 * surprising reading of each task's name:
 * - `knowledge_extraction` / `entity_extraction` / `json_generation`: need
 *   reliable structured output, shallow reasoning is sufficient.
 * - `classification`: shallow, cheap, tiny context need.
 * - `summarization`: benefits from streaming, needs a larger context window
 *   than extraction (it reads long input), no structured output required.
 * - `creative_writing` / `marketing_content`: streaming-friendly, moderate
 *   reasoning, no structured output.
 * - `complex_reasoning`: deep reasoning, tool calling, largest context
 *   floor of the set.
 * - `code_generation`: moderate reasoning, tool calling (for tool-using
 *   coding agents), no structured output requirement by default.
 */
export const SEED_CAPABILITIES: Record<string, CapabilitySet> = {
  knowledge_extraction: {
    structuredOutput: true,
    toolCalling: false,
    reasoningDepth: "shallow",
    streamingPreferred: false,
    minContextTokens: 4_000,
  },
  entity_extraction: {
    structuredOutput: true,
    toolCalling: false,
    reasoningDepth: "shallow",
    streamingPreferred: false,
    minContextTokens: 2_000,
  },
  classification: {
    structuredOutput: true,
    toolCalling: false,
    reasoningDepth: "shallow",
    streamingPreferred: false,
    minContextTokens: 1_000,
  },
  summarization: {
    structuredOutput: false,
    toolCalling: false,
    reasoningDepth: "shallow",
    streamingPreferred: true,
    minContextTokens: 8_000,
  },
  json_generation: {
    structuredOutput: true,
    toolCalling: false,
    reasoningDepth: "shallow",
    streamingPreferred: false,
    minContextTokens: 2_000,
  },
  creative_writing: {
    structuredOutput: false,
    toolCalling: false,
    reasoningDepth: "moderate",
    streamingPreferred: true,
    minContextTokens: 4_000,
  },
  complex_reasoning: {
    structuredOutput: false,
    toolCalling: true,
    reasoningDepth: "deep",
    streamingPreferred: true,
    minContextTokens: 16_000,
  },
  marketing_content: {
    structuredOutput: false,
    toolCalling: false,
    reasoningDepth: "moderate",
    streamingPreferred: true,
    minContextTokens: 4_000,
  },
  code_generation: {
    structuredOutput: false,
    toolCalling: true,
    reasoningDepth: "moderate",
    streamingPreferred: false,
    minContextTokens: 8_000,
  },
};
