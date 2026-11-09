import { describe, expect, it } from "vitest";
import { getBlockedTaskIds, getExecutionWaves, getReadyTasks } from "../src/index.js";
import type { AgentTask, ExecutionPlan, ExecutionTaskState } from "../src/index.js";

const makeTask = (id: string, dependencies: readonly string[] = []): AgentTask => ({
  id,
  agentId: "research",
  agentVersion: "1.0.0",
  objective: "Complete " + id,
  successCriteria: ["A result is produced."],
  constraints: [],
  dependencies,
  required: true,
  contextRefs: [],
  evidenceRefs: [],
  requiredCapabilities: ["web.search"],
  budget: {
    maxCostUsd: 1,
    maxInputTokens: 1000,
    maxOutputTokens: 500,
    timeoutMs: 20000,
  },
});

const makePlan = (tasks: readonly AgentTask[]): ExecutionPlan => ({
  id: "plan-dag",
  version: "1.0.0",
  tenantId: "tenant-a",
  workspaceId: "workspace-a",
  requestedBy: "user-a",
  objective: "Build a recommendation.",
  createdAt: "2026-11-09T10:00:00.000Z",
  limits: {
    maxTasks: 10,
    maxParallelTasks: 2,
    maxDependencyDepth: 5,
    maxTotalCostUsd: 10,
    maxTaskTimeoutMs: 60000,
    maxPlanDurationMs: 120000,
  },
  tasks,
});

describe("DAG scheduling helpers", () => {
  it("creates deterministic topological waves and respects parallelism", () => {
    const value = makePlan([
      makeTask("synthesis", ["research", "strategy"]),
      makeTask("strategy", ["research"]),
      makeTask("research"),
      makeTask("extra"),
    ]);

    expect(getExecutionWaves(value)).toEqual([["extra", "research"], ["strategy"], ["synthesis"]]);
  });

  it("returns only tasks whose dependencies succeeded", () => {
    const value = makePlan([
      makeTask("research"),
      makeTask("market", ["research"]),
      makeTask("strategy"),
    ]);

    expect(
      getReadyTasks(value, {
        research: "succeeded",
        strategy: "pending",
      }).map((item) => item.id),
    ).toEqual(["market", "strategy"]);
  });

  it("caps ready work by remaining parallel slots", () => {
    const value = makePlan([makeTask("a"), makeTask("b"), makeTask("c")]);
    const states: Record<string, ExecutionTaskState> = {
      a: "running",
      b: "pending",
      c: "pending",
    };

    expect(getReadyTasks(value, states).map((item) => item.id)).toEqual(["b"]);
  });

  it("does not schedule work after a failed dependency", () => {
    const value = makePlan([
      makeTask("research"),
      makeTask("strategy", ["research"]),
      makeTask("synthesis", ["strategy"]),
    ]);
    const states: Record<string, ExecutionTaskState> = {
      research: "failed",
    };

    expect(getBlockedTaskIds(value, states)).toEqual(["strategy"]);
    expect(getReadyTasks(value, states)).toEqual([]);
  });

  it("returns no work when all concurrency slots are occupied", () => {
    const value = makePlan([makeTask("a"), makeTask("b")]);
    const states: Record<string, ExecutionTaskState> = {
      a: "running",
      b: "running",
    };

    expect(getReadyTasks(value, states)).toEqual([]);
  });
});
