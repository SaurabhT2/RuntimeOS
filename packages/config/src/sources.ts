import { readFile } from "node:fs/promises";
import { watch as watchFile, type FSWatcher } from "node:fs";
import { ConfigError } from "./errors.js";

/**
 * Where raw (pre-validation) configuration data comes from. `config`'s own
 * behavior — which source to load from — is itself set via environment
 * variables (Blueprint §8.2), never hardcoded, so a deployment can swap
 * sources with no code change.
 *
 * Launch scope (EM-1): `env` and `file`. A future DB-row source is an
 * additive `ConfigSource` implementation — no change to {@link loadConfig}
 * or {@link watchConfig} required (Blueprint §8.2 "Extension points").
 */
export interface ConfigSource {
  /** Human-readable identifier, used in error messages and logs. */
  readonly id: string;

  /** Reads the current raw configuration value (parsed JSON, pre-schema-validation). */
  read(): Promise<unknown>;

  /**
   * Subscribes to change notifications from the underlying source, if the
   * source supports it. Returns an unsubscribe function. Sources that
   * cannot watch for changes (e.g. a one-shot env var read) should return a
   * no-op unsubscribe function rather than throwing.
   */
  watch(onChange: () => void): () => void;
}

/**
 * Reads `GatewayConfig` as a JSON document from a single environment
 * variable. Does not support hot-reload (env vars are fixed for a process's
 * lifetime) — {@link ConfigSource.watch} is a documented no-op here.
 */
export class EnvConfigSource implements ConfigSource {
  public readonly id: string;

  constructor(private readonly envVarName = "AI_GATEWAY_CONFIG_JSON") {
    this.id = `env:${envVarName}`;
  }

  async read(): Promise<unknown> {
    const raw = process.env[this.envVarName];
    if (raw === undefined) {
      throw new ConfigError(
        `Environment variable ${this.envVarName} is not set; ${this.id} has no configuration to read.`,
      );
    }
    try {
      return JSON.parse(raw);
    } catch (cause) {
      throw new ConfigError(`${this.id} does not contain valid JSON.`, cause);
    }
  }

  watch(_onChange: () => void): () => void {
    // Environment variables cannot change within a running process; this
    // source is read-once by design.
    return () => {
      /* no-op: nothing to unsubscribe from */
    };
  }
}

/**
 * Reads `GatewayConfig` as a JSON file from disk, and supports hot-reload
 * via `fs.watch` — the mechanism `policy-engine`'s routing weight overrides
 * and future Runtime Profiles (architecture §37) rely on (Blueprint §8.2).
 */
export class FileConfigSource implements ConfigSource {
  public readonly id: string;

  constructor(private readonly filePath: string) {
    this.id = `file:${filePath}`;
  }

  async read(): Promise<unknown> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf-8");
    } catch (cause) {
      throw new ConfigError(`Could not read config file at ${this.filePath}.`, cause);
    }
    try {
      return JSON.parse(raw);
    } catch (cause) {
      throw new ConfigError(`${this.filePath} does not contain valid JSON.`, cause);
    }
  }

  watch(onChange: () => void): () => void {
    let watcher: FSWatcher;
    try {
      watcher = watchFile(this.filePath, { persistent: false }, () => onChange());
    } catch (cause) {
      throw new ConfigError(`Could not watch config file at ${this.filePath} for changes.`, cause);
    }
    return () => watcher.close();
  }
}

/**
 * A source backed by an in-memory value, primarily for tests and for
 * embedding a config directly in a process without a file or env var.
 * Supports hot-reload via {@link InMemoryConfigSource.set}.
 */
export class InMemoryConfigSource implements ConfigSource {
  public readonly id = "in-memory";
  private listeners = new Set<() => void>();

  constructor(private value: unknown) {}

  async read(): Promise<unknown> {
    return this.value;
  }

  watch(onChange: () => void): () => void {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  }

  /** Test/embedding helper: updates the in-memory value and notifies watchers. */
  set(value: unknown): void {
    this.value = value;
    for (const listener of this.listeners) listener();
  }
}
