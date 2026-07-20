/**
 * Environment-variable loader for `runtime-studio`. Deliberately small —
 * this app proxies to an *already-running* gateway instance, it doesn't
 * construct one (contrast with `apps/gateway-server/src/server-config.ts`,
 * which builds a full `GatewayRuntimeConfig`). There is no
 * `GatewayRuntimeConfig` here at all: this app has no workspace
 * dependency on `@ai-gateway/gateway-runtime` or any platform package —
 * see this package's README, "Why this app has zero @ai-gateway/*
 * dependencies."
 */

export class StudioConfigError extends Error {}

export interface StudioConfig {
  /** This process's own listen host/port — the Studio UI itself. */
  http: {
    host: string;
    port: number;
  };
  /**
   * The target gateway instance this Studio proxies every request to.
   * No default — an operator must point this at a real, running gateway
   * (their own `apps/gateway-server`, `apps/vercel-adapter` deployment,
   * or a custom composition root). Never simulated or mocked.
   */
  gatewayUrl: string;
  /**
   * The API key sent to the target gateway on the Studio's behalf.
   * Deliberately never sent to the browser — see `src/proxy.ts`. A
   * caller using the Studio UI never sees or supplies this key directly;
   * they authenticate to the Studio process itself only if
   * `STUDIO_ACCESS_KEY` (below) is set.
   */
  gatewayApiKey: string;
  /**
   * Optional. If set, every request to this Studio's own HTTP surface
   * (not the proxied gateway calls) must present this key as
   * `x-studio-key`. Unset by default, since this app is meant to run
   * locally or behind your own access control — see this package's
   * README, "Deployment and access control," before exposing this
   * publicly without setting it.
   */
  studioAccessKey?: string;
}

function parsePort(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new StudioConfigError(`${name} must be an integer port between 1 and 65535, got: ${raw}`);
  }
  return parsed;
}

export function loadStudioConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StudioConfig {
  const gatewayUrl = env.GATEWAY_URL;
  if (!gatewayUrl) {
    throw new StudioConfigError(
      "GATEWAY_URL is required — point it at a running gateway instance, " +
        "e.g. GATEWAY_URL=http://localhost:3000. This Studio never simulates " +
        "gateway behavior; it always proxies to a real instance.",
    );
  }
  try {
    // eslint-disable-next-line no-new -- validation only, the URL object itself is discarded
    new URL(gatewayUrl);
  } catch {
    throw new StudioConfigError(`GATEWAY_URL is not a valid URL: ${gatewayUrl}`);
  }

  const gatewayApiKey = env.GATEWAY_API_KEY;
  if (!gatewayApiKey) {
    throw new StudioConfigError(
      "GATEWAY_API_KEY is required — the key this Studio authenticates to " +
        "GATEWAY_URL with on your behalf (see apps/gateway-server's README " +
        "for how to configure one on the target gateway).",
    );
  }

  return {
    http: {
      host: env.STUDIO_HOST ?? "0.0.0.0",
      port: parsePort(env.STUDIO_PORT, "STUDIO_PORT", 4000),
    },
    gatewayUrl: gatewayUrl.replace(/\/$/, ""),
    gatewayApiKey,
    studioAccessKey: env.STUDIO_ACCESS_KEY,
  };
}
