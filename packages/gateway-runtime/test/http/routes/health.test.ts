import { afterEach, describe, expect, it } from "vitest";
import { fakeAdapter } from "../../../src/testing/fixtures.js";
import {
  startTestDispatchServer,
  type TestDispatchServer,
} from "../../../src/testing/test-server.js";

let server: TestDispatchServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("GET /v1/health", () => {
  it("reports ok with every provider healthy", async () => {
    server = await startTestDispatchServer();
    const res = await fetch(`${server.baseUrl}/v1/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(
      body.providers.sort((a: { providerId: string }, b: { providerId: string }) =>
        a.providerId.localeCompare(b.providerId),
      ),
    ).toEqual([
      expect.objectContaining({ providerId: "groq", healthy: true }),
      expect.objectContaining({ providerId: "nvidia-nim", healthy: true }),
    ]);
  });

  it("reports degraded (still 200) when exactly one provider is unhealthy", async () => {
    server = await startTestDispatchServer(
      {},
      {
        adapters: [
          fakeAdapter({ id: "groq" }),
          fakeAdapter({ id: "nvidia-nim", behavior: "unhealthy" }),
        ],
      },
    );
    const res = await fetch(`${server.baseUrl}/v1/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("degraded");
  });

  it("reports unhealthy (503) when every provider is unhealthy", async () => {
    server = await startTestDispatchServer(
      {},
      {
        adapters: [
          fakeAdapter({ id: "groq", behavior: "unhealthy" }),
          fakeAdapter({ id: "nvidia-nim", behavior: "unhealthy" }),
        ],
      },
    );
    const res = await fetch(`${server.baseUrl}/v1/health`);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("unhealthy");
  });

  it("does not require an API key", async () => {
    server = await startTestDispatchServer();
    const res = await fetch(`${server.baseUrl}/v1/health`);
    expect(res.status).not.toBe(401);
  });

  it("never lets a per-provider healthCheck exception take down the whole route", async () => {
    const throwingAdapter = fakeAdapter({ id: "groq" });
    throwingAdapter.healthCheck = async () => {
      throw new Error("simulated network error");
    };
    server = await startTestDispatchServer(
      {},
      { adapters: [throwingAdapter, fakeAdapter({ id: "nvidia-nim" })] },
    );
    const res = await fetch(`${server.baseUrl}/v1/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("degraded");
    const groqEntry = body.providers.find((p: { providerId: string }) => p.providerId === "groq");
    expect(groqEntry.healthy).toBe(false);
    expect(groqEntry.message).toContain("simulated network error");
  });
});
