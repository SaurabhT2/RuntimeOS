import { z } from "zod";
import { CREDENTIAL_SCOPES, type CredentialScope } from "@ai-gateway/config";
import { ROLES, type ApiKeyRecord, type Role } from "@ai-gateway/middleware";

/**
 * `apps/gateway-server`'s own bootstrap-level configuration — distinct
 * from `@ai-gateway/config`'s `GatewayConfig` (architecture §10.6, frozen
 * EM-1). `GatewayConfig` covers tenant/admin-facing routing/reliability
 * policy; it has no section for *this process's* own concerns (listen
 * address, which env var holds which provider's platform key, API-key
 * records, rate-limit/cache tuning) — the same gap ADR-0006 (`policy-engine`)
 * and ADR-0009 (`middleware`) already documented one layer down. Per both
 * ADRs' own resolution ("a future composition root would populate these
 * same constructor options from an extended config schema"), this file
 * *is* that composition root, and these are exactly the constructor
 * options ADR-0009 anticipated — not a `GatewayConfig` schema change.
 *
 * Every field is loaded from `process.env` and validated with Zod at
 * startup: an invalid or missing required value throws before the server
 * ever starts listening (fail-fast, no silent configuration failure).
 */

export interface GatewayServerConfig {
  http: {
    host: string;
    port: number;
  };
  /** Optional path to a `GatewayConfig` JSON file (`@ai-gateway/config`'s `FileConfigSource`). Falls back to `DEFAULT_GATEWAY_CONFIG` plus hot-reload disabled when omitted. */
  gatewayConfigPath?: string;
  /**
   * Which environment variable holds each provider's platform-managed API
   * key (`PlatformScopeResolver`'s own constructor shape, architecture
   * §16.1 — "deliberately explicit rather than a naming convention").
   * Both `groq` and `nvidia-nim` are required: EM-4's chaos-failover
   * acceptance criterion (both real adapters registered and failover-
   * capable) cannot hold with only one provider configured.
   */
  providerPlatformKeyEnvVars: {
    groq: string;
    "nvidia-nim": string;
  };
  credentialPriority: CredentialScope[];
  apiKeys: ApiKeyRecord[];
  rateLimit: {
    requestsPerWindow?: number;
    windowMs?: number;
  };
  cache: {
    ttlMs?: number;
    includeTenantInKey?: boolean;
  };
}

const apiKeyRecordSchema: z.ZodType<ApiKeyRecord> = z.object({
  apiKey: z.string().min(1),
  tenant: z.object({
    organizationId: z.string().min(1),
    workspaceId: z.string().optional(),
    projectId: z.string().optional(),
    userId: z.string().optional(),
  }),
  role: z.enum(ROLES as unknown as [Role, ...Role[]]),
});

const credentialPriorityEnvSchema = z
  .string()
  .optional()
  .transform((value) => (value ? value.split(",").map((s) => s.trim()) : undefined))
  .pipe(
    z
      .array(z.enum(CREDENTIAL_SCOPES as unknown as [CredentialScope, ...CredentialScope[]]))
      .optional(),
  );

/** Thrown for any missing/invalid startup configuration — always caught at `index.ts`'s top level and reported before process exit, never left to surface as an unhandled rejection. */
export class GatewayServerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayServerConfigError";
  }
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value === "") {
    throw new GatewayServerConfigError(
      `Required environment variable "${name}" is not set. Refusing to start with an incomplete configuration.`,
    );
  }
  return value;
}

