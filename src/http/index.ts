/**
 * Forma HTTP
 *
 * Typed wrappers for fetch, Server-Sent Events, and WebSocket.
 * Zero dependencies — native browser APIs only.
 */

export { createFetch, fetchJSON, type FetchOptions, type FetchResult } from './fetch.js';
export { createSSE, type SSEOptions, type SSEConnection } from './sse.js';
export {
  createWebSocket,
  type WSOptions,
  type WSConnection,
  type WSStatus,
} from './ws.js';
