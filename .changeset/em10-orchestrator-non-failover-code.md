---
"@ai-gateway/orchestrator": patch
---

EM-10: `"BUDGET_EXCEEDED"` added to `NON_FAILOVER_CODES` — defensive;
currently unreachable via this milestone's wiring (Budget Enforcement
throws before any `ExecutionPlan` exists), documented for robustness
against a future milestone moving the check to a per-candidate position.
No behavior change.
