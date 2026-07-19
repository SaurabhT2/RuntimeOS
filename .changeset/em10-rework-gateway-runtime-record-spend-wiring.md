---
"@ai-gateway/gateway-runtime": patch
---

EM-10 Engineering Rework (Independent Architecture & Engineering Review,
Finding 1): `bootstrap()` now wires `orchestrator`'s new
`onExecutionCompleted` hook to `BudgetLedger.recordSpend`, closing the gap
where recorded spend never reflected real traffic. The `BudgetLedger`
instance is hoisted to its own name (shared by `budgetEnforcer` and the
new hook, so both read and write the same store) and exposed on
`GatewayApp` as `budgetLedger`, gated identically to the existing
`budgetEnforcer` field. No effect when Budget Governance isn't actually
active (`enableStrategyLayer` off, or no `budgetPolicies` configured).
`packages/gateway-runtime/src/testing/fixtures.ts`'s `fakeAdapter` gained
an optional `costUsd` override (default `0`, matching every existing
caller's prior behavior) so cumulative spend accrual can actually be
exercised in a test.
