/**
 * architecture §11 (`ProviderAdapter.estimateCost()` — shape not spelled
 * out there). A pre-invocation cost projection, synchronous by design (the
 * interface signature is `estimateCost(req): CostEstimate`, not a
 * `Promise`) since it must be cheap enough for the Policy Engine to call
 * for every candidate provider while building an `ExecutionPlan`, with no
 * network round-trip.
 */
export interface CostEstimate {
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
}
