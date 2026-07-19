import { describe, expect, it } from "vitest";
import { GatewayError } from "@ai-gateway/core-contracts";
import { DefaultTimeoutManager } from "../src/timeout-manager.js";

describe("DefaultTimeoutManager", () => {
  it("resolves with the work's value when it settles before the deadline", async () => {
    const manager = new DefaultTimeoutManager();
    const result = await manager.withTimeout(Promise.resolve("done"), 1000);
    expect(result).toBe("done");
  });

  it("propagates the work's rejection when it rejects before the deadline", async () => {
    const manager = new DefaultTimeoutManager();
    const err = new Error("boom");
    await expect(manager.withTimeout(Promise.reject(err), 1000)).rejects.toBe(err);
  });

  it("rejects with a GatewayError(TIMEOUT) when the deadline elapses first", async () => {
    const manager = new DefaultTimeoutManager();
    const neverSettles = new Promise<string>(() => {
      /* intentionally never resolves */
    });

    await expect(manager.withTimeout(neverSettles, 10)).rejects.toMatchObject({
      name: "GatewayError",
      code: "TIMEOUT",
      retryable: true,
    });
  });

  it("produces a real GatewayError instance on timeout", async () => {
    const manager = new DefaultTimeoutManager();
    const neverSettles = new Promise<string>(() => undefined);

    try {
      await manager.withTimeout(neverSettles, 5);
      expect.unreachable("expected withTimeout to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(GatewayError);
    }
  });

  it("rejects for a non-positive timeoutMs before racing anything", async () => {
    const manager = new DefaultTimeoutManager();
    await expect(manager.withTimeout(Promise.resolve("x"), 0)).rejects.toThrow(RangeError);
    await expect(manager.withTimeout(Promise.resolve("x"), -5)).rejects.toThrow(RangeError);
  });
});
