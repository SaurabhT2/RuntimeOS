import type { AgentTask, ExecutionPlan } from "./plan-contract.js";

export interface PlanValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly taskId?: string;
}

export interface PlanValidationResult {
  readonly valid: boolean;
  readonly errors: readonly PlanValidationIssue[];
  readonly warnings: readonly PlanValidationIssue[];
  readonly totalEstimatedCostUsd: number;
  readonly dependencyDepth: number;
}

export class ExecutionPlanValidationError extends Error {
  readonly issues: readonly PlanValidationIssue[];

  constructor(issues: readonly PlanValidationIssue[]) {
    super(issues.map((issue) => issue.message).join("; "));
    this.name = "ExecutionPlanValidationError";
    this.issues = issues;
  }
}

function isNonEmpty(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function taskDepth(
  task: AgentTask,
  byId: ReadonlyMap<string, AgentTask>,
  memo: Map<string, number>,
): number {
  const cached = memo.get(task.id);
  if (cached !== undefined) return cached;

  const depth =
    task.dependencies.length === 0
      ? 0
      : 1 +
        Math.max(
          ...task.dependencies.map((dependencyId) => {
            const dependency = byId.get(dependencyId);
            return dependency ? taskDepth(dependency, byId, memo) : 0;
          }),
        );

  memo.set(task.id, depth);
  return depth;
}

function findCycle(byId: ReadonlyMap<string, AgentTask>): string[] | undefined {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (taskId: string): string[] | undefined => {
    if (visiting.has(taskId)) {
      const start = stack.indexOf(taskId);
      return [...stack.slice(start), taskId];
    }
    if (visited.has(taskId)) return undefined;

    visiting.add(taskId);
    stack.push(taskId);

    const task = byId.get(taskId);
    for (const dependencyId of task?.dependencies ?? []) {
      if (!byId.has(dependencyId)) continue;
      const cycle = visit(dependencyId);
      if (cycle) return cycle;
    }

    stack.pop();
    visiting.delete(taskId);
    visited.add(taskId);
    return undefined;
  };

  for (const taskId of byId.keys()) {
    const cycle = visit(taskId);
    if (cycle) return cycle;
  }
  return undefined;
}

function validateTask(task: AgentTask): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = [];
  const add = (code: string, message: string) =>
    issues.push({ code, message, taskId: task.id });

  if (!isNonEmpty(task.id)) add("TASK_ID_REQUIRED", "Task id is required.");
  if (!isNonEmpty(task.agentId)) add("AGENT_ID_REQUIRED", "Agent id is required.");
  if (!/^\d+\.\d+\.\d+$/.test(task.agentVersion)) {
    add("AGENT_VERSION_INVALID", "Agent version must use semantic versioning.");
  }
  if (!isNonEmpty(task.objective)) add("TASK_OBJECTIVE_REQUIRED", "Task objective is required.");
  if (
    task.successCriteria.length === 0 ||
    task.successCriteria.some((item) => !isNonEmpty(item))
  ) {
    add("SUCCESS_CRITERIA_REQUIRED", "At least one non-empty success criterion is required.");
  }
  if (
    task.contextRefs.some((ref) => !isNonEmpty(ref)) ||
    task.evidenceRefs.some((ref) => !isNonEmpty(ref)) ||
    task.constraints.some((constraint) => !isNonEmpty(constraint)) ||
    task.requiredCapabilities.some((capability) => !isNonEmpty(capability))
  ) {
    add("TASK_REFERENCES_INVALID", "Task references, constraints and capabilities must be non-empty strings.");
  }

  const budget = task.budget;
  if (
    !budget ||
    !isFiniteNonNegative(budget.maxCostUsd) ||
    !Number.isInteger(budget.maxInputTokens) ||
    budget.maxInputTokens < 0 ||
    !Number.isInteger(budget.maxOutputTokens) ||
    budget.maxOutputTokens < 0 ||
    !Number.isInteger(budget.timeoutMs) ||
    budget.timeoutMs <= 0 ||
    (budget.estimatedCostUsd !== undefined &&
      !isFiniteNonNegative(budget.estimatedCostUsd))
  ) {
    add("TASK_BUDGET_INVALID", "Task budget contains invalid limits or estimates.");
  }

  return issues;
}

