import type { ChatMessage, ChatRole } from "@ai-gateway/core-contracts";
import type { RetryPolicy } from "@ai-gateway/reliability";
import {
  REASONING_DEPTH_AFFINITY,
  type CapabilityRequirement,
  type StrategyDecisionLike,
  type StrategySignals,
} from "./types.js";

/**
 * EM-9 (Independent Architecture & Engineering Review of EM-9), Review
 * Finding "StrategyDecision validation": every function in this file reads
 * a `PolicyContext.strategyDecision` (typed as `StrategyDecisionLike` —
 * deliberately loose, ADR-0018) defensively. None of them ever throws: a
 * present-but-malformed field is treated identically to an absent one,
 * falling back to the caller-supplied default. This is a deliberate
 * choice, not an oversight — `PolicyEngine.selectExecutionPlan` is
 * architecture §24's "pure, independently-testable routing function," and
 * a routing function that can be made to fail a live request by a
 * malformed *optional, additive* field would itself be an architecture
 * §3 P6 ("fail predictably, degrade gracefully") violation. Nothing here
 * ever weakens a hard capability/schema/provider/model-class constraint —
 * see `deriveCapabilityRequirement`'s own doc comment for why that is
 * structurally guaranteed rather than merely intended.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isReasoningDepth(value: unknown): value is "shallow" | "moderate" | "deep" {
  return value === "shallow" || value === "moderate" || value === "deep";
}

/**
 * architecture §32.2 → §13.2 step 1/2: builds the `CapabilityRequirement`
 * `queryCandidates` hard-filters by. When `requiredCapabilities` is
 * present and well-formed, its fields **replace** the corresponding
 * `fallback` (ad-hoc `classifyTask(req)`) fields — architecture §32.2:
 * "the Policy Engine ... now queries the Model Registry using this
 * resolved `CapabilitySet` instead of inferring capability needs itself."
 * `creativityAffinity` and `maxCostUsd` have no `CapabilitySet` equivalent
 * (Strategy Layer doesn't resolve either), so those two always come from
 * `fallback` regardless.
 *
 * **Why this can never weaken a hard constraint:** every field this
 * function can change (`requiresJsonMode`, `requiresToolCalling`,
 * `requiresStreaming`, `minContextTokens`) only ever replaces one
 * *ad-hoc, task-name-guessed* value with one *resolved-by-the-Capability-
 * Registry* value for the same concept — both are candidate-filter inputs
 * to the same `queryCandidates` (`candidate-query.ts`), which runs
 * *before* any scoring/ranking `StrategySignals` can influence. There is
 * no path in this file from a *soft* scoring signal into a *hard* filter
 * field — `StrategySignals` (below) and this function read from entirely
 * disjoint parts of `StrategyDecisionLike`.
 */
export function deriveCapabilityRequirement(
  fallback: CapabilityRequirement,
  requiredCapabilities: StrategyDecisionLike["requiredCapabilities"],
): CapabilityRequirement {
  if (!isRecord(requiredCapabilities)) {
    return fallback;
  }

  const result: CapabilityRequirement = { ...fallback };

  if (typeof requiredCapabilities.structuredOutput === "boolean") {
    result.requiresJsonMode = requiredCapabilities.structuredOutput;
  }
  if (typeof requiredCapabilities.toolCalling === "boolean") {
    result.requiresToolCalling = requiredCapabilities.toolCalling;
  }
  if (typeof requiredCapabilities.streamingPreferred === "boolean") {
    result.requiresStreaming = requiredCapabilities.streamingPreferred;
  }
  if (typeof requiredCapabilities.minContextTokens === "number") {
    result.minContextTokens = requiredCapabilities.minContextTokens;
  }
  if (isReasoningDepth(requiredCapabilities.reasoningDepth)) {
    result.reasoningAffinity = REASONING_DEPTH_AFFINITY[requiredCapabilities.reasoningDepth];
  }

  return result;
}

/**
 * architecture §31.2 / §33.2: extracts the three soft scoring nudges
 * `model-scorer.ts` consumes from `executionProfile.preferredModelClasses`
 * and `optimizations.cost`. Returns `{}` (every field absent, i.e. no
 * nudge applied anywhere) when either input is missing or malformed —
 * never partially-trusts a malformed object.
 */
