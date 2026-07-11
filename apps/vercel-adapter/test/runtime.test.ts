import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VALID_ENV = {
  GATEWAY_API_KEYS_JSON: JSON.stringify([
    { apiKey: "k1", tenant: { organizationId: "org-1" }, role: "member" },
  ]),
};

let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = { ...process.env };
  vi.resetModules();
});

afterEach(() => {
  process.env = originalEnv;
});

describe("runtime.getWarmInstance (warm-instance bootstrap + router singleton)", () => {
  it("bootstraps once and reuses the same GatewayApp and Router across calls", async () => {
    process.env = { ...process.env, ...VALID_ENV };
    const { getWarmInstance } = await import("../src/runtime.js");

    const first = await getWarmInstance();
    const second = await getWarmInstance();

    expect(second.app).toBe(first.app);
    expect(second.router).toBe(first.router);
  });

  it("does not permanently cache a failed bootstrap: a later call gets a fresh attempt", async () => {
    process.env = { ...process.env, GATEWAY_API_KEYS_JSON: "" };
    const { getWarmInstance } = await import("../src/runtime.js");

    await expect(getWarmInstance()).rejects.toThrow();

    // A later invocation on this same warm instance — after, say, an
    // operator fixes the environment and redeploys — must get a real
    // chance to bootstrap rather than replaying the same stale rejection
    // forever.
    process.env = { ...process.env, ...VALID_ENV };
    await expect(getWarmInstance()).resolves.toBeDefined();
  });
});
