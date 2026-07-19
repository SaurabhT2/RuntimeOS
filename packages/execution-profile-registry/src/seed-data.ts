import { DEFAULT_RETRY_POLICY } from "./retry-policy.js";
import type { ExecutionProfile } from "./execution-profile.js";

/**
 * architecture §31.3's illustrative seed table, expressed as full
 * `ExecutionProfile` records. `preferredModelClasses` and the exact
 * `timeoutMs`/`maxOutputTokens`/`topP`/`topK` figures are designed, not
 * specified — §31.3 gives temperature and the four boolean-ish defaults
 * (streaming/structuredOutput/caching + notes) only. `preferredModelClasses`
 * values are chosen to match `model-registry`'s `SEED_MODELS.modelClass`
 * vocabulary (`fast-extraction`, `complex-reasoning`, `creative`) — this is
 * an intentional, informal alignment for a readable end-to-end demo (EM-6's
 * own acceptance criterion), not a compile-time or runtime dependency: this
 * package never imports `model-registry` (Blueprint §4.1's table lists only
 * `config`, `core-contracts`).
 */
export const SEED_EXECUTION_PROFILES: ExecutionProfile[] = [
  {
    id: "extraction",
    preferredModelClasses: ["fast-extraction"],
    inference: { temperature: 0.0, maxOutputTokens: 1024 },
    timeoutMs: 15_000,
    retryPolicy: DEFAULT_RETRY_POLICY,
    streaming: { defaultEnabled: false },
    structuredOutput: { defaultEnabled: true },
    caching: { defaultEnabled: true, ttlSeconds: 3600, keyStrategy: "exact" },
  },
  {
    id: "classification",
    preferredModelClasses: ["fast-extraction"],
    inference: { temperature: 0.0, maxOutputTokens: 64 },
    timeoutMs: 8_000,
    retryPolicy: DEFAULT_RETRY_POLICY,
    streaming: { defaultEnabled: false },
    structuredOutput: { defaultEnabled: true },
    caching: { defaultEnabled: true, ttlSeconds: 3600, keyStrategy: "exact" },
  },
  {
    id: "summarization",
    preferredModelClasses: ["fast-extraction", "complex-reasoning"],
    inference: { temperature: 0.3, maxOutputTokens: 1024 },
    timeoutMs: 30_000,
    retryPolicy: DEFAULT_RETRY_POLICY,
    streaming: { defaultEnabled: true, chunking: "token" },
    structuredOutput: { defaultEnabled: false },
    caching: { defaultEnabled: false, keyStrategy: "exact" },
  },
  {
    id: "json_generation",
    preferredModelClasses: ["fast-extraction"],
    inference: { temperature: 0.0, maxOutputTokens: 2048 },
    timeoutMs: 20_000,
    retryPolicy: DEFAULT_RETRY_POLICY,
    streaming: { defaultEnabled: false },
    structuredOutput: { defaultEnabled: true },
    caching: { defaultEnabled: true, ttlSeconds: 3600, keyStrategy: "exact" },
  },
  {
    id: "reasoning",
    preferredModelClasses: ["complex-reasoning"],
    inference: { temperature: 0.4, maxOutputTokens: 4096 },
    timeoutMs: 60_000,
    retryPolicy: DEFAULT_RETRY_POLICY,
    streaming: { defaultEnabled: true, chunking: "token" },
    structuredOutput: { defaultEnabled: false },
    caching: { defaultEnabled: false, keyStrategy: "exact" },
  },
  {
    id: "composition",
    preferredModelClasses: ["creative"],
    inference: { temperature: 0.8, maxOutputTokens: 4096 },
    timeoutMs: 45_000,
    retryPolicy: DEFAULT_RETRY_POLICY,
    streaming: { defaultEnabled: true, chunking: "token" },
    structuredOutput: { defaultEnabled: false },
    caching: { defaultEnabled: false, keyStrategy: "exact" },
  },
  {
    id: "coding",
    preferredModelClasses: ["complex-reasoning"],
    inference: { temperature: 0.2, maxOutputTokens: 4096 },
    timeoutMs: 45_000,
    retryPolicy: DEFAULT_RETRY_POLICY,
    streaming: { defaultEnabled: true, chunking: "token" },
    structuredOutput: { defaultEnabled: false },
    caching: { defaultEnabled: false, keyStrategy: "exact" },
  },
  {
    id: "translation",
    preferredModelClasses: ["fast-extraction"],
    inference: { temperature: 0.2, maxOutputTokens: 2048 },
    timeoutMs: 20_000,
    retryPolicy: DEFAULT_RETRY_POLICY,
    streaming: { defaultEnabled: false },
    structuredOutput: { defaultEnabled: false },
    caching: { defaultEnabled: true, keyStrategy: "semantic" },
  },
];

/**
 * `TaskType` (`core-contracts`' `KNOWN_TASK_TYPES`) -> `ExecutionProfileId`.
 * Needed because the two vocabularies are deliberately distinct (architecture
 * §31 names profiles by role — `extraction`, `reasoning`, `composition` —
 * while `core-contracts`' task types are more granular/business-facing —
 * `knowledge_extraction`, `complex_reasoning`, `marketing_content`).
 * architecture §31.4's own sequence diagram calls `getProfile("summarization")`
 * directly with a task name, which only reads as literal because
 * `"summarization"` happens to be spelled the same as both a `TaskType` and
 * an `ExecutionProfileId` — this table is what makes that call correct for
 * every *other* task name too.
 */
export const TASK_TO_EXECUTION_PROFILE_ID: Record<string, string> = {
  knowledge_extraction: "extraction",
  entity_extraction: "extraction",
  classification: "classification",
  summarization: "summarization",
  json_generation: "json_generation",
  creative_writing: "composition",
  complex_reasoning: "reasoning",
  marketing_content: "composition",
  code_generation: "coding",
};
