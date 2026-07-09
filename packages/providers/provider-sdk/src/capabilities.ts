/**
 * architecture §12.2. Declared statically by each adapter (`readonly
 * capabilities` on {@link ProviderAdapter}) — the Policy Engine (Wave 3)
 * consults this before ever routing a request to a provider, e.g. a request
 * with `constraints.requiredSchema` set is never routed to a provider whose
 * capabilities declare `supportsJsonMode: false`.
 */
export interface ProviderCapabilities {
  supportsStreaming: boolean;
  supportsJsonMode: boolean;
  supportsToolCalling: boolean;
  supportsSystemMessages: boolean;
  maxContextTokens: number;
  rateLimits: { requestsPerMinute?: number; tokensPerMinute?: number };
}
