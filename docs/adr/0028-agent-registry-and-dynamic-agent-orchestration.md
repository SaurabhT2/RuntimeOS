# ADR-0028: Separate the Agent Registry from Dynamic Agent Orchestration

**Status:** Proposed  
**Date:** 2026-11-09  
**Format:** Context / Decision / Consequences / Alternatives

## Context

RuntimeOS already provides provider/model execution orchestration and a sequential pipeline-orchestrator. The latter explicitly excludes DAG and parallel execution (architecture §41.5). Neither component defines the business-level specialist agents, their mandates, bounded context, tool capability requirements, autonomy classifications or evaluation contracts.

SAURABH AI requires one executive interface that dynamically delegates work to one or more specialist agents. It is personal-first but must support future multi-tenant commercialization. Treating each specialist as an independent chatbot would duplicate context and policy and would not provide coherent cross-agent execution.

## Decision

1. Introduce the agent-registry package as a standalone, dependency-light package that owns versioned, declarative AgentManifest contracts and deterministic capability discovery.
2. Establish six platform-owned built-in manifests: strategy, leadership, research, architecture, growth and execution.
3. Keep the registry separate from the executive orchestrator. The registry validates, stores and discovers manifests; a future executive orchestrator interprets intent, selects agents, builds a bounded task DAG, coordinates dependencies and synthesizes results.
4. Keep the executive orchestrator separate from RuntimeOS's existing provider/model ExecutionOrchestrator. Agent tasks use RuntimeOS for model execution through an adapter; they do not change the meaning of provider execution.
5. Do not repurpose the existing sequential pipeline-orchestrator as a multi-agent DAG engine.
6. Treat manifest autonomy declarations as descriptive policy metadata, never as authorization. The Control Plane remains authoritative for principal, tenant/workspace, resource, tool and approval checks.
7. Keep built-in manifests immutable and versioned. Tenant/workspace customizations are constrained overlays with independent audit and versioning.
8. Defer persistent agent overlays, run/task records and approvals to a later schema decision after the live IntelligenceOS and Control Plane ownership boundaries are reviewed.

The initial implementation is limited to the registry, contract types, six built-ins and unit tests. It does not execute agents, invoke tools, create database tables or change production services.

## Consequences

- Specialist capability contracts can be reviewed and versioned independently of prompts, model providers and workspace data.
- Dynamic orchestration can evolve without changing the provider execution lifecycle.
- Parallel agent work will require a new graph execution component with explicit bounds, dependency semantics, cancellation, cost budgets and policy gates.
- Tool capability identifiers in manifests must be resolved by the Control Plane at runtime; they are not credentials or grants.
- Agent output provenance and uncertainty become part of the common result envelope.
- Adding or changing a built-in agent requires manifest versioning and evaluation coverage.

## Alternatives considered

- **Extend pipeline-orchestrator:** rejected because it is explicitly sequential and its contract models a list of model-execution steps, not specialist agents with bounded context, capability contracts and policy.
- **Add agents directly to orchestrator:** rejected because ExecutionOrchestrator owns provider/model execution and should remain application-agnostic.
- **Implement six independent chatbots:** rejected because it duplicates orchestration, creates inconsistent policy/context and makes cross-agent synthesis implicit.
- **Store all agent definitions in IntelligenceOS:** rejected for platform-owned executable capability contracts. IntelligenceOS owns knowledge and learning; the immutable registry is a RuntimeOS platform concern. Workspace-specific configuration may later be persisted separately.
