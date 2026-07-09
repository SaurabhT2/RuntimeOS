/**
 * @ai-gateway/middleware
 *
 * Auth, rate limiting, and response caching middleware pipeline
 * (architecture §17's A-D nodes, §20.5).
 *
 * STATUS: implemented (Engineering Milestone EM-4, Blueprint §7).
 *
 * Architecture reference: §17, §20.4, §20.5
 */

export { AuthMiddleware, type AuthMiddlewareOptions } from "./auth.js";
export { RateLimitMiddleware, type RateLimitMiddlewareOptions } from "./rate-limit.js";
export { CacheMiddleware, type CacheMiddlewareOptions } from "./cache.js";
export {
  MiddlewarePipeline,
  type MiddlewarePipelineOptions,
  type DownstreamHandler,
} from "./pipeline.js";
export {
  ROLES,
  type Role,
  type AuthContext,
  type ApiKeyRecord,
  type RateLimitResult,
  type TenantContext,
} from "./types.js";