function parseJsonEnv(env: NodeJS.ProcessEnv, name: string): unknown {
  const raw = requireEnv(env, name);
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new GatewayServerConfigError(
      `Environment variable "${name}" is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Loads and validates every `GatewayServerConfig` field from `process.env`.
 * Throws {@link GatewayServerConfigError} — synchronously, before any
 * network listener is opened — on the first missing/invalid value, per
 * this milestone's "no silent configuration failures, fail-fast" mandate.
 *
 * Recognized variables:
 * - `HOST` (default `"0.0.0.0"`)
 * - `PORT` (default `3000`)
 * - `GATEWAY_CONFIG_PATH` (optional)
 * - `GROQ_PLATFORM_API_KEY_ENV_VAR` (default `"GROQ_PLATFORM_API_KEY"`) —
 *   the *name* of the env var holding the actual key, matching
 *   `PlatformScopeResolver`'s own indirection; the actual key env var
 *   itself is read later, by `credential-resolver`'s `EnvSecretSource`,
 *   not by this loader.
 * - `NVIDIA_NIM_PLATFORM_API_KEY_ENV_VAR` (default `"NVIDIA_NIM_PLATFORM_API_KEY"`)
 * - `CREDENTIAL_PRIORITY` (optional, comma-separated; defaults to
 *   `DEFAULT_GATEWAY_CONFIG.credentialPriority` if omitted — resolved by
 *   the caller, not here, since that default lives in `@ai-gateway/config`)
 * - `GATEWAY_API_KEYS_JSON` (required unless `GATEWAY_ALLOW_DEV_DEFAULTS=true`) —
 *   a JSON array of `{ apiKey, tenant, role }` records.
 * - `GATEWAY_ALLOW_DEV_DEFAULTS` — set to `"true"` to fall back to a
 *   single, clearly-insecure development API key
 *   (`dev-local-only-insecure-key`) when `GATEWAY_API_KEYS_JSON` is unset.
 *   A loud warning is logged by the caller when this path is taken (see
 *   `bootstrap.ts`). Never defaults silently.
 * - `RATE_LIMIT_REQUESTS_PER_WINDOW`, `RATE_LIMIT_WINDOW_MS` (optional ints)
 * - `CACHE_TTL_MS` (optional int), `CACHE_INCLUDE_TENANT` (optional
 *   `"true"`/`"false"`, default `true`)
 */
export function loadServerConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GatewayServerConfig {
  const host = env.HOST ?? "0.0.0.0";
  const port = parsePositiveInt(env.PORT, 3000, "PORT");

  const groqEnvVarName = env.GROQ_PLATFORM_API_KEY_ENV_VAR ?? "GROQ_PLATFORM_API_KEY";
  const nimEnvVarName = env.NVIDIA_NIM_PLATFORM_API_KEY_ENV_VAR ?? "NVIDIA_NIM_PLATFORM_API_KEY";

  const credentialPriorityParse = credentialPriorityEnvSchema.safeParse(env.CREDENTIAL_PRIORITY);
  if (!credentialPriorityParse.success) {
    throw new GatewayServerConfigError(
      `CREDENTIAL_PRIORITY is invalid: ${credentialPriorityParse.error.message}`,
    );
  }

  let apiKeys: ApiKeyRecord[];
  if (env.GATEWAY_API_KEYS_JSON) {
    const parsedJson = parseJsonEnv(env, "GATEWAY_API_KEYS_JSON");
    const parsed = z.array(apiKeyRecordSchema).safeParse(parsedJson);
    if (!parsed.success) {
      throw new GatewayServerConfigError(
        `GATEWAY_API_KEYS_JSON does not match the expected ApiKeyRecord[] shape: ${parsed.error.message}`,
      );
    }
    if (parsed.data.length === 0) {
      throw new GatewayServerConfigError(
        "GATEWAY_API_KEYS_JSON must contain at least one API key record.",
      );
    }
    apiKeys = parsed.data;
  } else if (env.GATEWAY_ALLOW_DEV_DEFAULTS === "true") {
    apiKeys = [
      {
        apiKey: "dev-local-only-insecure-key",
        tenant: { organizationId: "dev-org" },
        role: "org_admin",
      },
    ];
  } else {
    throw new GatewayServerConfigError(
      "GATEWAY_API_KEYS_JSON is required (a JSON array of { apiKey, tenant, role }). " +
        "Set GATEWAY_ALLOW_DEV_DEFAULTS=true to use a single insecure local development key instead.",
    );
  }

  return {
    http: { host, port },
    gatewayConfigPath: env.GATEWAY_CONFIG_PATH,
    providerPlatformKeyEnvVars: {
      groq: groqEnvVarName,
      "nvidia-nim": nimEnvVarName,
    },
    credentialPriority: credentialPriorityParse.data ?? [],
    apiKeys,
    rateLimit: {
      requestsPerWindow: parseOptionalPositiveInt(
        env.RATE_LIMIT_REQUESTS_PER_WINDOW,
        "RATE_LIMIT_REQUESTS_PER_WINDOW",
      ),
      windowMs: parseOptionalPositiveInt(env.RATE_LIMIT_WINDOW_MS, "RATE_LIMIT_WINDOW_MS"),
    },
    cache: {
      ttlMs: parseOptionalPositiveInt(env.CACHE_TTL_MS, "CACHE_TTL_MS"),
      includeTenantInKey: parseOptionalBool(env.CACHE_INCLUDE_TENANT),
    },
  };
}

function parsePositiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new GatewayServerConfigError(`${name} must be a positive integer, got "${value}".`);
  }
  return parsed;
}

function parseOptionalPositiveInt(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new GatewayServerConfigError(`${name} must be a positive integer, got "${value}".`);
  }
  return parsed;
}

function parseOptionalBool(value: string | undefined): boolean | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  if (value === "true") return true;
  if (value === "false") return false;
  throw new GatewayServerConfigError(
    `CACHE_INCLUDE_TENANT must be "true" or "false", got "${value}".`,
  );
}
