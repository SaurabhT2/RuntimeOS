/**
 * @ai-gateway/pipeline-orchestrator
 *
 * Multi-Step Execution Pipelines (architecture §41): sequences ordinary
 * `ExecuteRequest`s through the existing, unmodified `ExecutionOrchestrator`
 * public interface. Contains no execution logic of its own — every step
 * still goes through the same Strategy Layer → Policy Engine → Execution
 * Plan → Provider flow as any other request (architecture §41.1).
 *
 * STATUS: implemented (Engineering Milestone EM-10). Sequential only —
 * DAG/parallel step execution is explicitly out of scope (architecture
 * §41.5).
 *
 * Architecture reference: §41.
 */

export type { PipelineStep, ExecutionPipeline, PipelineContext, PipelineResult } from "./types.js";
export {
  DefaultPipelineOrchestrator,
  type PipelineOrchestratorOptions,
} from "./pipeline-orchestrator.js";
