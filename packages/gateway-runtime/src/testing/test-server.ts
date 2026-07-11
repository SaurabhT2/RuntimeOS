import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { bootstrap, type BootstrapOverrides, type GatewayApp } from "../bootstrap.js";
import { buildGatewayRouter, dispatchGatewayRequest } from "../dispatch.js";
import { fakeAdapter, TEST_MODEL_SEED, testRuntimeConfig } from "./fixtures.js";
import type { GatewayRuntimeConfig } from "../bootstrap.js";

export interface TestDispatchServer {
  app: GatewayApp;
  baseUrl: string;
  close: () => Promise<void>;
}

/**
 * Boots a real `GatewayApp` via the real `bootstrap()` (never a hand-rolled
 * test double for the composition root itself) with fake, in-memory
 * provider adapters, then wraps `dispatchGatewayRequest` in a real,
 * ephemeral `node:http` server so tests can drive it with real `fetch()`
 * calls.
 *
 * This `createServer`/`.listen()` call is test-only scaffolding — it
 * exists so this package's own test suite, and both hosting layers'
 * `test/integration/end-to-end.test.ts` suites, can assert the exact same
 * HTTP-level behavior the exact same way. Production code never calls
 * `createServer`/`.listen()` from this package; `apps/gateway-server`'s
 * *own* production `createServer`/`.listen()` call lives entirely in that
 * app's `http/server.ts`/`index.ts`, not here.
 */
export async function startTestDispatchServer(
  configOverrides: Partial<GatewayRuntimeConfig> = {},
  bootstrapOverrides: BootstrapOverrides = {},
): Promise<TestDispatchServer> {
  process.env.TEST_GROQ_PLATFORM_API_KEY ??= "test-platform-key-groq";
  process.env.TEST_NIM_PLATFORM_API_KEY ??= "test-platform-key-nim";

  const app = await bootstrap(testRuntimeConfig(configOverrides), {
    adapters: bootstrapOverrides.adapters ?? [
      fakeAdapter({ id: "groq" }),
      fakeAdapter({ id: "nvidia-nim" }),
    ],
    modelRegistrySeed: bootstrapOverrides.modelRegistrySeed ?? TEST_MODEL_SEED,
  });

  const router = buildGatewayRouter(app);
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    dispatchGatewayRequest(router, req, res, path).catch((error: unknown) => {
      if (!res.headersSent) res.writeHead(500);
      if (!res.writableEnded) res.end(String(error));
    });
  });

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
