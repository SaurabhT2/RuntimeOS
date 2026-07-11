export {
  bootstrap,
  type GatewayApp,
  type GatewayRuntimeConfig,
  type BootstrapOverrides,
} from "./bootstrap.js";
export { Router, type RouteHandler } from "./router.js";
export { buildGatewayRouter, dispatchGatewayRequest } from "./dispatch.js";

export { extractApiKey } from "./http/auth-header.js";
export { readJsonBody } from "./http/read-body.js";
export {
  sendJson,
  sendError,
  statusForGatewayError,
  toErrorResponseBody,
  type ErrorResponseBody,
} from "./http/respond.js";
export { validateExecuteRequest } from "./http/validate-request.js";

export { handleExecute } from "./http/routes/execute.js";
export { handleExecuteStream } from "./http/routes/execute-stream.js";
export { handleHealth, type HealthResponseBody } from "./http/routes/health.js";
