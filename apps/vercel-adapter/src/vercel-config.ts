import { z } from "zod";
import { CREDENTIAL_SCOPES, type CredentialScope } from "@ai-gateway/config";
import { ROLES, type ApiKeyRecord, type Role } from "@ai-gateway/middleware";
import type { GatewayRuntimeConfig } from "@ai-gateway/gateway-runtime";

/**
 * `apps/vercel-adapter`'s own bootstrap-level configuration loader — the
 * Vercel counterpart of `apps/gateway-server/src/server-config.ts`. Both
 * apps load and validate `process.env` independently (environment-
 * variable surface is itself a hosting-layer concern: naming, defaults,
 * and validation for *this app's own env vars* is not part of what
 * `@ai-gateway/gateway-runtime` shares — see that package's README), but
 * every recognized variable name/default/validation rule here is
 * identical to `apps/gateway-server`'s, so an operator migrating a Node
 * deployment's environment to a Vercel Project's Environment Variables
 * carries the values over unchanged.
 *
 * The result is exactly `@ai-gateway/gateway-runtime`'s
 * `GatewayRuntimeConfig` — no Vercel-specific extension of it exists (there
 * is, deliberately, no `http: { host, port }` section here, unlike
 * `apps/gateway-server`'s `GatewayServerConfig`: `bootstrap()` never reads
 * one, and Vercel owns request routing entirely, so there is nothing
 * Vercel-specific to add to the shared shape). If a genuinely
 * Vercel-specific config field is ever needed, that is the point to
 * introduce a distinct `VercelAdapterConfig extends GatewayRuntimeConfig`
 * — not before.
 */

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

/** Thrown for any missing/invalid startup configuration. Always caught by `runtime.ts` on the first invocation of a cold instance and reported as a 500 rather than left to surface as an unhandled rejection — the Vercel-instance analogue of `GatewayServerConfigError` (never left to crash a listening process, since there is no listening process here to crash). */
export class VercelAdapterConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VercelAdapterConfigError";
  }
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value === "") {
    throw new VercelAdapterConfigError(
      `Required environment variable "${name}" is not set. Refusing to serve requests with an incomplete configuration.`,
    );
  }
  return value;
}

function parseJsonEnv(env: NodeJS.ProcessEnv, name: string): unknown {
  const raw = requireEnv(env, name);
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new VercelAdapterConfigError(
      `Environment variable "${name}" is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Loads and validates every `GatewayRuntimeConfig` field from `process.env`.
 * Throws {@link VercelAdapterConfigError} on the first missing/invalid
 * value — called lazily by `runtime.ts` on a cold instance's first
 * invocation, mirroring `apps/gateway-server`'s "fail fast, before serving
 * any request" posture as closely as a platform-managed instance allows.
 *
 * Recognized variables (identical names/defaults/semantics to
 * `apps/gateway-server`'s loader, `http`'s `HOST`/`PORT` excepted — see
 * this file's top-level doc comment):
 * - `GATEWAY_CONFIG_PATH` (optional)
 * - `GROQ_PLATFORM_API_KEY_ENV_VAR` (default `"GROQ_PLATFORM_API_KEY"`)
 * - `NVIDIA_NIM_PLATFORM_API_KEY_ENV_VAR` (default `"NVIDIA_NIM_PLATFORM_API_KEY"`)
 * - `CREDENTIAL_PRIORITY` (optional, comma-separated)
 * - `GATEWAY_API_KEYS_JSON` (required unless `GATEWAY_ALLOW_DEV_DEFAULTS=true`)
 * - `GATEWAY_ALLOW_DEV_DEFAULTS` (`"true"` to fall back to a single,
 *   clearly-insecure development API key, `dev-local-only-insecure-key`)
 * - `RATE_LIMIT_REQUESTS_PER_WINDOW`, `RATE_LIMIT_WINDOW_MS` (optional ints)
 * - `CACHE_TTL_MS` (optional int), `CACHE_INCLUDE_TENANT` (optional
 *   `"true"`/`"false"`, default `true`)
 */
export function loadVercelConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): GatewayRuntimeConfig {
  const groqEnvVarName = env.GROQ_PLATFORM_API_KEY_ENV_VAR ?? "GROQ_PLATFORM_API_KEY";
  const nimEnvVarName = env.NVIDIA_NIM_PLATFORM_API_KEY_ENV_VAR ?? "NVIDIA_NIM_PLATFORM_API_KEY";

  const credentialPriorityParse = credentialPriorityEnvSchema.safeParse(env.CREDENTIAL_PRIORITY);
  if (!credentialPriorityParse.success) {
    throw new VercelAdapterConfigError(
      `CREDENTIAL_PRIORITY is invalid: ${credentialPriorityParse.error.message}`,
    );
  }

  let apiKeys: ApiKeyRecord[];
  if (env.GATEWAY_API_KEYS_JSON) {
    const parsedJson = parseJsonEnv(env, "GATEWAY_API_KEYS_JSON");
    const parsed = z.array(apiKeyRecordSchema).safeParse(parsedJson);
    if (!parsed.success) {
      throw new VercelAdapterConfigError(
        `GATEWAY_API_KEYS_JSON does not match the expected ApiKeyRecord[] shape: ${parsed.error.message}`,
      );
    }
    if (parsed.data.length === 0) {
      throw new VercelAdapterConfigError(
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
    throw new VercelAdapterConfigError(
      "GATEWAY_API_KEYS_JSON is required (a JSON array of { apiKey, tenant, role }). " +
        "Set GATEWAY_ALLOW_DEV_DEFAULTS=true to use a single insecure local development key instead.",
    );
  }

  return {
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

function parseOptionalPositiveInt(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new VercelAdapterConfigError(`${name} must be a positive integer, got "${value}".`);
  }
  return parsed;
}

function parseOptionalBool(value: string | undefined): boolean | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  if (value === "true") return true;
  if (value === "false") return false;
  throw new VercelAdapterConfigError(
    `CACHE_INCLUDE_TENANT must be "true" or "false", got "${value}".`,
  );
}
