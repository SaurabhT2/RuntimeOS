import { describe, expect, it, vi } from "vitest";
import { GatewayError } from "@ai-gateway/core-contracts";
import { DefaultCredentialResolver, registerCredential } from "../src/resolver.js";
import { DefaultResolutionChain } from "../src/resolution-chain.js";
import { DbScopeResolver } from "../src/scope-resolvers.js";
import { DbSecretSource } from "../src/sources/db-secret-source.js";
import { InMemoryCredentialStore } from "../src/store/credential-store.js";
import { AesGcmEncryptor, generateEncryptionKey } from "../src/encryption.js";
import type { AuditLogger, AuditEvent } from "../src/audit.js";
import type { TenantContext } from "../src/types.js";
import type { CredentialScope } from "@ai-gateway/config";

const tenant: TenantContext = { organizationId: "org-a", workspaceId: "ws-a" };
const PRIORITY: CredentialScope[] = ["user", "project", "workspace", "organization", "platform"];

function recordingAuditLogger(): AuditLogger & { events: Omit<AuditEvent, "timestamp">[] } {
  const events: Omit<AuditEvent, "timestamp">[] = [];
  return {
    events,
    record(event) {
      events.push(event);
    },
  };
}

describe("DefaultCredentialResolver", () => {
  it("returns the resolved credential on a hit", async () => {
    const store = new InMemoryCredentialStore();
    const encryptor = new AesGcmEncryptor(generateEncryptionKey());
    await store.put({
      scope: "workspace",
      provider: "groq",
      tenant,
      encryptedKey: encryptor.encrypt("sk-workspace-key"),
    });
    const chain = new DefaultResolutionChain({
      resolvers: [new DbScopeResolver("workspace", store)],
      sources: [new DbSecretSource(store, encryptor)],
      priority: PRIORITY,
    });
    const auditLogger = recordingAuditLogger();
    const resolver = new DefaultCredentialResolver({ chain, auditLogger });

    const result = await resolver.resolve("groq", tenant);

    expect(result.key).toBe("sk-workspace-key");
    expect(result.scope).toBe("workspace");
  });

  it("records a success audit event on a hit", async () => {
    const store = new InMemoryCredentialStore();
    const encryptor = new AesGcmEncryptor(generateEncryptionKey());
    await store.put({
      scope: "workspace",
      provider: "groq",
      tenant,
      encryptedKey: encryptor.encrypt("sk-key"),
    });
    const chain = new DefaultResolutionChain({
      resolvers: [new DbScopeResolver("workspace", store)],
      sources: [new DbSecretSource(store, encryptor)],
      priority: PRIORITY,
    });
    const auditLogger = recordingAuditLogger();
    const resolver = new DefaultCredentialResolver({
      chain,
      auditLogger,
      defaultActor: "svc-orchestrator",
    });

    await resolver.resolve("groq", tenant);

    expect(auditLogger.events).toHaveLength(1);
    expect(auditLogger.events[0]).toMatchObject({
      type: "resolve",
      actor: "svc-orchestrator",
      scope: "workspace",
      provider: "groq",
      outcome: "success",
    });
  });

  it("throws CREDENTIAL_NOT_FOUND when the chain finds nothing, and audit-logs the failure", async () => {
    const chain = new DefaultResolutionChain({ resolvers: [], sources: [], priority: PRIORITY });
    const auditLogger = recordingAuditLogger();
    const resolver = new DefaultCredentialResolver({ chain, auditLogger });

    await expect(resolver.resolve("groq", tenant)).rejects.toMatchObject({
      code: "CREDENTIAL_NOT_FOUND",
    });
    expect(auditLogger.events).toHaveLength(1);
    expect(auditLogger.events[0]?.outcome).toBe("failure");
  });

  it("does not leak which scope failed in the thrown error's message (architecture §19.1)", async () => {
    const chain = new DefaultResolutionChain({ resolvers: [], sources: [], priority: PRIORITY });
    const resolver = new DefaultCredentialResolver({ chain, auditLogger: recordingAuditLogger() });

    try {
      await resolver.resolve("groq", tenant);
      expect.unreachable("expected resolve() to throw");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toMatch(/user|project|workspace|organization|platform/i);
    }
  });

  it("redacts an unexpected (non-credential-specific) chain error to a generic INTERNAL_ERROR, while the audit log keeps the full detail", async () => {
    // Regression test for the EM-2 review's Medium finding: this path
    // previously re-threw `error` verbatim (`rejects.toThrow("chain exploded")`),
    // leaking the raw exception message to the caller. It now redacts to a
    // generic, code-appropriate message — consistent with the "chain
    // returned null" path below — while the audit log (an operator-facing
    // record, not a caller-facing one) still receives the original detail.
    const chain = {
      resolve: vi.fn().mockRejectedValue(new Error("chain exploded")),
    };
    const auditLogger = recordingAuditLogger();
    const resolver = new DefaultCredentialResolver({ chain, auditLogger });

    await expect(resolver.resolve("groq", tenant)).rejects.toMatchObject({
      name: "GatewayError",
      code: "INTERNAL_ERROR",
      message: "Credential resolution failed unexpectedly.",
    });
    // The raw detail must NOT reach the caller...
    await expect(resolver.resolve("groq", tenant)).rejects.not.toThrow("chain exploded");
    // ...but must still be in the audit log, for operators/diagnostics.
    expect(auditLogger.events).toHaveLength(2);
    expect(auditLogger.events[0]?.outcome).toBe("failure");
    expect(auditLogger.events[0]?.detail).toContain("chain exploded");
  });

  it("redacts a credential-specific chain error (e.g. a SecretSource failure) to the same generic CREDENTIAL_NOT_FOUND the 'no result' path uses", async () => {
    // Regression test for the EM-2 review's Medium finding: a
    // `SecretSource`/`ScopeResolver` failure deeper in the chain (e.g. an
    // unset env var, a deleted DB row) previously propagated its specific
    // message (a row ID, an env var name) verbatim. It's now
    // indistinguishable, from the caller's perspective, from the "no scope
    // matched" case — one consistent redaction strategy across both
    // failure paths.
    const chain = {
      resolve: vi
        .fn()
        .mockRejectedValue(
          new GatewayError(
            "CREDENTIAL_NOT_FOUND",
            'No credential row with id "super-secret-row-id-42".',
            false,
          ),
        ),
    };
    const auditLogger = recordingAuditLogger();
    const resolver = new DefaultCredentialResolver({ chain, auditLogger });

    await expect(resolver.resolve("groq", tenant)).rejects.toMatchObject({
      code: "CREDENTIAL_NOT_FOUND",
      message: 'No credential available for provider "groq".',
    });
    await expect(resolver.resolve("groq", tenant)).rejects.not.toThrow("super-secret-row-id-42");
    // The audit log still captures the row ID for operators.
    expect(auditLogger.events[0]?.detail).toContain("super-secret-row-id-42");
  });

  it("redacts a CREDENTIAL_INVALID chain error (e.g. a decryption failure) the same way", async () => {
    const chain = {
      resolve: vi
        .fn()
        .mockRejectedValue(
          new GatewayError("CREDENTIAL_INVALID", "Failed to decrypt credential row.", false),
        ),
    };
    const auditLogger = recordingAuditLogger();
    const resolver = new DefaultCredentialResolver({ chain, auditLogger });

    await expect(resolver.resolve("groq", tenant)).rejects.toMatchObject({
      code: "CREDENTIAL_NOT_FOUND",
      message: 'No credential available for provider "groq".',
    });
  });

  it("both redacted failure paths (no result vs. chain threw) now produce byte-identical caller-facing errors", async () => {
    // The review's Required Change 2 asks for "one consistent redaction
    // strategy" — this test proves the two paths converge exactly, not
    // just similarly.
    const nullChain = { resolve: vi.fn().mockResolvedValue(null) };
    const throwingChain = {
      resolve: vi
        .fn()
        .mockRejectedValue(new GatewayError("CREDENTIAL_NOT_FOUND", "some internal detail", false)),
    };
    const resolverA = new DefaultCredentialResolver({
      chain: nullChain,
      auditLogger: recordingAuditLogger(),
    });
    const resolverB = new DefaultCredentialResolver({
      chain: throwingChain,
      auditLogger: recordingAuditLogger(),
    });

    let errorA: GatewayError | undefined;
    let errorB: GatewayError | undefined;
    try {
      await resolverA.resolve("groq", tenant);
    } catch (e) {
      errorA = e as GatewayError;
    }
    try {
      await resolverB.resolve("groq", tenant);
    } catch (e) {
      errorB = e as GatewayError;
    }

    expect(errorA?.code).toBe(errorB?.code);
    expect(errorA?.message).toBe(errorB?.message);
    expect(errorA?.retryable).toBe(errorB?.retryable);
  });
});

