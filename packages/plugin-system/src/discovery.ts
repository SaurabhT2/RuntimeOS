import type { GatewayPlugin } from "./plugin-contract.js";

/**
 * A discoverable source of one or more plugins — e.g. a package's default
 * export, a factory function, or a static array wrapped in a function.
 * Designed, not specified: architecture §9's package diagram names only
 * `plugin-host.ts`/`plugin-contract.ts` as files, not a discovery
 * mechanism's shape. This package deliberately does not implement
 * filesystem/directory scanning or dynamic `import()` of arbitrary module
 * paths — that would be a meaningfully larger, security-sensitive surface
 * (loading and executing arbitrary code found on disk) than this
 * milestone's scope calls for (Blueprint §7 EM-7: "a plugin host capable
 * of loading a trivial example plugin" — not a filesystem plugin
 * marketplace, which is explicitly V3 scope per architecture §27's
 * "Plugin marketplace" note). A `PluginSource` is the caller's own
 * already-resolved reference to a plugin (or plugins) — e.g. an entry in a
 * config-driven list of imported plugin packages — matching Principle P4
 * ("everything is an adapter or plugin, registered at startup").
 */
export type PluginSource = () =>
  GatewayPlugin | GatewayPlugin[] | Promise<GatewayPlugin | GatewayPlugin[]>;

export interface DiscoveryFailure {
  sourceIndex: number;
  error: unknown;
}

export interface DiscoveryResult {
  plugins: GatewayPlugin[];
  failures: DiscoveryFailure[];
}

/**
 * Resolves every `PluginSource`, tolerating an individual source throwing
 * (or rejecting) — a single misbehaving source must not prevent discovery
 * of the others (the same isolation stance `PluginHost`'s hook execution
 * takes). Failures are collected in `DiscoveryResult.failures`, not
 * thrown, so a caller can decide how strict to be.
 */
export async function discoverPlugins(sources: PluginSource[]): Promise<DiscoveryResult> {
  const plugins: GatewayPlugin[] = [];
  const failures: DiscoveryFailure[] = [];

  for (const [sourceIndex, source] of sources.entries()) {
    try {
      const resolved = await source();
      if (Array.isArray(resolved)) {
        plugins.push(...resolved);
      } else {
        plugins.push(resolved);
      }
    } catch (error) {
      failures.push({ sourceIndex, error });
    }
  }

  return { plugins, failures };
}
