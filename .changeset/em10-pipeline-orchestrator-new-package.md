---
"@ai-gateway/pipeline-orchestrator": minor
---

New package (EM-10): Multi-Step Execution Pipelines (architecture §41).
`DefaultPipelineOrchestrator.executePipeline` sequences ordinary
`ExecuteRequest`s through the existing, unmodified `ExecutionOrchestrator.execute()`
— no duplicated provider/policy/retry logic. Sequential only
(DAG/parallel execution explicitly deferred, §41.5). `maxSteps` is a
mandatory, platform-configured cap (default 20, ADR-0023) enforced before
any step executes.
