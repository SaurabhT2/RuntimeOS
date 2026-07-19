import type { ExecuteRequest, ExecuteResponse } from "@ai-gateway/core-contracts";
import type { GatewayPlugin } from "./plugin-contract.js";

/**
 * Blueprint §7 EM-7's named deliverable: "a plugin host capable of loading
 * a trivial example plugin." A deliberately minimal, dependency-free
 * passthrough plugin — it observes each request/response by calling `sink`
 * and returns its input unchanged. No telemetry dependency is used (this
 * package has no `telemetry` edge, Blueprint §4.1's table), so `sink`
 * defaults to a no-op and is otherwise the caller's own injectable
 * observation point — this keeps the example plugin itself trivial while
 * still being a genuine, testable demonstration of the `GatewayPlugin`
 * contract (both hooks implemented, both passthrough-only).
 */
export function createPassthroughLoggingPlugin(
  name = "passthrough-logger",
  sink: (event: { hook: "onRequest" | "onResponse"; requestId?: string }) => void = () => undefined,
): GatewayPlugin {
  return {
    name,
    async onRequest(req: ExecuteRequest): Promise<ExecuteRequest> {
      sink({ hook: "onRequest" });
      return req;
    },
    async onResponse(res: ExecuteResponse): Promise<ExecuteResponse> {
      sink({ hook: "onResponse", requestId: res.requestId });
      return res;
    },
  };
}
