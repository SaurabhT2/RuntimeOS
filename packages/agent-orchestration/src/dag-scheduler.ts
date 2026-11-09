import { assertValidExecutionPlan } from "./plan-validation.js";
import type {
  AgentTask,
  ExecutionPlan,
  ExecutionTaskState,
} from "./plan-contract.js";

const FAILED_DEPENDENCY_STATES = new Set<ExecutionTaskState>([
  "failed",
  "skipped",
  "cancelled",
]);

export function getExecutionWaves(
  plan: ExecutionPlan,
): readonly (readonly string[])[] {
  assertValidExecutionPlan(plan);

  const remaining = new Set(plan.tasks.map((task) => task.id));
  const completed = new Set<string>();
  const tasksById = new Map(plan.tasks.map((task) => [task.id, task]));
  const waves: string[][] = [];

  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((taskId) => {
        const task = tasksById.get(taskId)!;
        return task.dependencies.every((dependencyId) =>
          completed.has(dependencyId),
        );
      })
      .sort();

    if (ready.length === 0) {
      throw new Error(
        "Validated execution plan unexpectedly contains a dependency cycle.",
      );
    }

    for (
      let index = 0;
      index < ready.length;
      index += plan.limits.maxParallelTasks
    ) {
      const wave = ready.slice(index, index + plan.limits.maxParallelTasks);
      waves.push(wave);
      for (const taskId of wave) {
        remaining.delete(taskId);
        completed.add(taskId);
      }
    }
  }

  return waves;
}

export function getReadyTasks(
  plan: ExecutionPlan,
  states: Readonly<Record<string, ExecutionTaskState>>,
): readonly AgentTask[] {
  assertValidExecutionPlan(plan);

  const runningCount = plan.tasks.filter(
    (task) => states[task.id] === "running",
  ).length;
  const availableSlots = Math.max(
    0,
    plan.limits.maxParallelTasks - runningCount,
  );
  if (availableSlots === 0) return [];

  return plan.tasks
    .filter(
      (task) =>
        (states[task.id] ?? "pending") === "pending" &&
        task.dependencies.every(
          (dependencyId) => states[dependencyId] === "succeeded",
        ),
    )
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, availableSlots);
}

export function getBlockedTaskIds(
  plan: ExecutionPlan,
  states: Readonly<Record<string, ExecutionTaskState>>,
): readonly string[] {
  assertValidExecutionPlan(plan);

  return plan.tasks
    .filter(
      (task) =>
        (states[task.id] ?? "pending") === "pending" &&
        task.dependencies.some((dependencyId) =>
          FAILED_DEPENDENCY_STATES.has(states[dependencyId] ?? "pending"),
        ),
    )
    .map((task) => task.id)
    .sort();
}
