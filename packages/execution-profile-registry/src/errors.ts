/**
 * Thrown by `resolveProfile` when neither an explicit override profile ID
 * nor the task's own task->profile mapping resolves to a registered
 * profile — the same never-silent-failure rationale as
 * `capability-registry`'s `CapabilityResolutionError` (architecture §19.3).
 */
export class ExecutionProfileResolutionError extends Error {
  readonly requested: string;

  constructor(requested: string, reason: "unmapped_task" | "unknown_profile_id") {
    const detail =
      reason === "unmapped_task"
        ? `task "${requested}" has no entry in the task->profile mapping and no override was given`
        : `profile id "${requested}" has no registered ExecutionProfile`;
    super(
      `Could not resolve an ExecutionProfile: ${detail}. Register one via ` +
        `ExecutionProfileRegistry.upsertProfile() or ExecutionProfileRegistry.registerTaskMapping().`,
    );
    this.name = "ExecutionProfileResolutionError";
    this.requested = requested;
  }
}
