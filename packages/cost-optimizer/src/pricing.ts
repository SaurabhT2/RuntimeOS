/**
 * architecture §33.2 defines `estimatedCostUsd`/`estimatedSavingsUsd` but not
 * how they're computed. This package has no dependency on `model-registry`
 * (Blueprint §4.1's table: `capability-registry`, `execution-profile-registry`,
 * `runtime-profiles` only), so the real per-model $/1K-token rate a Provider
 * Adapter will eventually charge isn't available at this pipeline stage —
 * the same "not billing-accurate, only directionally useful for a pipeline
 * decision" trade-off architecture §34.4 makes for token estimation, for the
 * identical reason (the real provider/model isn't chosen yet here).
 *
 * Designed, not specified: a coarse, illustrative $/1K-token rate per
 * `preferredModelClasses` tier, internally consistent with
 * `execution-profile-registry`'s own seed data (`fast-extraction` cheapest,
 * `complex-reasoning` priciest, `creative` in between — see that package's
 * `seed-data.ts` for the same vocabulary).
 */
export const ILLUSTRATIVE_COST_PER_1K_TOKENS_USD: Readonly<Record<string, number>> = {
  "fast-extraction": 0.05,
  creative: 0.3,
  "complex-reasoning": 0.6,
};

/** Used for any `modelClass` not present in the illustrative table above (e.g. a future/custom class). */
const DEFAULT_COST_PER_1K_TOKENS_USD = 0.3;

export function costPer1kTokensUsd(modelClass: string): number {
  return ILLUSTRATIVE_COST_PER_1K_TOKENS_USD[modelClass] ?? DEFAULT_COST_PER_1K_TOKENS_USD;
}

/** `tokenEstimate` is the provider-agnostic estimate architecture §34.4 describes — not billing-accurate, directionally useful only. */
export function estimateCostUsd(modelClass: string, tokenEstimate: number): number {
  return (tokenEstimate / 1000) * costPer1kTokensUsd(modelClass);
}
