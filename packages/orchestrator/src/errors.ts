import { GatewayError, type GatewayErrorCode } from "@ai-gateway/core-contracts";

/**
 * ## Failover eligibility (engineering decision — see this package's
 * README, Engineering Decisions, for the full writeup)
 *
 * architecture §17's lifecycle diagram literally gates the retry→fallback
 * path (`M{Retries remaining?} -- no --> N{Fallback available?}`) behind
 * *retryable* failures only, with a separate `J -- no, non-retryable -->
 * Z6` edge that terminates immediately. Read maximally literally, "is this
 * candidate's failure eligible for fallback" would mean "is
 * `error.code` a member of `candidate.retryPolicy.retryableErrorCodes`"
 * (`["RATE_LIMITED", "TIMEOUT"]` by default — `reliability`'s
 * `DEFAULT_RETRY_POLICY`).
 *
 * That literal reading fails the Engineering Blueprint's own EM-4
 * acceptance criterion: a real provider whose network is simply
 * unreachable has every one of its adapter-boundary translations land on
 * `INTERNAL_ERROR` (architecture §19.2 — `GroqAdapter`'s and
 * `NimAdapter`'s own test suites assert this explicitly: "never lets a raw
 * network exception escape" maps to `INTERNAL_ERROR`, not `TIMEOUT`) —
 * which is *not* in the default retryable set, so the literal reading
 * would make a fully-down provider a `Z6` terminal failure with no
 * fallback attempt at all. That directly contradicts the Blueprint's "a
 * chaos test injecting Groq failures to verify automatic failover"
 * requirement (`tools/orchestrator-integration-tests/test/chaos-failover.test.ts`
 * exercises exactly this scenario).
 *
 * Resolution: failover eligibility is *not* "is this the same set of codes
 * this candidate's own `RetryEngine` would have retried" — it is "is
 * trying a *different* provider plausibly going to help". A small,
 * explicit blocklist of codes where the answer is clearly no (the failure
 * is about the request or the caller, not about which provider handled
 * it) is therefore used instead of the retry policy's allowlist. Every
 * other code — including `INTERNAL_ERROR`, `RATE_LIMITED`, `TIMEOUT`,
 * `CREDENTIAL_INVALID` raised *by an adapter itself* (as opposed to by
 * `credential-resolver`, which is handled separately and is always
 * terminal — see `orchestrator.ts`'s `resolveCandidate`) — advances to the
 * next plan once this candidate's own retry budget is exhausted.
 */
const NON_FAILOVER_CODES: ReadonlySet<GatewayErrorCode> = new Set([
  // Content policy: the input itself was filtered — a different provider
  // executing the same normalized content is not meaningfully more likely
  // to produce a different policy outcome (architecture §19.1: "passed
  // through as a typed, non-retryable result").
  "CONTENT_FILTERED",
  // The request itself is structurally invalid, or names a task the
  // gateway does not classify — neither is fixed by trying a different
  // provider with the same malformed/unclassifiable input.
  "INVALID_SCHEMA",
  "INVALID_TASK",
  // The caller withdrew the request — continuing to try other providers
  // after a cancellation would do work nobody wants the result of.
  "CANCELLED",
]);

/** See {@link NON_FAILOVER_CODES}'s doc comment for the full reasoning. */
export function isFailoverEligible(code: GatewayErrorCode): boolean {
  return !NON_FAILOVER_CODES.has(code);
}

/**
 * `GatewayError("ALL_PROVIDERS_UNAVAILABLE", ...)` for a `providerId` no
 * `ProviderAdapterRegistry` has an adapter registered for. Deliberately the
 * same code the failover loop (`orchestrator.ts`) uses when every plan in
 * an `ExecutionPlan`'s chain has been exhausted — from a caller's
 * perspective, "we don't have an adapter for this provider" and "every
 * adapter we tried failed" are both instances of "this request cannot be
 * served by any provider we know about right now" (architecture §19.1's
 * `ALL_PROVIDERS_UNAVAILABLE` row: "systemic failure... already exhausted
 * retries/failover").
 */
export function providerUnavailable(providerId: string): GatewayError {
  return new GatewayError(
    "ALL_PROVIDERS_UNAVAILABLE",
    `No provider adapter is registered for providerId "${providerId}".`,
    false,
    { providerId },
  );
}

/**
 * Thrown once every plan in an `ExecutionPlan`'s primary+fallback chain has
 * been attempted and failed (architecture §17's `Z5`/`N -- no --> Z5`
 * terminal node). `attempts` records, per plan tried, the `providerId` and
 * the `GatewayErrorCode` of the failure that eliminated it — kept in
 * `details` (never in the message text) so the trace/log has full
 * diagnostic detail (architecture §19.3) while the message stays a stable,
 * generic sentence.
 */
export function allProvidersUnavailable(
  attempts: Array<{ providerId: string; code: GatewayErrorCode; message: string }>,
): GatewayError {
  return new GatewayError(
    "ALL_PROVIDERS_UNAVAILABLE",
    `All ${attempts.length} candidate provider(s) failed; no further fallback plans remain.`,
    false,
    { attempts },
  );
}
