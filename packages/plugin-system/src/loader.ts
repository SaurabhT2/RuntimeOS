import { discoverPlugins, type PluginSource } from "./discovery.js";
import { InvalidPluginError } from "./errors.js";
import type { PluginHost } from "./plugin-host.js";

export interface PluginLoadFailure {
  pluginName?: string;
  error: unknown;
}

export interface PluginLoadResult {
  loaded: string[];
  failures: PluginLoadFailure[];
}

/**
 * Discovers plugins from `sources` (`discovery.ts`) and registers each into
 * `host` (`plugin-host.ts`). One invalid or misbehaving plugin never stops
 * the rest from loading (Blueprint §7 EM-7's "isolation" testing
 * requirement, applied to the loading phase specifically, as distinct from
 * the hook-execution-time isolation `PluginHost.runOnRequest`/`runOnResponse`
 * already provide): every discovery failure and every `host.register`
 * failure is caught individually and collected into `PluginLoadResult`,
 * never thrown.
 */
export async function loadPlugins(
  host: PluginHost,
  sources: PluginSource[],
): Promise<PluginLoadResult> {
  const { plugins, failures: discoveryFailures } = await discoverPlugins(sources);

  const loaded: string[] = [];
  const failures: PluginLoadFailure[] = discoveryFailures.map((f) => ({ error: f.error }));

  for (const plugin of plugins) {
    try {
      host.register(plugin);
      loaded.push(plugin.name);
    } catch (error) {
      const pluginName = error instanceof InvalidPluginError ? error.pluginName : undefined;
      failures.push({ pluginName, error });
    }
  }

  return { loaded, failures };
}
