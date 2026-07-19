---
"@ai-gateway/budget-governance": minor
---

New package (EM-10): Enterprise Budget & Cost Governance (architecture
§43). `BudgetPolicy`/`BudgetThresholdAction`/`BudgetLedger`/`BudgetEnforcer`/
`BudgetDecision`, `DefaultBudgetEnforcer` (ships in shadow mode by
default — Blueprint §7 EM-10's explicit risk mitigation), `InMemoryBudgetLedger`
(reference/non-durable — see README for the durable-implementation
requirement, ADR-0022), `ConfigBackedBudgetPolicyProvider`/
`StaticBudgetPolicyProvider`, and `budgetProviderExclusionRule` (a real,
tested `policy-engine` `RoutingRule`, currently unregistered pending
ADR-0025's resolution).
