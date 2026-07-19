import { trace, SpanStatusCode, type Tracer } from "@opentelemetry/api";
import type { Span } from "./types.js";

/**
 * Wraps a raw OTel `Span` so that {@link Span.end} always closes it with an
 * explicit status (architecture §19.3's "never silent failure" principle,
 * applied to tracing): if the caller never calls `setStatus`, `end()`
 * defaults it to `OK` rather than leaving it `UNSET`. Blueprint §8.3's
 * testing strategy requires asserting "every span closes with a status" —
 * this is the mechanism that makes that guarantee true rather than merely
 * hoped-for.
 *
 * Every other `Span` method (`setAttribute`, `addEvent`, `recordException`,
 * etc.) delegates straight through to the underlying OTel span; only
 * `setStatus`/`end` are intercepted.
 */
function withGuaranteedStatus(raw: Span): Span {
  let statusSet = false;
  return new Proxy(raw, {
    get(target, prop, receiver) {
      if (prop === "setStatus") {
        return (status: Parameters<Span["setStatus"]>[0]) => {
          statusSet = true;
          return target.setStatus(status);
        };
      }
      if (prop === "end") {
        return (...args: Parameters<Span["end"]>) => {
          if (!statusSet) {
            target.setStatus({ code: SpanStatusCode.OK });
            statusSet = true;
          }
          return target.end(...args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

/**
 * Thin wrapper over `@opentelemetry/api`'s global tracer registration
 * (Blueprint §8.3 "a thin adapter over the OTel SDK"). Deliberately does
 * *not* register a `TracerProvider` or exporter itself — that is the
 * composition root's job (`apps/gateway-server/src/bootstrap.ts`, Blueprint
 * §6.4), wired up once EM-5 exists. Until an SDK is registered, every span
 * produced here is a no-op OTel span — correct, inert behavior, not a bug —
 * so this package is fully testable and usable standalone today.
 */
export class GatewayTracer {
  private readonly tracer: Tracer;

  constructor(instrumentationName = "@ai-gateway/telemetry") {
    this.tracer = trace.getTracer(instrumentationName);
  }

  startSpan(name: string, attrs?: Record<string, unknown>): Span {
    const raw = this.tracer.startSpan(name, {
      attributes: attrs as Record<string, string | number | boolean> | undefined,
    });
    return withGuaranteedStatus(raw);
  }
}
