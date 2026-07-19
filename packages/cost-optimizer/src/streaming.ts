import type { CapabilitySet } from "@ai-gateway/capability-registry";
import type { ResolvedExecutionProfile } from "@ai-gateway/execution-profile-registry";

/**
 * architecture §33.2's table row: "e.g. short, non-interactive outputs
 * don't benefit from streaming overhead." Designed, not specified: an
 * output-token ceiling below which streaming's incremental-delivery benefit
 * is judged not worth its overhead, mirroring `SHORT_INPUT_TOKEN_THRESHOLD`
 * in `downgrade.ts`'s role for the reasoning heuristic.
 */
const SHORT_OUTPUT_TOKEN_THRESHOLD = 256;

/**
 * Returns `true` only when there is something to actually disable (the
 * profile defaults streaming on) and disabling it is safe: the resolved
 * `CapabilitySet` doesn't itself prefer streaming (`streamingPreferred`),
 * and the profile's own `maxOutputTokens` ceiling is short enough that
 * streaming's latency benefit is unlikely to matter. Returns `undefined`
 * (not `false`) when there is nothing to recommend either way, matching
 * `CostOptimizationResult.disableStreaming`'s optional-field shape
 * (architecture §33.2) — the field is only present when this package has
 * an actual recommendation to make.
 */
export function computeDisableStreaming(
  profile: ResolvedExecutionProfile,
  capabilities: CapabilitySet,
): boolean | undefined {
  if (!profile.streaming.defaultEnabled) {
    return undefined;
  }
  if (capabilities.streamingPreferred) {
    return undefined;
  }
  if (profile.inference.maxOutputTokens > SHORT_OUTPUT_TOKEN_THRESHOLD) {
    return undefined;
  }
  return true;
}
