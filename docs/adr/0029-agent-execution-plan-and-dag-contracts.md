# ADR-0029: Define Agent Execution Plans and DAG Scheduling Contracts

**Status:** Proposed  
**Date:** 2026-11-09  
**Format:** Context / Decision / Consequences / Alternatives

## Context

The Agent Registry (ADR-0028) defines versioned specialist-agent capabilities,
but it does not describe how a multi-agent request is decomposed, bounded,
sequenced or tracked. RuntimeOS's existing pipeline-orchestrator is
intentionally sequential and must not be silently expanded into a second
agent execution engine.

SAURABH AI needs an inspectable planning contract that can represent one or
many specialist tasks, their dependencies, tenant/workspace scope, evidence
references, resource budgets and execution constraints. It must support
parallel work without giving a planner or manifest implicit authority to
execute tools or access data.

## Decision

1. Add a dependency-free agent-orchestration package for plan/task contracts,
   validation and deterministic scheduling primitives.
2. Define a tenant-scoped ExecutionPlan with principal, workspace, objective,
   creation time, bounded tasks and explicit execution limits.
3. Define each AgentTask with an agent ID/version, objective, success
   criteria, constraints, dependency IDs, required/optional semantics,
   context/evidence references, requested capabilities and per-task budget.
4. Validate unique task IDs, dependency references, duplicate/self edges,
   cycles, maximum task count, dependency depth, parallelism, timeouts and
   estimated cost before scheduling.
5. Provide deterministic topological waves and ready/blocked task queries.
   Independent work may be scheduled concurrently up to the plan limit.
6. Keep task and result envelopes bounded. Context, evidence and predecessor
   outputs are opaque, tenant-scoped references, not unrestricted memory.
7. Treat requestedCapabilities as a request only. Runtime-injected
   authorizedCapabilities may be populated only after the Control Plane
   authorizes principal, tenant/workspace, resource and approval state.
8. A required task failure prevents dependent tasks and fails the plan's
   required outcome. An optional task failure may permit partial completion,
   but its dependants remain blocked unless the dependency succeeded.
9. Keep execution, persistence, provider invocation, tool authorization and
   human approval outside this package. Those belong to the runtime,
   IntelligenceOS and Control Plane integration milestones.

## Consequences

- Plans become inspectable, testable and auditable before execution begins.
- Parallelism and cost/time bounds are explicit rather than emergent.
- A plan cannot authorize itself or a specialist agent.
- The scheduler can be reused by a future executive orchestrator without
  changing RuntimeOS's provider/model ExecutionOrchestrator or sequential
  pipeline-orchestrator.
- Persistent plan/run state and cancellation coordination will require a
  later runtime/persistence design and tenant-aware schema review.

## Alternatives considered

- **Extend pipeline-orchestrator:** rejected because it is explicitly
  sequential and models ordinary ExecuteRequests, not specialist-agent task
  contracts and a dependency graph.
- **Let agents delegate to each other directly:** rejected because hidden
  handoffs undermine policy, budget enforcement, traceability and cycle
  prevention.
- **Pass complete conversation and workspace history to every agent:**
  rejected because it violates least-privilege context scoping and increases
  data exposure and token cost.
- **Let manifests declare their own tool grants:** rejected because a
  descriptive agent contract cannot replace runtime authorization.
