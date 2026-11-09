# @ai-gateway/agent-registry

Versioned, declarative capability contracts for specialist agents used by SAURABH AI and future multi-tenant agentic applications.

## Scope

This package is the catalog and contract boundary, not an agent runtime. It defines each agent's mandate, capability tags, invocation triggers, context requirements, tool-capability requirements, output contract, autonomy classification and evaluation criteria.

It deliberately does not execute prompts or call models, decide which agents should collaborate, grant tool permissions, store tenant-specific memory or replace the provider/model ExecutionOrchestrator or sequential pipeline-orchestrator.

## Public API

- AgentManifest and related types — the versioned agent contract.
- InMemoryAgentRegistry — validates, snapshots, freezes and stores manifests.
- findCandidates({ domains, capabilities }) — deterministic filtering. All requested capabilities must be present; at least one requested domain must match.
- BUILT_IN_AGENTS — strategy, leadership, research, architecture, growth and execution.

## Security boundary

Manifest autonomy classifications are declarative intent, not authorization. Every tool invocation must still be authorized by the runtime Control Plane against the authenticated principal, tenant/workspace, active policy, resource scope and approval state. A manifest can never grant itself access to a tool or data source.

## Multi-tenant evolution

Built-in manifests are platform-owned and versioned. Tenant/workspace customization should be represented as a constrained overlay (enablement, configuration, scoped tool grants and approved prompt configuration), never by mutating a global built-in manifest. Persistent overlays and audit records belong in the tenant-aware configuration/control-plane layer, not in this in-memory registry.
