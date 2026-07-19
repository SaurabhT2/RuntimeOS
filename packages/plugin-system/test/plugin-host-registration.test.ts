import { describe, expect, it } from "vitest";
import { InvalidPluginError } from "../src/errors.js";
import { PluginHost } from "../src/plugin-host.js";

describe("PluginHost.register — registration", () => {
  it("registers a valid plugin and it appears in list()", () => {
    const host = new PluginHost();
    host.register({ name: "my-plugin" });
    expect(host.list().map((p) => p.name)).toEqual(["my-plugin"]);
  });

  it("registers multiple plugins in registration order", () => {
    const host = new PluginHost();
    host.register({ name: "first" });
    host.register({ name: "second" });
    expect(host.list().map((p) => p.name)).toEqual(["first", "second"]);
  });

  it("get() returns the registered plugin by name", () => {
    const host = new PluginHost();
    const plugin = { name: "my-plugin" };
    host.register(plugin);
    expect(host.get("my-plugin")).toBe(plugin);
  });

  it("get() returns undefined for an unknown name", () => {
    const host = new PluginHost();
    expect(host.get("nope")).toBeUndefined();
  });
});

describe("PluginHost.register — invalid plugin rejection", () => {
  it("rejects a plugin with an empty name", () => {
    const host = new PluginHost();
    expect(() => host.register({ name: "" })).toThrow(InvalidPluginError);
  });

  it("rejects a plugin with a whitespace-only name", () => {
    const host = new PluginHost();
    expect(() => host.register({ name: "   " })).toThrow(InvalidPluginError);
  });

  it("rejects a plugin with a missing name field", () => {
    const host = new PluginHost();
    // @ts-expect-error deliberately malformed input for the rejection test
    expect(() => host.register({})).toThrow(InvalidPluginError);
  });

  it("rejects a duplicate registration under an already-registered name", () => {
    const host = new PluginHost();
    host.register({ name: "dup" });
    expect(() => host.register({ name: "dup" })).toThrow(InvalidPluginError);
  });

  it("rejects a plugin whose onRequest field is present but not a function", () => {
    const host = new PluginHost();
    // @ts-expect-error deliberately malformed input for the rejection test
    expect(() => host.register({ name: "bad", onRequest: "not-a-function" })).toThrow(
      InvalidPluginError,
    );
  });

  it("rejects a plugin whose onResponse field is present but not a function", () => {
    const host = new PluginHost();
    // @ts-expect-error deliberately malformed input for the rejection test
    expect(() => host.register({ name: "bad", onResponse: 42 })).toThrow(InvalidPluginError);
  });

  it("one invalid plugin does not corrupt the host's state for subsequent valid registrations", () => {
    const host = new PluginHost();
    expect(() => host.register({ name: "" })).toThrow(InvalidPluginError);
    host.register({ name: "valid-after-invalid" });
    expect(host.list().map((p) => p.name)).toEqual(["valid-after-invalid"]);
  });
});
