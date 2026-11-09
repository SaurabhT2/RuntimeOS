import { describe, expect, it } from "vitest";
import {
  assertValidExecutionPlan,
  ExecutionPlanValidationError,
  validateExecutionPlan,
} from "../src/index.js";
import type { AgentTask, ExecutionPlan } from "../src/index.js";

const task = (
  id: string,
  dependencies: readonly string[] = [],
): AgentTask => ({
  id,
  agentId: "research",
  agentVersion: "1.0.0",
  objective: "Complete " + id,
  successCriteria: ["A source-backed result is produced."],
  constraints: [],
  dependencies,
  required: true,
  contextRefs: [],
  evidenceRefs: [],
  requiredCapabilities: ["web.search"],
  budget: {
    maxCostUsd: 1,
    maxInputTokens: 2000,
    maxOutputTokens: 1000,
    timeoutMs: 30000,
    estimatedCostUsd: 0.25,
  },
});

const plan = (tasks: readonly AgentTask[]): ExecutionPlan => ({
  id: "plan-1",
  version: "1.0.0",
  tenantId: "tenant-1",
  workspaceId: "workspace-1",
  requestedBy: "principal-1",
  objective: "Prepare a sourced market-entry recommendation.",
  createdAt: "2026-11-09T10:00:00.000Z",
  limits: {
    maxTasks: 8,
    maxParallelTasks: 2,
    maxDependencyDepth: 4,
    maxTotalCostUsd: 5,
    maxTaskTimeoutMs: 60000,
    maxPlanDurationMs: 180000,
  },
  tasks,
});

describe("validateExecutionPlan", () => {
  it("accepts a tenant-scoped DAG within its declared limits", () => {
    const result = validateExecutionPlan(
      plan([task("research"), task("strategy", ["research"])]),
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.totalEstimatedCostUsd).toBe(0.5);
    expect(result.dependencyDepth).toBe(1);
  });

  it("rejects duplicate task ids and unknown dependencies", () => {
    const result = validateExecutionPlan(
      plan([task("research"), task("research", ["missing"])]),
    );

    expect(result.errors.map((issue) => issue.code)).toContain(
      "TASK_ID_DUPLICATE",
    );
    expect(result.errors.map((issue) => issue.code)).toContain(
      "TASK_DEPENDENCY_UNKNOWN",
    );
  });

  it("rejects cycles and self dependencies", () => {
    const result = validateExecutionPlan(
      plan([task("a", ["b"]), task("b", ["a"]), task("c", ["c"])]),
    );

    expect(result.errors.map((issue) => issue.code)).toContain(
      "PLAN_CYCLE_DETECTED",
    );
    expect(result.errors.map((issue) => issue.code)).toContain(
      "TASK_SELF_DEPENDENCY",
    );
  });

  it("rejects excessive cost, task count and dependency depth", () => {
    const value = plan([
      task("source"),
      task("middle", ["source"]),
      task("final", ["middle"]),
    ]);
    const invalid: ExecutionPlan = {
      ...value,
      limits: {
        ...value.limits,
        maxTasks: 2,
        maxDependencyDepth: 1,
        maxTotalCostUsd: 0.5,
      },
    };

    const result = validateExecutionPlan(invalid);
    expect(result.errors.map((issue) => issue.code)).toContain(
      "MAX_TASKS_EXCEEDED",
    );
    expect(result.errors.map((issue) => issue.code)).toContain(
      "MAX_DEPTH_EXCEEDED",
    );
    expect(result.errors.map((issue) => issue.code)).toContain(
      "PLAN_COST_EXCEEDED",
    );
  });

  it("throws a typed error for an invalid plan", () => {
    expect(() => assertValidExecutionPlan(plan([]))).toThrow(
      ExecutionPlanValidationError,
    );
  });

  it("warns when every task is optional", () => {
    const optional = { ...task("optional"), required: false };
    const result = validateExecutionPlan(plan([optional]));

    expect(result.valid).toBe(true);
    expect(result.warnings[0]?.code).toBe("NO_REQUIRED_TASKS");
  });

  it("rejects malformed identity, timestamps and plan versions", () => {
    const value = plan([task("one")]);
    const invalid = {
      ...value,
      id: "",
      tenantId: "",
      workspaceId: "",
      requestedBy: "",
      objective: "",
      createdAt: "not-a-date",
      version: "2.0.0",
    } as unknown as ExecutionPlan;

    const result = validateExecutionPlan(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "PLAN_ID_REQUIRED",
        "TENANT_REQUIRED",
        "WORKSPACE_REQUIRED",
        "PRINCIPAL_REQUIRED",
        "PLAN_OBJECTIVE_REQUIRED",
        "CREATED_AT_INVALID",
        "PLAN_VERSION_UNSUPPORTED",
      ]),
    );
  });

  it("rejects invalid limits, task timeouts and task budgets", () => {
    const value = plan([task("one")]);
    const invalidTask = {
      ...task("one"),
      budget: {
        maxCostUsd: -1,
        maxInputTokens: -1,
        maxOutputTokens: 0.5,
        timeoutMs: 90000,
        estimatedCostUsd: -1,
      },
    };
    const invalid = {
      ...value,
      tasks: [invalidTask],
      limits: {
        ...value.limits,
        maxParallelTasks: 9,
        maxDependencyDepth: 0,
        maxTaskTimeoutMs: 100,
        maxPlanDurationMs: 0,
        maxTotalCostUsd: -1,
      },
    };

    const result = validateExecutionPlan(invalid);
    expect(result.errors.map((issue) => issue.code)).toContain(
      "PLAN_LIMIT_INVALID",
    );
    expect(result.errors.map((issue) => issue.code)).toContain(
      "PARALLEL_LIMIT_INVALID",
    );
    expect(result.errors.map((issue) => issue.code)).toContain(
      "PLAN_COST_LIMIT_INVALID",
    );
    expect(result.errors.map((issue) => issue.code)).toContain(
      "TASK_BUDGET_INVALID",
    );
    expect(result.errors.map((issue) => issue.code)).toContain(
      "TASK_TIMEOUT_EXCEEDED",
    );
  });

  it("rejects repeated dependencies", () => {
    const result = validateExecutionPlan(
      plan([task("source"), task("consumer", ["source", "source"])]),
    );

    expect(result.errors.map((issue) => issue.code)).toContain(
      "TASK_DEPENDENCY_DUPLICATE",
    );
  });
});
