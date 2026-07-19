---
"@ai-gateway/gateway-runtime": minor
---

EM-10: new `POST /v1/execute/pipeline` route (architecture §41.3), backed
by `@ai-gateway/pipeline-orchestrator`; `STATUS_BY_CODE` gains
`BUDGET_EXCEEDED: 402`; `GatewayRuntimeConfig` gains `budgetPolicies`/
`budgetEnforcementMode`/`maxPipelineSteps`; `bootstrap()` constructs
`@ai-gateway/budget-governance`'s pieces (gated on `enableStrategyLayer`
and a non-empty `budgetPolicies` list; defaults to shadow mode) and a
`DefaultPipelineOrchestrator` (constructed unconditionally — no feature
flag of its own). `GatewayApp` gains `budgetEnforcer`/`pipelineOrchestrator`.
