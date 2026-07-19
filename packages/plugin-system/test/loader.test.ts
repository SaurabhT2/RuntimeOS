import { describe, expect, it } from "vitest";
import { loadPlugins } from "../src/loader.js";
import { PluginHost } from "../src/plugin-host.js";

describe("loadPlugins", () => {
  it("discovers and registers plugins from sources into the host", async () => {
    const host = new PluginHost();
    const result = await loadPlugins(host, [() => ({ name: "a" }), () => ({ name: "b" })]);
    expect(result.loaded).toEqual(["a", "b"]);
    expect(host.list().map((p) => p.name)).toEqual(["a", "b"]);
  });

  it("isolates an invalid plugin — the rest still load", async () => {
    const host = new PluginHost();
    const result = await loadPlugins(host, [
      () => ({ name: "" }), // invalid: empty name
      () => ({ name: "valid" }),
    ]);
    expect(result.loaded).toEqual(["valid"]);
    expect(result.failures).toHaveLength(1);
    expect(host.list().map((p) => p.name)).toEqual(["valid"]);
  });

  it("isolates a discovery-time failure — other sources still load", async () => {
    const host = new PluginHost();
    const result = await loadPlugins(host, [
      () => {
        throw new Error("source exploded");
      },
      () => ({ name: "valid" }),
    ]);
    expect(result.loaded).toEqual(["valid"]);
    expect(result.failures).toHaveLength(1);
  });

  it("reports a duplicate-name registration failure without affecting the first successful load", async () => {
    const host = new PluginHost();
    const result = await loadPlugins(host, [() => ({ name: "dup" }), () => ({ name: "dup" })]);
    expect(result.loaded).toEqual(["dup"]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.pluginName).toBe("dup");
  });

  it("reports a non-InvalidPluginError registration failure with an undefined pluginName", async () => {
    const host = new PluginHost();
    const originalRegister = host.register.bind(host);
    host.register = (plugin) => {
      if (plugin.name === "explodes") {
        throw new Error("unexpected host failure");
      }
      originalRegister(plugin);
    };

    const result = await loadPlugins(host, [() => ({ name: "explodes" })]);
    expect(result.loaded).toEqual([]);
    expect(result.failures).toEqual([{ pluginName: undefined, error: expect.any(Error) }]);
  });

  it("returns empty results for an empty source list", async () => {
    const host = new PluginHost();
    const result = await loadPlugins(host, []);
    expect(result.loaded).toEqual([]);
    expect(result.failures).toEqual([]);
  });
});