export function deriveStrategySignals(
  executionProfile: StrategyDecisionLike["executionProfile"],
  cost: StrategyDecisionLike["optimizations"]["cost"],
): StrategySignals {
  const signals: StrategySignals = {};

  if (
    isRecord(executionProfile) &&
    Array.isArray(executionProfile.preferredModelClasses) &&
    executionProfile.preferredModelClasses.every((c) => typeof c === "string")
  ) {
    signals.preferredModelClasses = executionProfile.preferredModelClasses as string[];
  }

  if (isRecord(cost)) {
    if (typeof cost.recommendedModelClassDowngrade === "string") {
      signals.recommendedModelClassDowngrade = cost.recommendedModelClassDowngrade;
    }
    if (typeof cost.preferFreeTierProviders === "boolean") {
      signals.preferFreeTierProviders = cost.preferFreeTierProviders;
    }
  }

  return signals;
}

/** `assemblePlan`'s EM-9 inputs: every field optional, `undefined` meaning "no valid signal, use the EM-3/EM-8 default at the call site." */
export interface ExecutionPlanOverrides {
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  retryPolicy?: RetryPolicy;
  streamingDefault?: boolean;
  disableStreaming?: boolean;
}

function isRetryPolicyLike(value: unknown): value is RetryPolicy {
  return (
    isRecord(value) &&
    typeof value.maxAttempts === "number" &&
    typeof value.baseDelayMs === "number" &&
    typeof value.maxDelayMs === "number" &&
    typeof value.jitter === "boolean" &&
    (value.backoff === "exponential" || value.backoff === "linear" || value.backoff === "none") &&
    Array.isArray(value.retryableErrorCodes)
  );
}

/**
 * architecture §31.1 ("applications should never configure inference
 * parameters directly ... resolves `task` to a profile automatically") and
 * §33.2's `disableStreaming` — the Plan Assembly (§13.2 step 5) inputs
 * this milestone activates. An invalid/missing `retryPolicy` yields
 * `undefined` here; the *caller* (`policy-engine.ts`) already has its own
 * `DEFAULT_RETRY_POLICY` fallback for that case, so this function does not
 * need one of its own.
 */
export function deriveExecutionPlanOverrides(
  executionProfile: StrategyDecisionLike["executionProfile"],
  cost: StrategyDecisionLike["optimizations"]["cost"],
): ExecutionPlanOverrides {
  const overrides: ExecutionPlanOverrides = {};

  if (isRecord(executionProfile)) {
    const inference = executionProfile.inference;
    if (isRecord(inference)) {
      if (typeof inference.temperature === "number") {
        overrides.temperature = inference.temperature;
      }
      if (typeof inference.maxOutputTokens === "number") {
        overrides.maxOutputTokens = inference.maxOutputTokens;
      }
    }
    if (typeof executionProfile.timeoutMs === "number") {
      overrides.timeoutMs = executionProfile.timeoutMs;
    }
    if (isRetryPolicyLike(executionProfile.retryPolicy)) {
      overrides.retryPolicy = executionProfile.retryPolicy;
    }
    const streaming = executionProfile.streaming;
    if (isRecord(streaming) && typeof streaming.defaultEnabled === "boolean") {
      overrides.streamingDefault = streaming.defaultEnabled;
    }
  }

  if (isRecord(cost) && typeof cost.disableStreaming === "boolean") {
    overrides.disableStreaming = cost.disableStreaming;
  }

  return overrides;
}

const CHAT_ROLES: ReadonlySet<string> = new Set<ChatRole>(["system", "user", "assistant", "tool"]);

/**
 * architecture §34.5: "The `OptimizedPrompt` becomes part of the
 * `StrategyDecision` ... that ... the Provider Adapter's
 * `NormalizedInvocation.messages` ... are built from." Returns the
 * optimized `messages` array only when well-formed (a non-empty array of
 * `{role, content}` objects, `role` a genuine `ChatRole`); `orchestrator`'s
 * own `buildNormalizedInvocation` already has its own `req`-derived
 * fallback for every other case (absent, empty, or malformed).
 */
export function deriveOptimizedMessages(
  prompt: StrategyDecisionLike["optimizations"]["prompt"],
): ChatMessage[] | undefined {
  if (!isRecord(prompt) || !Array.isArray(prompt.messages) || prompt.messages.length === 0) {
    return undefined;
  }
  const wellFormed = prompt.messages.every(
    (m) => isRecord(m) && typeof m.content === "string" && CHAT_ROLES.has(m.role as string),
  );
  return wellFormed ? (prompt.messages as ChatMessage[]) : undefined;
}
