import { createServer, type Server } from "node:http";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerGracefulShutdown } from "../src/lifecycle.js";
import { fakeTelemetry } from "./fixtures.js";

function fakeProcess() {
  const emitter = new EventEmitter();
  return {
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      emitter.on(event, listener);
      return emitter as unknown as NodeJS.Process;
    }),
    removeListener: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      emitter.removeListener(event, listener);
      return emitter as unknown as NodeJS.Process;
    }),
    exit: vi.fn(),
    emit: (event: string) => emitter.emit(event),
  };
}

let server: Server | undefined;

afterEach(async () => {
  if (server?.listening) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  }
  server = undefined;
});

describe("registerGracefulShutdown", () => {
  it("closes the server and exits 0 on SIGTERM", async () => {
    server = createServer((_req, res) => res.end("ok"));
    await new Promise<void>((resolve) => server?.listen(0, resolve));

    const proc = fakeProcess();
    const telemetry = fakeTelemetry();
    registerGracefulShutdown(server, telemetry, { process: proc as never, gracePeriodMs: 5000 });

    proc.emit("SIGTERM");
    await vi.waitFor(() => expect(proc.exit).toHaveBeenCalledWith(0));
    expect(server.listening).toBe(false);
    expect(telemetry.log).toHaveBeenCalledWith(
      "info",
      "gateway_server.shutdown.start",
      expect.objectContaining({ signal: "SIGTERM" }),
    );
  });

  it("closes the server and exits 0 on SIGINT", async () => {
    server = createServer((_req, res) => res.end("ok"));
    await new Promise<void>((resolve) => server?.listen(0, resolve));

    const proc = fakeProcess();
    registerGracefulShutdown(server, fakeTelemetry(), { process: proc as never });

    proc.emit("SIGINT");
    await vi.waitFor(() => expect(proc.exit).toHaveBeenCalledWith(0));
  });

  it("is idempotent — a second signal while already shutting down is a no-op", async () => {
    server = createServer((_req, res) => res.end("ok"));
    await new Promise<void>((resolve) => server?.listen(0, resolve));

    const proc = fakeProcess();
    registerGracefulShutdown(server, fakeTelemetry(), { process: proc as never });

    proc.emit("SIGTERM");
    proc.emit("SIGTERM");
    await vi.waitFor(() => expect(proc.exit).toHaveBeenCalledTimes(1));
  });

  it("force-exits with code 1 if the grace period elapses before close completes", async () => {
    // A server that never actually closes its listener (simulated hang):
    // `close()` callback deliberately never invoked.
    const hangingServer = {
      close: vi.fn(),
    } as unknown as Server;

    const proc = fakeProcess();
    registerGracefulShutdown(hangingServer, fakeTelemetry(), {
      process: proc as never,
      gracePeriodMs: 10,
    });

    proc.emit("SIGTERM");
    await vi.waitFor(() => expect(proc.exit).toHaveBeenCalledWith(1), { timeout: 1000 });
  });

  it("returns an unregister function that removes the signal listeners", () => {
    server = createServer();
    const proc = fakeProcess();
    const unregister = registerGracefulShutdown(server, fakeTelemetry(), {
      process: proc as never,
    });
    expect(proc.on).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
    expect(proc.on).toHaveBeenCalledWith("SIGINT", expect.any(Function));
    unregister();
    expect(proc.removeListener).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
    expect(proc.removeListener).toHaveBeenCalledWith("SIGINT", expect.any(Function));
  });
});