describe("registerCredential", () => {
  it("encrypts the plaintext key before it reaches the store", async () => {
    const store = new InMemoryCredentialStore();
    const encryptor = new AesGcmEncryptor(generateEncryptionKey());
    const auditLogger = recordingAuditLogger();

    const result = await registerCredential(store, encryptor, auditLogger, {
      scope: "workspace",
      provider: "groq",
      tenant,
      plaintextKey: "sk-byok-plaintext",
      actor: "user-a",
    });

    const row = await store.getById(result.rowId);
    expect(row?.encryptedKey).not.toBe("sk-byok-plaintext");
    expect(encryptor.decrypt(row!.encryptedKey)).toBe("sk-byok-plaintext");
  });

  it("records a register audit event without the plaintext key", async () => {
    const store = new InMemoryCredentialStore();
    const encryptor = new AesGcmEncryptor(generateEncryptionKey());
    const auditLogger = recordingAuditLogger();

    await registerCredential(store, encryptor, auditLogger, {
      scope: "workspace",
      provider: "groq",
      tenant,
      plaintextKey: "sk-byok-plaintext",
      actor: "user-a",
    });

    expect(auditLogger.events).toHaveLength(1);
    expect(auditLogger.events[0]).toMatchObject({
      type: "register",
      actor: "user-a",
      scope: "workspace",
      provider: "groq",
      outcome: "success",
    });
    expect(JSON.stringify(auditLogger.events[0])).not.toContain("sk-byok-plaintext");
  });

  it("records a failure audit event when the store rejects (e.g. missing tenant field)", async () => {
    const store = new InMemoryCredentialStore();
    const encryptor = new AesGcmEncryptor(generateEncryptionKey());
    const auditLogger = recordingAuditLogger();

    await expect(
      registerCredential(store, encryptor, auditLogger, {
        scope: "workspace",
        provider: "groq",
        tenant: { organizationId: "org-a" }, // no workspaceId
        plaintextKey: "sk-byok-plaintext",
        actor: "user-a",
      }),
    ).rejects.toThrow(RangeError);

    expect(auditLogger.events).toHaveLength(1);
    expect(auditLogger.events[0]?.outcome).toBe("failure");
  });

  it("the registered credential is then resolvable through a DbScopeResolver for the same tenant", async () => {
    const store = new InMemoryCredentialStore();
    const encryptor = new AesGcmEncryptor(generateEncryptionKey());
    const auditLogger = recordingAuditLogger();

    await registerCredential(store, encryptor, auditLogger, {
      scope: "workspace",
      provider: "groq",
      tenant,
      plaintextKey: "sk-byok-plaintext",
      actor: "user-a",
    });

    const resolver = new DbScopeResolver("workspace", store);
    const ref = await resolver.lookup("groq", tenant);
    expect(ref).not.toBeNull();

    const source = new DbSecretSource(store, encryptor);
    expect(await source.fetch(ref!)).toBe("sk-byok-plaintext");
  });
});
