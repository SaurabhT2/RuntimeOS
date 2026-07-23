# @ai-gateway/pipeline-orchestrator

**Status:** implemented (Engineering Milestone EM-10). Multi-Step
Execution Pipelines (architecture §41): sequences ordinary
`ExecuteRequest`s through the existing, unmodified `ExecutionOrchestrator`
public interface. Sequential only — DAG/parallel step execution is
explicitly out of scope (architecture §41.5).

## Public API

- `PipelineStep` / `ExecutionPipeline` / `PipelineContext` / `PipelineResult`
  (architecture §41.2, verbatim).
- `DefaultPipelineOrchestrator.executePipeline(pipeline, signal?)` — the
  one method this package exists to provide.

## Design notes / Engineering Decisions

1. **No execution logic of its own.** `DefaultPipelineOrchestrator` calls
   `ExecutionOrchestrator.execute()` — the exact same entry point every
   other caller in this platform uses — once per step, sequentially.
   Every step gets the full Strategy Layer → Policy Engine → Execution
   Plan → Provider treatment; this package makes zero provider,
   `PolicyEngine`, or `AIStrategyLayer` calls of its own (architecture
   §41.1: "reuses the existing execution flow ... does not duplicate
   policy, provider, or retry logic").
2. **`maxSteps` is a mandatory, platform-configured cap, enforced before
   any step runs (ADR-014).** Defaults to `20` (ADR-014's own "e.g., 20").
   A pipeline exceeding the cap runs _zero_ steps — the rejection
   (`GatewayError("INVALID_TASK", ...)`, per ADR-014's own "INVALID_TASK-class")
   happens before `orchestrator.execute()` is ever called for that
   pipeline.
3. **Failure semantics, per architecture §41.2:** a `required` step
   (the default) failing aborts every remaining step; a non-required
   step's failure is recorded in `stepResults` and the pipeline continues.
   Either way, every step actually attempted has an entry in
   `stepResults`; a step never reached because an earlier `required` step
   failed has no entry at all.
4. **`ctx.outputs` only ever holds successful responses.** A failed,
   non-required step contributes nothing a later step's `buildInput`
   could read (there's no `ExecuteResponse` to read) — it's still fully
   recorded in `stepResults`, just not `ctx.outputs`.
5. **`totalLatencyMs` is measured wall-clock time, not a sum of per-step
   figures.** Architecture §41.2 names the field but doesn't specify its
   derivation. Wall-clock is this package's documented choice: correct
   today (steps run sequentially, so the two would be equal anyway
   _if_ every step succeeded), and it stays correct without modification
   if a future milestone ever parallelizes independent steps
   (§41.5's explicitly deferred scope) — a sum would silently become
   wrong the moment execution overlaps.
6. **Cancellation is checked between steps, never mid-step.** An
   in-flight step runs to completion; the `AbortSignal`, when supplied, is
   only consulted before starting the _next_ step — the same "cancellation
   takes effect at the next safe point, not by force" contract
   `orchestrator`'s own streaming cancellation already uses (architecture
   §17).
7. **`buildInput` never mutates `PipelineContext`.** Each step's context is
   `{...ctx, outputs: {...ctx.outputs, [step.id]: response}}` — a fresh
   object per step, matching `strategy-layer`'s own established
   "return a fresh object, never mutate the one you were given" convention
   (EM-9's `deepFreeze`, applied here as a coding discipline rather than an
   enforced runtime freeze, since `PipelineContext` isn't itself an
   architecture-frozen type).

## Testing strategy

- The architecture §41.4 four-step worked example (extract → summarize →
  entity_extraction → json_generation) as an integration test, asserting
  each step actually received the _previous_ step's real output.
- `maxSteps`: rejected over the limit (with zero steps executed),
  allowed exactly at the limit, and the `20` default.
- Required-step-abort, non-required-step-continue, and the interaction
  between the two (a later step reading `ctx.outputs` correctly sees no
  entry for an earlier failed-and-continued step).
- Cost aggregation (sums only successful steps) and latency aggregation
  (a basic sanity bound, since wall-clock timing in a test can't assert
  an exact figure).
- Cancellation: already-aborted before the first step, aborted mid-first-step
  (lets that step finish, stops before the second), and the
  no-signal-supplied case (runs normally).
- Non-`GatewayError` exceptions from `orchestrator.execute` are wrapped as
  `INTERNAL_ERROR`, never propagated raw (defensive, since
  `ExecutionOrchestrator.execute`'s own contract already guarantees this,
  but this package doesn't take that on faith from an orchestrator
  instance it did not itself construct — same discipline
  `orchestrator`'s own `toGatewayError` uses for provider adapters).

## Dependencies

`core-contracts`, `orchestrator` (its public interface only). Matches
Blueprint §4.1's table exactly.

## Architecture reference

§41 (Multi-Step Execution Pipelines); §46's ADR-014 (`maxSteps`).
