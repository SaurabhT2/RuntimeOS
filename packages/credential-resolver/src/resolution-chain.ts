import type { CredentialScope } from "@ai-gateway/config";
import type {
  CredentialReference,
  ResolutionChain,
  ScopedCredential,
  ScopeResolver,
  SecretSource,
  TenantContext,
} from "./types.js";
import { parseCredentialReference } from "./types.js";
import { GatewayError } from "@ai-gateway/core-contracts";

export interface DefaultResolutionChainOptions {
  resolvers: ScopeResolver[];
  sources: SecretSource[];
  /**
   * architecture §15.1/§15.2: try scopes "most specific first"
   * (`GatewayConfig.credentialPriority`, architecture §15.1's comment on
   * that field). Resolvers whose `scope` isn't in `priority` are never
   * tried; priority entries with no matching resolver are silently
   * skipped (lets a deployment enable only a subset of scopes).
   */
  priority: CredentialScope[];
  /** Optional per-credential TTL (seconds) attached to every resolved `ScopedCredential`. */
  ttlSeconds?: number;
}

/**
 * architecture §15.2, verbatim behavior: "tries each configured
 * `ScopeResolver` in priority order (most specific first) and returns the
 * first hit... short-circuits — it does not continue past the first
 * match, even if a later scope would also resolve, since credential
 * precedence (a user's own key overriding their org's) is exactly the
 * point of scope ordering."
 */
export class DefaultResolutionChain implements ResolutionChain {
  private readonly orderedResolvers: ScopeResolver[];
  private readonly sourcesById: Map<string, SecretSource>;
  private readonly ttlSeconds: number | undefined;

  constructor(options: DefaultResolutionChainOptions) {
    const resolversByScope = new Map(options.resolvers.map((r) => [r.scope, r] as const));
    this.orderedResolvers = options.priority
      .map((scope) => resolversByScope.get(scope))
      .filter((resolver): resolver is ScopeResolver => resolver !== undefined);
    this.sourcesById = new Map(options.sources.map((s) => [s.id, s] as const));
    this.ttlSeconds = options.ttlSeconds;
  }

  async resolve(provider: string, tenant: TenantContext): Promise<ScopedCredential | null> {
    for (const resolver of this.orderedResolvers) {
      const reference: CredentialReference | null = await resolver.lookup(provider, tenant);
      if (reference === null) {
        continue;
      }
      const key = await this.dereference(reference);
      return { key, scope: resolver.scope, ttl: this.ttlSeconds };
    }
    return null;
  }

  private async dereference(reference: CredentialReference): Promise<string> {
    const parsed = parseCredentialReference(reference);
    if (!parsed) {
      throw new GatewayError(
        "CREDENTIAL_INVALID",
        `Malformed credential reference: "${reference}"`,
        false,
      );
    }
    const source = this.sourcesById.get(parsed.sourceId);
    if (!source) {
      throw new GatewayError(
        "CREDENTIAL_INVALID",
        `No SecretSource registered for id "${parsed.sourceId}" (reference: "${reference}")`,
        false,
      );
    }
    return source.fetch(reference);
  }
}
