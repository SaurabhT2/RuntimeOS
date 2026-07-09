import { GatewayError } from "@ai-gateway/core-contracts";
import type { CredentialReference, SecretSource } from "../types.js";
import { parseCredentialReference } from "../types.js";

export const ENV_SECRET_SOURCE_ID = "env";

/**
 * architecture §15.3: "`env` (for platform-managed dev/self-host keys)."
 * The reference's `pointer` (the part after `env://`) is the environment
 * variable name to read — e.g. `env://GROQ_PLATFORM_API_KEY` reads
 * `process.env.GROQ_PLATFORM_API_KEY`. Never watches for changes: env vars
 * are fixed for a process's lifetime (same reasoning `@ai-gateway/config`'s
 * `EnvConfigSource` documents for its own `watch()`).
 */
export class EnvSecretSource implements SecretSource {
  public readonly id = ENV_SECRET_SOURCE_ID;

  fetch(reference: CredentialReference): Promise<string> {
    const parsed = parseCredentialReference(reference);
    if (!parsed || parsed.sourceId !== this.id) {
      return Promise.reject(
        new GatewayError(
          "CREDENTIAL_INVALID",
          `EnvSecretSource cannot dereference a reference outside its own scheme: ${reference}`,
          false,
        ),
      );
    }

    const value = process.env[parsed.pointer];
    if (value === undefined || value === "") {
      return Promise.reject(
        new GatewayError(
          "CREDENTIAL_NOT_FOUND",
          `Environment variable "${parsed.pointer}" is not set.`,
          false,
        ),
      );
    }
    return Promise.resolve(value);
  }
}
