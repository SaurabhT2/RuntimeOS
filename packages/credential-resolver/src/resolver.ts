import { GatewayError, isGatewayError } from "@ai-gateway/core-contracts";
import type { CredentialScope } from "@ai-gateway/config";
import type {
  CredentialResolver,
  ResolutionChain,
  ScopedCredential,
  TenantContext,
} from "./types.js";
import type { AuditLogger } from "./audit.js";
import type { CredentialStore } from "./store/credential-store.js";
import type { Encryptor } from "./encryption.js";

export interface DefaultCredentialResolverOptions {
  chain: ResolutionChain;
  auditLogger: AuditLogger;
  /** Who to attribute audit events to when the caller doesn't supply one. */
  defaultActor?: string;
}

/**
 * architecture §11, verbatim signature. Wraps a `ResolutionChain` with the
 * two things architecture places at this layer rather than the chain's:
 * audit logging (architecture §15.4/§20.3 — "at scope-decision granularity")
 * and turning a chain miss into a thrown `GatewayError("CREDENTIAL_NOT_FOUND")`
 * (the chain itself returns `null` per architecture §15.2's own signature;
 * `CredentialResolver.resolve` does not return `null`, per architecture
 * §11 — someone has to bridge the two, and that someone is this class).
 */
export class DefaultCredentialResolver implements CredentialResolver {
  private readonly chain: ResolutionChain;
  private readonly auditLogger: AuditLogger;
  private readonly defaultActor: string;

  constructor(options: DefaultCredentialResolverOptions) {
    this.chain = options.chain;
    this.auditLogger = options.auditLogger;
    this.defaultActor = options.defaultActor ?? "system";
  }

  async resolve(provider: string, tenant: TenantContext): Promise<ScopedCredential> {
    let result: ScopedCredential | null;
    try {
      result = await this.chain.resolve(provider, tenant);
    } catch (error) {
      this.auditLogger.record({
        type: "resolve",
        actor: this.defaultActor,
        // architecture §19.1: never leak which scope failed, or any other
        // operational detail (a row ID, an env var name, an underlying
        // exception message), to the caller — but the audit log is an
        // internal, operator-facing record, not the caller-facing error,
        // so it's the right place to keep the full detail even though the
        // error thrown below deliberately doesn't repeat it. Prior to the
        // EM-2 review, this path re-threw `error` verbatim, which let
        // exactly this kind of detail leak to callers on this path while
        // the "no scope matched" path (below) correctly redacted it — see
        // this milestone's Security Fix Summary for the finding this
        // closes.
        scope: "platform",
        tenant,
        provider,
        outcome: "failure",
        detail: error instanceof Error ? error.message : String(error),
      });

      // Redact to the same generic, code-appropriate message the "no
      // scope matched" path below uses — one consistent redaction
      // strategy across both failure paths, per the review's Required
      // Change 2. A credential-specific failure deeper in the stack
      // (`SecretSource`/`ScopeResolver` throwing `CREDENTIAL_NOT_FOUND` or
      // `CREDENTIAL_INVALID`) is indistinguishable, from the caller's
      // point of view, from "no scope matched" — both mean "this caller
      // does not get a usable credential," and neither should reveal
      // *why* in more detail than that. A genuinely unexpected failure
      // (not a `GatewayError` the credential-resolution machinery itself
      // raised) is surfaced under `INTERNAL_ERROR` instead of
      // `CREDENTIAL_NOT_FOUND`, since misreporting a real bug as "no
      // credential" would itself be misleading to operators reading logs/
      // metrics by code — but its message is equally generic; the
      // `GatewayError` class and its existing codes/semantics are
      // unchanged, only which of the existing codes/messages this call
      // site chooses to throw.
      if (
        isGatewayError(error) &&
        (error.code === "CREDENTIAL_NOT_FOUND" || error.code === "CREDENTIAL_INVALID")
      ) {
        throw new GatewayError(
          "CREDENTIAL_NOT_FOUND",
          `No credential available for provider "${provider}".`,
          false,
        );
      }
      throw new GatewayError("INTERNAL_ERROR", "Credential resolution failed unexpectedly.", false);
    }

    if (result === null) {
      this.auditLogger.record({
        type: "resolve",
        actor: this.defaultActor,
        scope: "platform",
        tenant,
        provider,
        outcome: "failure",
        detail: "no scope resolved a credential",
      });
      // architecture §19.1: the thrown message intentionally does not say
      // which scopes were tried or which one(s) almost matched.
      throw new GatewayError(
        "CREDENTIAL_NOT_FOUND",
        `No credential available for provider "${provider}".`,
        false,
      );
    }

    this.auditLogger.record({
      type: "resolve",
      actor: this.defaultActor,
      scope: result.scope,
      tenant,
      provider,
      outcome: "success",
    });
    return result;
  }
}

export interface RegisterCredentialInput {
  scope: Exclude<CredentialScope, "platform">;
  provider: string;
  tenant: TenantContext;
  /** The plaintext secret to store. Encrypted before it touches `CredentialStore` — never stored or logged raw. */
  plaintextKey: string;
  actor: string;
}

export interface RegisterCredentialResult {
  rowId: string;
  scope: CredentialScope;
}

/**
 * architecture §16.2's BYOK registration flow, narrowed to this package's
 * own responsibility: encrypt-and-store plus the `register` audit event.
 * architecture §16.2's full flow also calls `ProviderAdapter.healthCheck`
 * to validate the key live before accepting it — `credential-resolver` has
 * no dependency edge to `providers/provider-sdk` (Blueprint §4.1) and
 * never will, so that live-validation step is necessarily a
 * higher-level caller's responsibility (whichever future package/milestone
 * has access to both `credential-resolver` and `provider-sdk` —
 * `orchestrator`, EM-4, is the natural candidate given its existing
 * dependency on both). This function accepts a key its caller has already
 * decided to accept; it does not itself validate the key against the
 * provider.
 */
export async function registerCredential(
  store: CredentialStore,
  encryptor: Encryptor,
  auditLogger: AuditLogger,
  input: RegisterCredentialInput,
): Promise<RegisterCredentialResult> {
  const encryptedKey = encryptor.encrypt(input.plaintextKey);
  try {
    const row = await store.put({
      scope: input.scope,
      provider: input.provider,
      tenant: input.tenant,
      encryptedKey,
    });
    auditLogger.record({
      type: "register",
      actor: input.actor,
      scope: input.scope,
      tenant: input.tenant,
      provider: input.provider,
      outcome: "success",
    });
    return { rowId: row.rowId, scope: row.scope };
  } catch (error) {
    auditLogger.record({
      type: "register",
      actor: input.actor,
      scope: input.scope,
      tenant: input.tenant,
      provider: input.provider,
      outcome: "failure",
      detail: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
