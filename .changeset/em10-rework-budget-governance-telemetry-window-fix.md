---
"@ai-gateway/budget-governance": patch
---

EM-10 Engineering Rework (Independent Architecture & Engineering Review,
Finding 2): `gateway_budget_alert_total`'s `window` label now reflects
whichever window (`"day"` or `"month"`) actually drove the alert, instead
of always being hardcoded to `"day"`. No change to any exported type —
`BudgetDecision`'s shape is unchanged; the fix is entirely internal to
`DefaultBudgetEnforcer`.
