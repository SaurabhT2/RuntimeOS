/**
 * Declarative execution-plan contracts for specialist-agent collaboration.
 *
 * A plan describes bounded work and dependencies. It is not an authorization
 * grant, tool credential, or executable runtime by itself.
 */

export type ExecutionTaskState =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "cancelled";

export type ExecutionPlanStatus =
  | "planned"
  | "running"
  | "completed"
  | "completed_with_errors"
  | "failed"
  | "cancelled";

export interface TaskBudget {
  readonly maxCostUsd: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  readonly estimatedCostUsd?: number;
}

export interface ExecutionLimits {
  readonly maxTasks: number;
  readonly maxParallelTasks: number;
  readonly maxDependencyDepth: number;
  readonly maxTotalCostUsd: number;
  readonly maxTaskTimeoutMs: number;
  readonly maxPlanDurationMs: number;
}

export interface AgentTask {
  readonly id: string;
  readonly agentId: string;
  readonly agentVersion: string;
  readonly objective: string;
  readonly successCriteria: readonly string[];
  readonly constraints: readonly string[];
  readonly dependencies: readonly string[];
  /** Optional tasks may fail without failing the overall plan. */
  readonly required: boolean;
  readonly contextRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  /** Capability names to be resolved and authorized by the Control Plane. */
  readonly requiredCapabilities: readonly string[];
  readonly budget: TaskBudget;
}

export interface ExecutionPlan {
  readonly id: string;
  readonly version: "1.0.0";
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly requestedBy: string;
  readonly objective: string;
  readonly createdAt: string;
  readonly limits: ExecutionLimits;
  readonly tasks: readonly AgentTask[];
}

export interface ExecutionTraceContext {
  readonly traceId: string;
  readonly correlationId: string;
  readonly parentSpanId?: string;
}

export interface DependencyOutputRef {
  readonly taskId: string;
  /** Opaque, tenant-scoped reference to a bounded predecessor output. */
  readonly outputRef: string;
}

export interface AgentTaskEnvelope {
  readonly taskId: string;
  readonly planId: string;
  readonly runId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalId: string;
  readonly agentId: string;
  readonly agentVersion: string;
  readonly objective: string;
  readonly successCriteria: readonly string[];
  readonly constraints: readonly string[];
  readonly contextRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly dependencyOutputs: readonly DependencyOutputRef[];
  /** Runtime-injected after Control Plane authorization; never planner-granted. */
  readonly authorizedCapabilities: readonly string[];
  readonly budget: TaskBudget;
  readonly trace: ExecutionTraceContext;
}

export interface ProposedAgentAction {
  readonly id: string;
  readonly description: string;
  /** Agent-declared risk hint; the Control Plane must independently classify it. */
  readonly declaredRiskClass:
    | "routine"
    | "material"
    | "high_impact"
    | "prohibited";
}

export interface AgentTaskResult {
  readonly taskId: string;
  readonly agentId: string;
  readonly agentVersion: string;
  readonly state: "succeeded" | "failed" | "cancelled";
  readonly summary: string;
  readonly outputRef?: string;
  readonly evidenceRefs: readonly string[];
  readonly assumptions: readonly string[];
  readonly unknowns: readonly string[];
  readonly confidence?: number;
  readonly proposedActions: readonly ProposedAgentAction[];
  readonly estimatedCostUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
  readonly warnings: readonly string[];
  readonly errorCode?: string;
}
