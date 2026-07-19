import type { LearningRegistry } from "@ai-gateway/learning";
import type { StrategyContext, StrategyPipelineStage } from "../types.js";

/**
 * architecture §36's Learning Extension Points, wired as the EM-8 work
 * order's "Collect Learning Signal" stage — **socket wiring only, no
 * signal is actually collected here.** `LearningSignalCollector.record`
 * (architecture §36.2) takes an `ExecutionOutcome` — `latencyMs`, `success`,
 * `costUsd`, `failureReason` — every one of which is a *post-execution*
 * fact. This stage runs before the Policy Engine and before any provider
 * call, so no real `ExecutionOutcome` exists yet; fabricating one here
 * would mean calling `record()` with made-up data, which is worse than not
 * calling it at all. This is also consistent with EM-8's own Out-of-Scope
 * list ("No Learning Intelligence," "No Adaptive Ranking," "No AI Feedback
 * Loop") — this milestone wires the extension points into the request
 * lifecycle; it does not make them do anything yet.
 *
 * What this stage actually, legitimately does: confirms the currently-
 * registered `LearningSignalCollector`/`AdaptiveRankingStrategy` are
 * reachable (defaulting to the shipped no-ops per `@ai-gateway/learning`'s
 * own default), so a later milestone that *does* have a real
 * post-execution outcome available (most naturally, `orchestrator`, after
 * a response comes back) has a concrete, already-resolved registry to call
 * `.record()` on — without this milestone needing to change
 * `ExecuteResponse` or `orchestrator`'s response path to thread one
 * through today. `StrategyDecision` (architecture §30.3, frozen) has no
 * field for this — appropriately, since there is nothing outcome-shaped to
 * put there yet — so this stage's contribution is not reflected in the
 * final `StrategyDecision` at all; it exists purely so the pipeline has a
 * real, independently-replaceable, independently-testable stage in this
 * position, ready for a future milestone to extend without restructuring
 * the pipeline.
 */
export class LearningHookStage implements StrategyPipelineStage {
  readonly name = "learning_hooks";

  constructor(private readonly registry: LearningRegistry) {}

  async run(ctx: StrategyContext): Promise<StrategyContext> {
    // Deliberately side-effect-free: touches the registry only to confirm
    // it resolves, does not call `.record()` (see class doc comment).
    void this.registry.getSignalCollector();
    void this.registry.getRankingStrategy();
    return ctx;
  }
}
