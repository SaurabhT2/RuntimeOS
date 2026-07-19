import type { TaskType } from "@ai-gateway/core-contracts";
import type { CapabilitySet } from "../capability-set.js";

/**
 * The registry's storage seam, mirroring `@ai-gateway/model-registry`'s
 * `ModelStore` (architecture §32.2: "config-driven mapping table, same
 * cache/invalidation pattern as `model-registry`, reused"). A real
 * config/DB-backed implementation is future work, exactly as documented for
 * `ModelStore` — this package ships the interface plus an in-memory
 * implementation now.
 */
export interface CapabilityStore {
  get(task: TaskType): Promise<CapabilitySet | null>;
  upsert(task: TaskType, capabilities: CapabilitySet): Promise<void>;
  list(): Promise<Array<{ task: TaskType; capabilities: CapabilitySet }>>;
  delete(task: TaskType): Promise<boolean>;
}

/** In-process implementation, keyed by `task`. Default store when none is configured. */
export class InMemoryCapabilityStore implements CapabilityStore {
  private readonly mappings = new Map<TaskType, CapabilitySet>();

  constructor(seed: Record<string, CapabilitySet> = {}) {
    for (const [task, capabilities] of Object.entries(seed)) {
      this.mappings.set(task, capabilities);
    }
  }

  get(task: TaskType): Promise<CapabilitySet | null> {
    return Promise.resolve(this.mappings.get(task) ?? null);
  }

  upsert(task: TaskType, capabilities: CapabilitySet): Promise<void> {
    this.mappings.set(task, capabilities);
    return Promise.resolve();
  }

  list(): Promise<Array<{ task: TaskType; capabilities: CapabilitySet }>> {
    return Promise.resolve(
      [...this.mappings.entries()].map(([task, capabilities]) => ({ task, capabilities })),
    );
  }

  delete(task: TaskType): Promise<boolean> {
    return Promise.resolve(this.mappings.delete(task));
  }
}
