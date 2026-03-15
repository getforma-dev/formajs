/**
 * Forma HTTP - Server-Sent Events
 *
 * Reactive SSE wrapper with signal integration.
 * Zero dependencies — native browser APIs only.
 */

import { createSignal } from 'forma/reactive';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SSEOptions<T = unknown> {
  withCredentials?: boolean;
  headers?: Record<string, string>; // Note: native EventSource does not support custom headers
  /** Custom parser for incoming messages. Defaults to JSON.parse with raw data fallback. */
  parse?: (data: string) => T;
}

export interface SSEConnection<T = unknown> {
  data: () => T | null;
  error: () => Event | null;
  connected: () => boolean;
  close: () => void;
  on(event: string, handler: (data: unknown) => void): () => void;
}

// ---------------------------------------------------------------------------
// createSSE
// ---------------------------------------------------------------------------

/**
 * Create a reactive Server-Sent Events connection.
 *
 * ```ts
 * const sse = createSSE<{ message: string }>('/api/events');
 * createEffect(() => {
 *   const msg = sse.data();
 *   if (msg) console.log(msg.message);
 * });
 * ```
 */
export function createSSE<T = unknown>(
  url: string,
  options?: SSEOptions<T>,
): SSEConnection<T> {
  const [data, setData] = createSignal<T | null>(null);
  const [error, setError] = createSignal<Event | null>(null);
  const [connected, setConnected] = createSignal<boolean>(false);

  const source = new EventSource(url, {
    withCredentials: options?.withCredentials ?? false,
  });

  source.onopen = () => {
    setConnected(true);
    setError(null);
  };

  const parseMessage = options?.parse ?? ((raw: string): T => {
    try { return JSON.parse(raw) as T; }
    catch { return raw as T; }
  });

  source.onmessage = (event: MessageEvent) => {
    setData(parseMessage(event.data as string));
  };

  source.onerror = (event: Event) => {
    setError(event);
    setConnected(false);
  };

  return {
    data,
    error,
    connected,

    close(): void {
      source.close();
      setConnected(false);
    },

    on(event: string, handler: (data: unknown) => void): () => void {
      const parseEvent = options?.parse ?? ((raw: string) => {
        try { return JSON.parse(raw); }
        catch { return raw; }
      });
      const listener = (e: MessageEvent) => {
        handler(parseEvent(e.data as string));
      };
      source.addEventListener(event, listener as EventListener);
      return () => {
        source.removeEventListener(event, listener as EventListener);
      };
    },
  };
}
