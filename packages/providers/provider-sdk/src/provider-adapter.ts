import type { ProviderCapabilities } from "./capabilities.js";
import type { NormalizedInvocation, NormalizedResult, NormalizedChunk } from "./invocation.js";
import type { ScopedCredential } from "./credential.js";
import type { ProviderHealthSnapshot } from "./health.js";
import type { CostEstimate } from "./cost.js";

/**
 * architecture §11, unchanged. The single seam every provider adapter
 * implements and every consumer (orchestrator, streaming, reliability)
 * depends on — never a concrete provider SDK type.
 *
 * Frozen per Blueprint §6.1 ("must be frozen before implementation"):
 * changing this signature after EM-1's acceptance requires an ADR
 * (Blueprint §6.3; architecture §28/§39/§46).
 *
 * Deliberately *not* generalized to a `CapabilityAdapter<T, O>` here (see
 * architecture §42.1) — that generalization is v1.2/future-milestone scope
 * (Scope Control: "no future capabilities"). This package's own scaffold
 * comment mentioned `CapabilityAdapter<T,O>` as a Wave 1 deliverable; per
 * the Engineering Blueprint §7 (which governs over this package's own
 * pre-existing scaffold note when the two disagree) EM-1 ships the
 * non-generic `ProviderAdapter` only. See `docs/adr/` for how a future
 * generalization would be introduced without breaking this interface.
 *
 * Adapter Boundary Contract (architecture §19.2): every implementation of
 * `invoke`/`invokeStream` MUST catch all provider-SDK/HTTP exceptions
 * internally and translate them to `GatewayError` — never let a raw
 * exception escape. Enforced by the shared conformance suite
 * ({@link runConformanceSuite}).
 */
export interface ProviderAdapter {
  /** Stable, opaque identifier, e.g. `"groq"`, `"nvidia-nim"`, `"mock"`. */
  readonly id: string;
  readonly capabilities: ProviderCapabilities;

  invoke(req: NormalizedInvocation, cred: ScopedCredential): Promise<NormalizedResult>;
  invokeStream(req: NormalizedInvocation, cred: ScopedCredential): AsyncIterable<NormalizedChunk>;
  healthCheck(cred: ScopedCredential): Promise<ProviderHealthSnapshot>;
  estimateCost(req: NormalizedInvocation): CostEstimate;
}
