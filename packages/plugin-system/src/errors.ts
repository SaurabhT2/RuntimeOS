/**
 * Neither error class below is named anywhere in architecture §11 — they
 * are this package's own invented surface for the validation/lifecycle
 * behavior Blueprint §7 EM-7 requires ("invalid plugin rejection",
 * "lifecycle") but that architecture doesn't itself specify error types
 * for, the same "designed, not specified" category as this package's
 * other own additions (`PluginHost`, `discoverPlugins`/`loadPlugins`).
 */

/** Thrown by `PluginHost.register` (and surfaced, not thrown, by `loadPlugins`) for a structurally invalid plugin. */
export class InvalidPluginError extends Error {
  constructor(
    public readonly reason: string,
    public readonly pluginName?: string,
  ) {
    super(pluginName ? `invalid plugin "${pluginName}": ${reason}` : `invalid plugin: ${reason}`);
    this.name = "InvalidPluginError";
  }
}

/** Thrown by `PluginHost.unregister`/`get` helpers when a name has no registered plugin. */
export class PluginNotFoundError extends Error {
  constructor(public readonly pluginName: string) {
    super(`no plugin registered with name "${pluginName}"`);
    this.name = "PluginNotFoundError";
  }
}
