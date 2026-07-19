/**
 * @ai-gateway/streaming
 *
 * StreamManager and SSE transport.
 *
 * STATUS: implemented (Engineering Milestone EM-3, Blueprint §7).
 * SSE streaming transport only — WebSocket transport (this package's
 * EM-0 scaffold note mentioned `websocket.ts`) is deferred; Blueprint
 * §7's EM-3 feature list is explicit that "SSE streaming transport" is
 * this milestone's scope, with no WebSocket mention. See this package's
 * README, Deferred Work.
 *
 * Architecture reference: §12.1 (streaming variant), §11
 */

export type { StreamManager } from "./types.js";
export { DefaultStreamManager } from "./stream-manager.js";
export {
  toStreamChunk,
  encodeSseChunk,
  decodeSseChunk,
  toSseFrames,
  toSseByteStream,
} from "./sse.js";