export function validateExecutionPlan(
  plan: ExecutionPlan,
): PlanValidationResult {
  const errors: PlanValidationIssue[] = [];
  const warnings: PlanValidationIssue[] = [];

  if (!isNonEmpty(plan.id)) errors.push({ code: "PLAN_ID_REQUIRED", message: "Plan id is required." });
  if (!isNonEmpty(plan.tenantId)) errors.push({ code: "TENANT_REQUIRED", message: "Tenant id is required." });
  if (!isNonEmpty(plan.workspaceId)) errors.push({ code: "WORKSPACE_REQUIRED", message: "Workspace id is required." });
  if (!isNonEmpty(plan.requestedBy)) errors.push({ code: "PRINCIPAL_REQUIRED", message: "Requesting principal is required." });
  if (!isNonEmpty(plan.objective)) errors.push({ code: "PLAN_OBJECTIVE_REQUIRED", message: "Plan objective is required." });
  if (Number.isNaN(Date.parse(plan.createdAt))) {
    errors.push({ code: "CREATED_AT_INVALID", message: "Plan creation time must be an ISO-compatible timestamp." });
  }
  if (plan.version !== "1.0.0") {
    errors.push({ code: "PLAN_VERSION_UNSUPPORTED", message: "Only execution plan version 1.0.0 is supported." });
  }

  const limits = plan.limits;
  const positiveIntegerLimits = [
    ["maxTasks", limits.maxTasks],
    ["maxParallelTasks", limits.maxParallelTasks],
    ["maxDependencyDepth", limits.maxDependencyDepth],
    ["maxTaskTimeoutMs", limits.maxTaskTimeoutMs],
    ["maxPlanDurationMs", limits.maxPlanDurationMs],
  ] as const;

  for (const [name, value] of positiveIntegerLimits) {
    if (!Number.isInteger(value) || value <= 0) {
      errors.push({
        code: "PLAN_LIMIT_INVALID",
        message: "Plan limit " + name + " must be a positive integer.",
      });
    }
  }
  if (!isFiniteNonNegative(limits.maxTotalCostUsd)) {
    errors.push({ code: "PLAN_COST_LIMIT_INVALID", message: "Maximum plan cost must be finite and non-negative." });
  }
  if (
    Number.isInteger(limits.maxTasks) &&
    plan.tasks.length > limits.maxTasks
  ) {
    errors.push({ code: "MAX_TASKS_EXCEEDED", message: "Plan exceeds its maximum task count." });
  }
  if (
    Number.isInteger(limits.maxParallelTasks) &&
    limits.maxParallelTasks > limits.maxTasks
  ) {
    errors.push({ code: "PARALLEL_LIMIT_INVALID", message: "Maximum parallel tasks cannot exceed maximum tasks." });
  }
  if (plan.tasks.length === 0) {
    errors.push({ code: "PLAN_EMPTY", message: "Execution plan must contain at least one task." });
  }

  const byId = new Map<string, AgentTask>();
  for (const task of plan.tasks) {
    errors.push(...validateTask(task));
    if (byId.has(task.id)) {
      errors.push({
        code: "TASK_ID_DUPLICATE",
        message: "Duplicate task id: " + task.id + ".",
        taskId: task.id,
      });
    } else {
      byId.set(task.id, task);
    }
  }

  for (const task of plan.tasks) {
    const seenDependencies = new Set<string>();
    for (const dependencyId of task.dependencies) {
      if (dependencyId === task.id) {
        errors.push({
          code: "TASK_SELF_DEPENDENCY",
          message: "A task cannot depend on itself.",
          taskId: task.id,
        });
      }
      if (seenDependencies.has(dependencyId)) {
        errors.push({
          code: "TASK_DEPENDENCY_DUPLICATE",
          message: "Duplicate dependency: " + dependencyId + ".",
          taskId: task.id,
        });
      }
      seenDependencies.add(dependencyId);
      if (!byId.has(dependencyId)) {
        errors.push({
          code: "TASK_DEPENDENCY_UNKNOWN",
          message: "Unknown dependency: " + dependencyId + ".",
          taskId: task.id,
        });
      }
    }
    if (task.budget.timeoutMs > limits.maxTaskTimeoutMs) {
      errors.push({
        code: "TASK_TIMEOUT_EXCEEDED",
        message: "Task timeout exceeds the plan maximum task timeout.",
        taskId: task.id,
      });
    }
  }

  const cycle = findCycle(byId);
  if (cycle) {
    errors.push({
      code: "PLAN_CYCLE_DETECTED",
      message: "Dependency cycle detected: " + cycle.join(" -> ") + ".",
    });
  }

  const memo = new Map<string, number>();
  let dependencyDepth = 0;
  if (!cycle) {
    for (const task of byId.values()) {
      dependencyDepth = Math.max(dependencyDepth, taskDepth(task, byId, memo));
    }
    if (dependencyDepth > limits.maxDependencyDepth) {
      errors.push({
        code: "MAX_DEPTH_EXCEEDED",
        message: "Plan exceeds its maximum dependency depth.",
      });
    }
  }

  const totalEstimatedCostUsd = plan.tasks.reduce(
    (total, task) => total + (task.budget?.estimatedCostUsd ?? 0),
    0,
  );
  if (totalEstimatedCostUsd > limits.maxTotalCostUsd) {
    errors.push({
      code: "PLAN_COST_EXCEEDED",
      message: "Estimated task cost exceeds the plan cost limit.",
    });
  }
  if (plan.tasks.every((task) => !task.required)) {
    warnings.push({
      code: "NO_REQUIRED_TASKS",
      message: "All tasks are optional; the plan may complete without a required result.",
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    totalEstimatedCostUsd,
    dependencyDepth,
  };
}

export function assertValidExecutionPlan(plan: ExecutionPlan): void {
  const result = validateExecutionPlan(plan);
  if (!result.valid) throw new ExecutionPlanValidationError(result.errors);
}
