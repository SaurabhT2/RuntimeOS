import { describe, expect, it } from "vitest";
import { GatewayServerConfigError, loadServerConfigFromEnv } from "../src/server-config.js";

const VALID_ENV: NodeJS.ProcessEnv = {
  GATEWAY_API_KEYS_JSON: JSON.stringify([
    { apiKey: "k1", tenant: { organizationId: "org-1" }, role: "member" },
  ]),
};

describe("loadServerConfigFromEnv", () => {
  it("applies documented defaults when only the required fields are set", () => {
    const config = loadServerConfigFromEnv(VALID_ENV);
    expect(config.http).toEqual({ host: "0.0.0.0", port: 3000 });
    expect(config.providerPlatformKeyEnvVars).toEqual({
      groq: "GROQ_PLATFORM_API_KEY",
      "nvidia-nim": "NVIDIA_NIM_PLATFORM_API_KEY",
    });
    expect(config.apiKeys).toHaveLength(1);
    expect(config.credentialPriority).toEqual([]);
    expect(config.gatewayConfigPath).toBeUndefined();
  });

  it("reads every overridable field from the environment", () => {
    const config = loadServerConfigFromEnv({
      ...VALID_ENV,
      HOST: "127.0.0.1",
      PORT: "8080",
      GATEWAY_CONFIG_PATH: "/etc/ai-gateway/config.json",
      GROQ_PLATFORM_API_KEY_ENV_VAR: "MY_GROQ_KEY",
      NVIDIA_NIM_PLATFORM_API_KEY_ENV_VAR: "MY_NIM_KEY",
      CREDENTIAL_PRIORITY: "user, platform",
      RATE_LIMIT_REQUESTS_PER_WINDOW: "10",
      RATE_LIMIT_WINDOW_MS: "1000",
      CACHE_TTL_MS: "5000",
      CACHE_INCLUDE_TENANT: "false",
    });
    expect(config.http).toEqual({ host: "127.0.0.1", port: 8080 });
    expect(config.gatewayConfigPath).toBe("/etc/ai-gateway/config.json");
    expect(config.providerPlatformKeyEnvVars).toEqual({
      groq: "MY_GROQ_KEY",
      "nvidia-nim": "MY_NIM_KEY",
    });
    expect(config.credentialPriority).toEqual(["user", "platform"]);
    expect(config.rateLimit).toEqual({ requestsPerWindow: 10, windowMs: 1000 });
    expect(config.cache).toEqual({ ttlMs: 5000, includeTenantInKey: false });
  });

  it("throws when GATEWAY_API_KEYS_JSON is missing and dev defaults are not allowed", () => {
    expect(() => loadServerConfigFromEnv({})).toThrow(GatewayServerConfigError);
  });

  it("falls back to a single insecure dev key when GATEWAY_ALLOW_DEV_DEFAULTS=true", () => {
    const config = loadServerConfigFromEnv({ GATEWAY_ALLOW_DEV_DEFAULTS: "true" });
    expect(config.apiKeys).toEqual([
      {
        apiKey: "dev-local-only-insecure-key",
        tenant: { organizationId: "dev-org" },
        role: "org_admin",
      },
    ]);
  });

  it("throws for malformed GATEWAY_API_KEYS_JSON (not JSON)", () => {
    expect(() => loadServerConfigFromEnv({ GATEWAY_API_KEYS_JSON: "{not json" })).toThrow(
      GatewayServerConfigError,
    );
  });

  it("throws for GATEWAY_API_KEYS_JSON that doesn't match ApiKeyRecord[]", () => {
    expect(() =>
      loadServerConfigFromEnv({ GATEWAY_API_KEYS_JSON: JSON.stringify([{ apiKey: "k1" }]) }),
    ).toThrow(GatewayServerConfigError);
  });

  it("throws for an empty GATEWAY_API_KEYS_JSON array", () => {
    expect(() => loadServerConfigFromEnv({ GATEWAY_API_KEYS_JSON: "[]" })).toThrow(
      GatewayServerConfigError,
    );
  });

  it("throws for a non-positive-integer PORT", () => {
    expect(() => loadServerConfigFromEnv({ ...VALID_ENV, PORT: "not-a-number" })).toThrow(
      GatewayServerConfigError,
    );
    expect(() => loadServerConfigFromEnv({ ...VALID_ENV, PORT: "-1" })).toThrow(
      GatewayServerConfigError,
    );
  });

  it("throws for an invalid CREDENTIAL_PRIORITY entry", () => {
    expect(() =>
      loadServerConfigFromEnv({ ...VALID_ENV, CREDENTIAL_PRIORITY: "not-a-real-scope" }),
    ).toThrow(GatewayServerConfigError);
  });

  it("throws for a non-boolean CACHE_INCLUDE_TENANT", () => {
    expect(() => loadServerConfigFromEnv({ ...VALID_ENV, CACHE_INCLUDE_TENANT: "maybe" })).toThrow(
      GatewayServerConfigError,
    );
  });

  it("throws for a non-positive-integer RATE_LIMIT_REQUESTS_PER_WINDOW", () => {
    expect(() =>
      loadServerConfigFromEnv({ ...VALID_ENV, RATE_LIMIT_REQUESTS_PER_WINDOW: "0" }),
    ).toThrow(GatewayServerConfigError);
  });
});
