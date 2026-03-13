/**
 * Forma HTTP - Server-Sent Events
 *
 * Reactive SSE wrapper with signal integration.
 * Zero dependencies — native browser APIs only.
 */

import { createSignal } from 'forma/reactive/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SSEOptions {
  withCredentials?: boolean;
  headers?: Record<string, string>; // Note: native EventSource does not support custom headers
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
  options?: SSEOptions,
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

  source.onmessage = (event: MessageEvent) => {
    try {
      const parsed = JSON.parse(event.data as string) as T;
      setData(parsed);
    } catch {
      // If the data isn't JSON, set it as-is
      setData(event.data as T);
    }
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
      const listener = (e: MessageEvent) => {
        try {
          handler(JSON.parse(e.data as string));
        } catch {
          handler(e.data);
        }
      };
      source.addEventListener(event, listener as EventListener);
      return () => {
        source.removeEventListener(event, listener as EventListener);
      };
    },
  };
}
