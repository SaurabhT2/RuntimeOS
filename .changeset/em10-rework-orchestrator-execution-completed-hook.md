---
"@ai-gateway/orchestrator": minor
---

EM-10 Engineering Rework (Independent Architecture & Engineering Review,
Finding 1): `ExecutionOrchestratorOptions` gains an optional, generic
`onExecutionCompleted` field — fired once per successful, non-cache-hit
`execute()` call, after the real `ExecuteResponse` is known and before it
is returned. Never fired for a cache hit or on any failure path. A
rejection from the hook is caught and logged
(`orchestrator.onExecutionCompleted.failed`) but never propagated. This
class still has zero knowledge of, or dependency on, budgets or ledgers —
`gateway-runtime`'s composition root is what supplies a real closure over
`@ai-gateway/budget-governance`'s `BudgetLedger.recordSpend`. Omitted
entirely (the default), `execute()` is byte-for-byte unaffected.
Not wired into `executeStream()` — see
`docs/adr/0026-budget-spend-recording-scope.md`.
