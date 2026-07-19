---
"@ai-gateway/strategy-layer": minor
---

EM-10: `StrategyLayerOptions` gains an optional `budgetEnforcer` field
(`@ai-gateway/budget-governance`). When supplied, a new
`BudgetEnforcementStage` runs between `CostOptimizationStage` and
`LearningHookStage` — a block throws `GatewayError("BUDGET_EXCEEDED", ...)`
before the request ever reaches Policy Engine; a forced downgrade
overrides `optimizations.cost.recommendedModelClassDowngrade`. Omitted
entirely (the default), a `strategy-layer` instance is byte-for-byte
unaffected — no stage added, not even a no-op one.
