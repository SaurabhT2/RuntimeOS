import type { ExecuteRequest, ExecuteResponse } from "@ai-gateway/core-contracts";
import type { ProviderAdapter } from "@ai-gateway/provider-sdk";

/**
 * architecture §11, verbatim — including `onProviderRegistered`'s real
 * `ProviderAdapter` parameter (from `@ai-gateway/provider-sdk`).
 *
 * Independent Engineering Review of EM-7, Issue #1 (Major): the first draft
 * of this file substituted a locally-narrowed `RegisteredProviderAdapter`
 * (`{ id: string }` only) for the real `ProviderAdapter`, reasoning that
 * this package's Blueprint §4.1 dependency edge was `core-contracts` only.
 * That substitution was avoidable and incorrect: `provider-sdk` is a
 * Wave-1, `core-contracts`-only package (Blueprint §4.1's own table), so
 * adding the edge carries no layering or circularity risk — the same
 * pattern `prompt-optimizer` correctly used elsewhere in this same
 * milestone for its own forced `execution-profile-registry` edge. Fixed by
 * adding the `provider-sdk` dependency (see `package.json` and
 * `.dependency-cruiser.cjs`) and restoring the frozen interface exactly.
 */
export interface GatewayPlugin {
  name: string;
  onRequest?(req: ExecuteRequest): Promise<ExecuteRequest>;
  onResponse?(res: ExecuteResponse): Promise<ExecuteResponse>;
  onProviderRegistered?(adapter: ProviderAdapter): void;
}
