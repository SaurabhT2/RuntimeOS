import type { AddressInfo } from "node:net";
import { bootstrap, type BootstrapOverrides, type GatewayApp } from "@ai-gateway/gateway-runtime";
import { createHttpServer } from "../src/http/server.js";
import { fakeAdapter, TEST_MODEL_SEED, testServerConfig } from "./fixtures.js";
import type { GatewayServerConfig } from "../src/server-config.js";

export interface TestServer {
  app: GatewayApp;
  baseUrl: string;
  close: () => Promise<void>;
}

/**
 * Boots a real `GatewayApp` (the actual `bootstrap()` composition root —
 * not a hand-rolled test double of it) with fake, in-memory provider
 * adapters, then starts a real `node:http` server listening on an
 * OS-assigned ephemeral port (`port: 0`). Every route/integration test in
 * this directory talks to this server over real HTTP, exactly like
 * `examples/minimal-node-client` and `examples/streaming-client` do
 * against a real deployment — the only substitution anywhere in this path
 * is the two provider adapters (never a live network call in a test run,
 * matching this codebase's established convention).
 */
export async function startTestServer(
  serverConfigOverrides: Partial<GatewayServerConfig> = {},
  bootstrapOverrides: BootstrapOverrides = {},
): Promise<TestServer> {
  // `PlatformScopeResolver`/`EnvSecretSource` read these real env vars at
  // resolve time regardless of which adapter is faked — set to a
  // throwaway value so credential resolution succeeds against the fake
  // adapters the same way it would against the real ones.
  process.env.TEST_GROQ_PLATFORM_API_KEY ??= "test-platform-key-groq";
  process.env.TEST_NIM_PLATFORM_API_KEY ??= "test-platform-key-nim";

  const app = await bootstrap(testServerConfig(serverConfigOverrides), {
    adapters: bootstrapOverrides.adapters ?? [
      fakeAdapter({ id: "groq" }),
      fakeAdapter({ id: "nvidia-nim" }),
    ],
    modelRegistrySeed: bootstrapOverrides.modelRegistrySeed ?? TEST_MODEL_SEED,
  });
  const server = createHttpServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    app,
    baseUrl,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
