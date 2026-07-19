import { describe, expect, it } from "vitest";
import { discoverPlugins } from "../src/discovery.js";

describe("discoverPlugins", () => {
  it("resolves a single-plugin source", async () => {
    const result = await discoverPlugins([() => ({ name: "a" })]);
    expect(result.plugins.map((p) => p.name)).toEqual(["a"]);
    expect(result.failures).toEqual([]);
  });

  it("resolves a multi-plugin (array) source", async () => {
    const result = await discoverPlugins([() => [{ name: "a" }, { name: "b" }]]);
    expect(result.plugins.map((p) => p.name)).toEqual(["a", "b"]);
  });

  it("resolves an async source", async () => {
    const result = await discoverPlugins([async () => ({ name: "async-plugin" })]);
    expect(result.plugins.map((p) => p.name)).toEqual(["async-plugin"]);
  });

  it("combines multiple sources in order", async () => {
    const result = await discoverPlugins([() => ({ name: "a" }), () => ({ name: "b" })]);
    expect(result.plugins.map((p) => p.name)).toEqual(["a", "b"]);
  });

  it("isolates a throwing source, still resolving the others", async () => {
    const result = await discoverPlugins([
      () => {
        throw new Error("boom");
      },
      () => ({ name: "survives" }),
    ]);
    expect(result.plugins.map((p) => p.name)).toEqual(["survives"]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.sourceIndex).toBe(0);
  });

  it("isolates a rejecting async source", async () => {
    const result = await discoverPlugins([
      async () => {
        throw new Error("async boom");
      },
      () => ({ name: "survives" }),
    ]);
    expect(result.plugins.map((p) => p.name)).toEqual(["survives"]);
    expect(result.failures).toHaveLength(1);
  });
});
