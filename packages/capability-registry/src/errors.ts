/**
 * Thrown by `resolveCapabilities` when a task has no registered mapping —
 * architecture §19.3's "never-silent-failure principle" applies here just
 * as it does at the adapter boundary: an unmapped task must surface as a
 * clear, typed error a caller can act on (register a mapping) rather than
 * silently falling back to a guessed default that could route a real task
 * to the wrong inference parameters.
 */
export class CapabilityResolutionError extends Error {
  readonly task: string;

  constructor(task: string) {
    super(
      `No capability mapping registered for task "${task}". Register one via ` +
        `CapabilityRegistry.registerMapping() before resolving capabilities for this task.`,
    );
    this.name = "CapabilityResolutionError";
    this.task = task;
  }
}
