/**
 * architecture §36.2, verbatim shape, with two locally-narrowed fields —
 * this package's Blueprint §4.1 dependency edges are `telemetry`,
 * `policy-engine` only, neither of which re-exports `core-contracts`'
 * `TaskType`/`reliability`'s `FailureReason`:
 *
 * - `task` is a plain `string` rather than `core-contracts`' `TaskType`.
 *   `TaskType` is itself defined as `KnownTaskType | (string & {})` — i.e.
 *   structurally a plain extensible string — so nothing is lost.
 * - `failureReason` is a small local shape (`{ code, message? }`) rather
 *   than importing `reliability`'s `FailureReason` (which itself types
 *   `code` as `core-contracts`' `GatewayErrorCode` enum) — same
 *   dependency-edge constraint, narrowed to `code: string` rather than
 *   re-declaring the whole `GatewayErrorCode` union here for a field nothing
 *   in this package's own logic branches on.
 *
 * Independent Engineering Review of EM-7, Issue #4 (Minor): this package's
 * declared `telemetry` edge (Blueprint §4.1) is not imported anywhere in
 * `src/` or `test/` today. It is deliberately kept rather than removed:
 * `ExecutionOutcome.record()` is architecture §36.2's fire-and-forget
 * signal-collection seam, and the shipped default
 * (`NoopLearningSignalCollector`) does nothing with it — but any real,
 * non-default `LearningSignalCollector` a deployment registers (e.g. one
 * that forwards outcomes to a metrics backend) is the expected, concrete
 * future consumer of this edge, and this package is where a caller would
 * naturally look for it. This mirrors `execution-profile-registry`'s own
 * precedent (EM-6 review, Dependency Compliance Report) of declaring an
 * edge a package doesn't import directly today because its purpose is
 * forward-looking, not because it was left over.
 */
export interface ExecutionOutcome {
  requestId: string;
  providerId: string;
  modelId: string;
  modelClass: string;
  task: string;
  latencyMs: number;
  success: boolean;
  failureReason?: { code: string; message?: string };
  costUsd: number;
  /** Optional, only if the calling application chooses to report it back — never inferred or scraped. */
  userFeedbackSignal?: "positive" | "negative" | "neutral";
}

/** architecture §36.2, verbatim. */
export interface LearningSignalCollector {
  /** Fire-and-forget, never blocks the response path (architecture §22). */
  record(outcome: ExecutionOutcome): void;
}

/**
 * architecture §36.2, verbatim: "Default, shipped implementation: does
 * nothing." This is the shipped default (architecture §36.1: "a
 * static/no-op default so the system's behavior today is fully
 * deterministic and auditable") — see `test/learning-signal-collector.test.ts`
 * for the verification that `record` truly has zero observable effect.
 */
export class NoopLearningSignalCollector implements LearningSignalCollector {
  record(): void {
    // intentionally empty — architecture §36.2, verbatim.
  }
}
