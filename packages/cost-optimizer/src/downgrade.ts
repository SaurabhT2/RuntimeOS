import type { CapabilitySet } from "@ai-gateway/capability-registry";
import type { ResolvedExecutionProfile } from "@ai-gateway/execution-profile-registry";

/**
 * architecture §33.2's table row: "short factual extraction rarely needs
 * `deep`." Designed, not specified: below this many estimated input tokens,
 * a `moderate`-reasoning-depth requirement is treated as not actually
 * needing the model's reasoning strength — a short input has little room
 * for the kind of multi-step reasoning `moderate`/`deep` exist to describe.
 * `deep` is never downgraded past this heuristic (see
 * `computeReasoningRequired` below) — this constant only affects the
 * `moderate` case.
 */
const SHORT_INPUT_TOKEN_THRESHOLD = 100;

/**
 * architecture §33.2's table row: "derived from
 * `CapabilitySet.reasoningDepth !== 'shallow'` combined with
 * input-size/complexity heuristics." `deep` always requires reasoning
 * regardless of input size (never underestimate a hard-deep need); `shallow`
 * never does; `moderate` is the one case the size heuristic actually
 * decides.
 */
export function computeReasoningRequired(
  capabilities: CapabilitySet,
  promptTokenEstimate: number,
): boolean {
  if (capabilities.reasoningDepth === "deep") {
    return true;
  }
  if (capabilities.reasoningDepth === "shallow") {
    return false;
  }
  return promptTokenEstimate >= SHORT_INPUT_TOKEN_THRESHOLD;
}

/**
 * architecture §33.2's table row: "computed from `capabilities.reasoningDepth`
 * vs. the profile's default preferred class — if the task's *actual*
 * resolved capability need is shallower than the profile's default
 * assumption, downgrade." Only ever recommends downgrading away from
 * `"complex-reasoning"` (the one class this milestone's seed data — and the
 * architecture's own §33.2 illustrative example — names as the thing to
 * downgrade *from*) down to `"fast-extraction"` (the thing to downgrade
 * *to*), and only when none of the hard-capability gates below say
 * otherwise — architecture §33.3's `DECIDE` node, verbatim: *"it will not
 * downgrade away from a model that supports structured output if
 * `requiredSchema` was set"* is the section's own named example, and this
 * function checks exactly that (plus the symmetric `toolCalling` case) in
 * addition to the `reasoningDepth`/`reasoningRequired` gate.
 *
 * Independent Engineering Review of EM-7, Issue #2 (Major): the first
 * draft of this function checked only `reasoningDepth`, leaving
 * `capabilities.structuredOutput`/`capabilities.toolCalling` unchecked —
 * meaning a task that hard-requires structured output but has a shallow
 * reasoning need would have received a downgrade recommendation in direct
 * contradiction of §33.3's own worked example. Fixed by adding both
 * checks below. This remains a *soft* signal only (architecture §33.2's
 * own table: "consumed as soft signals by Policy Engine scoring... never a
 * hard override") — the actual candidate filtering that enforces hard
 * correctness still happens in the Policy Engine's Candidate Query
 * (architecture §13.2), not in this package — but this package's own
 * output must not actively contradict a hard requirement it already has
 * direct, available knowledge of via `CapabilitySet`, which is what §33.3
 * requires and what this fix restores.
 */
export function computeModelClassDowngrade(
  profile: ResolvedExecutionProfile,
  capabilities: CapabilitySet,
  reasoningRequired: boolean,
): string | undefined {
  const topPreferredClass = profile.preferredModelClasses[0];
  if (topPreferredClass !== "complex-reasoning") {
    return undefined;
  }
  if (reasoningRequired) {
    return undefined;
  }
  if (capabilities.reasoningDepth === "deep") {
    return undefined;
  }
  if (capabilities.structuredOutput) {
    return undefined;
  }
  if (capabilities.toolCalling) {
    return undefined;
  }
  return "fast-extraction";
}
