export {
  fakeTelemetry,
  fakeAdapter,
  fakeSlowStreamAdapter,
  TEST_MODEL_SEED,
} from "@ai-gateway/gateway-runtime/testing";
import { testRuntimeConfig } from "@ai-gateway/gateway-runtime/testing";
import type { GatewayServerConfig } from "../src/server-config.js";

/**
 * `apps/gateway-server`'s own test config, extending the shared
 * `testRuntimeConfig()` (`@ai-gateway/gateway-runtime/testing`) with
 * exactly the one field that's local to this app: `http` (listen
 * address/port — `bootstrap()` never reads it; see `server-config.ts`'s
 * doc comment). Every provider-adapter fake and model seed used by this
 * app's tests is the shared package's own — not a second, divergent copy.
 */
export function testServerConfig(
  overrides: Partial<GatewayServerConfig> = {},
): GatewayServerConfig {
  return {
    ...testRuntimeConfig(overrides),
    http: { host: "127.0.0.1", port: 0 },
    ...overrides,
  };
}
