import { describe, expect, it } from "vitest";
import { isGatewayError } from "@ai-gateway/core-contracts";
import { InMemoryProviderAdapterRegistry } from "../src/types.js";
import { fakeAdapter } from "./fixtures.js";

describe("InMemoryProviderAdapterRegistry", () => {
  it("resolves a registered adapter by its id", () => {
    const registry = new InMemoryProviderAdapterRegistry([fakeAdapter("groq")]);
    expect(registry.resolve("groq").id).toBe("groq");
  });

  it("accepts adapters via the constructor and via register()", () => {
    const registry = new InMemoryProviderAdapterRegistry([fakeAdapter("groq")]);
    registry.register(fakeAdapter("nvidia-nim"));
    expect(registry.resolve("groq").id).toBe("groq");
    expect(registry.resolve("nvidia-nim").id).toBe("nvidia-nim");
  });

  it("register() replaces an existing adapter for the same id", () => {
    const registry = new InMemoryProviderAdapterRegistry();
    const first = fakeAdapter("groq", {
      onInvoke: async () => {
        throw new Error("first");
      },
    });
    const second = fakeAdapter("groq");
    registry.register(first);
    registry.register(second);
    expect(registry.resolve("groq")).toBe(second);
  });

  it("unregister() removes an adapter", () => {
    const registry = new InMemoryProviderAdapterRegistry([fakeAdapter("groq")]);
    registry.unregister("groq");
    expect(() => registry.resolve("groq")).toThrow();
  });

  it("throws a non-retryable ALL_PROVIDERS_UNAVAILABLE GatewayError for an unregistered providerId", () => {
    const registry = new InMemoryProviderAdapterRegistry();
    try {
      registry.resolve("unknown");
      expect.unreachable();
    } catch (error) {
      expect(isGatewayError(error)).toBe(true);
      if (isGatewayError(error)) {
        expect(error.code).toBe("ALL_PROVIDERS_UNAVAILABLE");
        expect(error.retryable).toBe(false);
        expect(error.details).toMatchObject({ providerId: "unknown" });
      }
    }
  });
});
