import type { Server } from "node:http";
import type { Telemetry } from "@ai-gateway/telemetry";

export interface ShutdownOptions {
  /** Maximum time to wait for in-flight connections to drain before forcing close. Default: 10s. */
  gracePeriodMs?: number;
  /** Injected for tests — defaults to real `process.on`/`process.exit`/`process.removeListener`. */
  process?: Pick<NodeJS.Process, "on" | "exit" | "removeListener">;
}

/**
 * This milestone's Operational Readiness requirement: "graceful shutdown,
 * ... signal handling, resource cleanup." Registers `SIGTERM`/`SIGINT`
 * handlers that stop accepting new connections (`server.close()`), let
 * in-flight requests finish naturally, and force-exit after
 * `gracePeriodMs` if something is still hung — a slow/stuck downstream
 * provider call must never prevent a container orchestrator's shutdown
 * deadline from being met. Returns an unregister function so tests (and a
 * future caller needing to replace these handlers) don't accumulate
 * duplicate listeners across repeated calls.
 */
export function registerGracefulShutdown(
  server: Server,
  telemetry: Telemetry,
  options: ShutdownOptions = {},
): () => void {
  const gracePeriodMs = options.gracePeriodMs ?? 10_000;
  const proc = options.process ?? process;

  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    telemetry.log("info", "gateway_server.shutdown.start", { signal });

    const forceExitTimer = setTimeout(() => {
      telemetry.log("warn", "gateway_server.shutdown.forced", {
        signal,
        gracePeriodMs,
      });
      proc.exit(1);
    }, gracePeriodMs);
    forceExitTimer.unref?.();

    server.close((error) => {
      clearTimeout(forceExitTimer);
      if (error) {
        telemetry.log("error", "gateway_server.shutdown.error", {
          signal,
          message: error.message,
        });
        proc.exit(1);
        return;
      }
      telemetry.log("info", "gateway_server.shutdown.complete", { signal });
      proc.exit(0);
    });
  };

  const onSigterm = () => shutdown("SIGTERM");
  const onSigint = () => shutdown("SIGINT");
  proc.on("SIGTERM", onSigterm);
  proc.on("SIGINT", onSigint);

  return () => {
    proc.removeListener("SIGTERM", onSigterm);
    proc.removeListener("SIGINT", onSigint);
  };
}
