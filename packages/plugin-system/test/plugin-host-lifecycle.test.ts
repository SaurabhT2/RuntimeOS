import { describe, expect, it } from "vitest";
import { PluginNotFoundError } from "../src/errors.js";
import { PluginHost } from "../src/plugin-host.js";

describe("PluginHost — lifecycle", () => {
  it("a freshly registered plugin has state 'registered'", () => {
    const host = new PluginHost();
    host.register({ name: "p" });
    expect(host.getState("p")).toBe("registered");
  });

  it("unregister() transitions a plugin to 'unregistered'", () => {
    const host = new PluginHost();
    host.register({ name: "p" });
    host.unregister("p");
    expect(host.getState("p")).toBe("unregistered");
  });

  it("an unregistered plugin no longer appears in list() or get()", () => {
    const host = new PluginHost();
    host.register({ name: "p" });
    host.unregister("p");
    expect(host.list()).toEqual([]);
    expect(host.get("p")).toBeUndefined();
  });

  it("unregister() on an unknown name throws PluginNotFoundError", () => {
    const host = new PluginHost();
    expect(() => host.unregister("nope")).toThrow(PluginNotFoundError);
  });

  it("re-registering a name after it was unregistered succeeds (it is no longer 'registered')", () => {
    const host = new PluginHost();
    host.register({ name: "p" });
    host.unregister("p");
    expect(() => host.register({ name: "p" })).not.toThrow();
    expect(host.getState("p")).toBe("registered");
  });
});
