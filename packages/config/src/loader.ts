import { gatewayConfigSchema, type GatewayConfig } from "./schema.js";
import { ConfigError } from "./errors.js";
import type { ConfigSource } from "./sources.js";

/**
 * Validates raw, unvalidated data against {@link gatewayConfigSchema},
 * wrapping any Zod failure in a {@link ConfigError} with a readable message
 * (Blueprint §8.2: "a thin loader plus a schema validator; no business
 * logic interprets the config values").
 */
function validate(raw: unknown, sourceId: string): GatewayConfig {
  const result = gatewayConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new ConfigError(`Configuration from ${sourceId} failed validation: ${issues}`);
  }
  return result.data;
}

/**
 * Loads and schema-validates a {@link GatewayConfig} from `source` exactly
 * once. Public API named in Blueprint §8.2.
 */
export async function loadConfig(source: ConfigSource): Promise<GatewayConfig> {
  const raw = await source.read();
  return validate(raw, source.id);
}

/** A handle returned by {@link watchConfig} to stop watching. */
export interface ConfigWatchHandle {
  /** The most recently validated configuration. */
  readonly current: GatewayConfig;
  /** Stops watching `source` for further changes. */
  close(): void;
}

/**
 * A structural deep-equality check sufficient for `GatewayConfig` values
 * (JSON-shaped: plain objects, arrays, and primitives only). Used to ensure
 * {@link watchConfig}'s change callback fires exactly once per *actual*
 * change (Blueprint §8.2 testing strategy), not once per underlying source
 * event — a source like `fs.watch` can fire multiple raw events for a
 * single logical write.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const aKeys = Object.keys(a as Record<string, unknown>);
    const bKeys = Object.keys(b as Record<string, unknown>);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) =>
      deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    );
  }
  return false;
}

/**
 * Loads `source` once, then subscribes to its change notifications,
 * re-validating on every underlying event and invoking `onChange` with the
 * newly-validated config only when it actually differs from the
 * previously-known-good config. Public API named in Blueprint §8.2.
 *
 * If a change event produces an invalid config, `onChange` is not called
 * and the previously-known-good config remains {@link ConfigWatchHandle.current}
 * — a bad hot-reload edit must never silently propagate or crash the
 * watching process (architecture §19.3 "never silent failure" applies here
 * too: callers can observe rejected reloads via `onError`).
 */
export function watchConfig(
  source: ConfigSource,
  onChange: (config: GatewayConfig) => void,
  onError?: (error: ConfigError) => void,
): Promise<ConfigWatchHandle> {
  return loadConfig(source).then((initial) => {
    let current = initial;

    const unsubscribe = source.watch(() => {
      void source
        .read()
        .then((raw) => validate(raw, source.id))
        .then((next) => {
          if (!deepEqual(next, current)) {
            current = next;
            onChange(current);
          }
        })
        .catch((cause: unknown) => {
          const error =
            cause instanceof ConfigError
              ? cause
              : new ConfigError(`Unexpected error while reloading ${source.id}.`, cause);
          onError?.(error);
        });
    });

    return {
      get current() {
        return current;
      },
      close: unsubscribe,
    };
  });
}
