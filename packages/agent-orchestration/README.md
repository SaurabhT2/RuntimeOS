# @ai-gateway/agent-orchestration

Typed execution plans and deterministic DAG scheduling primitives for the
SAURABH AI executive orchestrator.

## Scope

This package defines task envelopes, tenant-scoped execution plans, resource
budgets, plan validation and deterministic scheduling helpers. It does not
invoke models, dispatch agents, grant tools, persist runs or approve external
actions.

The package is intentionally dependency-free. Agent identifiers and versions
are references resolved by the Agent Registry at planning time and checked
again by the runtime before dispatch.

## Plan lifecycle

1. The planner creates a tenant/workspace-scoped plan.
2. The validator checks identity, task shape, dependencies, acyclicity, depth,
   timeouts and cost ceilings.
3. The scheduler identifies topological execution waves and currently ready
   tasks, subject to the concurrency limit.
4. The Control Plane authorizes the principal, workspace, requested
   capabilities and approval requirements before any task is dispatched.
5. RuntimeOS executes authorized tasks. Outputs are returned as opaque,
   tenant-scoped references and passed only to declared dependants.
6. The executive orchestrator synthesizes successful results, preserves
   failures and reports partial completion.

## Important boundaries

- \`requiredCapabilities\` are requested capability names, not grants.
- \`authorizedCapabilities\` in \`AgentTaskEnvelope\` must be injected by the
  runtime only after Control Plane authorization.
- Context, evidence and dependency outputs are opaque references, not
  unrestricted memory or conversation history.
- A task marked optional may fail without failing the whole plan; its
  dependants are still blocked unless their dependency completes successfully.
- The scheduler is deterministic and has no model/provider or network access.
- No database schema, persistent run store or live agent dispatch is introduced in this package.

## Validation and scheduling

- \`validateExecutionPlan\` returns structured errors and warnings.
- \`assertValidExecutionPlan\` throws \`ExecutionPlanValidationError\`.
- \`getExecutionWaves\` returns deterministic topological layers, chunked to
  \`maxParallelTasks\`.
- \`getReadyTasks\` returns pending tasks whose dependencies succeeded, bounded
  by available concurrency slots.
- \`getBlockedTaskIds\` identifies pending tasks with failed, skipped or
  cancelled dependencies.
