import { z } from "zod";
import { REASONING_DEPTHS } from "@ai-gateway/model-registry";

/**
 * architecture §32.2, verbatim shape. What a task *requires*, expressed
 * entirely independently of any specific model or provider (architecture
 * §32.1/ADR-009) — the Model Registry (architecture §14, unchanged) is the
 * other half of the match: it describes what a model *has*. The two meet
 * only at the Policy Engine's Candidate Query step (architecture §13.2,
 * §32.3), never inside this package.
 */
export interface CapabilitySet {
  structuredOutput: boolean;
  toolCalling: boolean;
  reasoningDepth: (typeof REASONING_DEPTHS)[number];
  streamingPreferred: boolean;
  minContextTokens: number;
  /** future — architecture §32.2, §42.2. */
  visionInput?: boolean;
  /** future — architecture §32.2, §42.2. */
  audioInput?: boolean;
}

/**
 * `reasoningDepth` reuses `@ai-gateway/model-registry`'s `REASONING_DEPTHS`
 * constant (rather than redeclaring `["shallow", "moderate", "deep"]` here)
 * so the two registries can never drift onto incompatible vocabularies —
 * this is the concrete, minimal expression of Blueprint §8.14's "read-only,
 * for cross-checking capability vocabulary" dependency on `model-registry`.
 * `capability-registry` does not otherwise query `model-registry` at
 * runtime: matching a `CapabilitySet` against real `ModelDescriptor`s stays
 * the Policy Engine's job (architecture §13.2, ADR-009) so that a new
 * generation of models never requires a `capability-registry` change and
 * vice versa.
 */
export const capabilitySetSchema: z.ZodType<CapabilitySet> = z.object({
  structuredOutput: z.boolean(),
  toolCalling: z.boolean(),
  reasoningDepth: z.enum(REASONING_DEPTHS),
  streamingPreferred: z.boolean(),
  minContextTokens: z.number().int().nonnegative(),
  visionInput: z.boolean().optional(),
  audioInput: z.boolean().optional(),
});
