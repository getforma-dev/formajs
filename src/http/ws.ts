/**
 * Forma HTTP - WebSocket
 *
 * Reactive WebSocket wrapper with auto-reconnect and signal integration.
 * Zero dependencies — native browser APIs only.
 */

import { createSignal } from 'forma/reactive/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WSStatus = 'connecting' | 'open' | 'closed' | 'error';

export interface WSOptions {
  protocols?: string | string[];
  reconnect?: boolean; // default true
  reconnectInterval?: number; // ms, default 1000
  maxReconnects?: number; // default 5
}

export interface WSConnection<TSend = unknown, TReceive = unknown> {
  data: () => TReceive | null;
  status: () => WSStatus;
  send(data: TSend): void;
  close(): void;
  on(handler: (data: TReceive) => void): () => void;
}

// ---------------------------------------------------------------------------
// createWebSocket
// ---------------------------------------------------------------------------

/**
 * Create a reactive WebSocket connection with auto-reconnect.
 *
 * ```ts
 * const ws = createWebSocket<string, ChatMessage>('wss://chat.example.com');
 * ws.send('hello');
 * createEffect(() => {
 *   const msg = ws.data();
 *   if (msg) console.log(msg);
 * });
 * ```
 */
export function createWebSocket<TSend = unknown, TReceive = unknown>(
  url: string,
  options?: WSOptions,
): WSConnection<TSend, TReceive> {
  const shouldReconnect = options?.reconnect ?? true;
  const baseInterval = options?.reconnectInterval ?? 1000;
  const maxReconnects = options?.maxReconnects ?? 5;

  const [data, setData] = createSignal<TReceive | null>(null);
  const [status, setStatus] = createSignal<WSStatus>('connecting');

  const handlers = new Set<(data: TReceive) => void>();

  let socket: WebSocket | null = null;
  let reconnectCount = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let permanentlyClosed = false;

  function connect(): void {
    if (permanentlyClosed) return;

    setStatus('connecting');
    socket = new WebSocket(url, options?.protocols);

    socket.onopen = () => {
      setStatus('open');
      reconnectCount = 0; // Reset on successful connection
    };

    socket.onmessage = (event: MessageEvent) => {
      let parsed: TReceive;
      try {
        parsed = JSON.parse(event.data as string) as TReceive;
      } catch {
        parsed = event.data as TReceive;
      }
      setData(parsed);
      for (const handler of handlers) {
        handler(parsed);
      }
    };

    socket.onerror = () => {
      setStatus('error');
    };

    socket.onclose = () => {
      if (permanentlyClosed) {
        setStatus('closed');
        return;
      }

      setStatus('closed');

      if (shouldReconnect && reconnectCount < maxReconnects) {
        // Exponential backoff: baseInterval * 2^reconnectCount
        const delay = baseInterval * Math.pow(2, reconnectCount);
        reconnectCount++;
        reconnectTimer = setTimeout(connect, delay);
      }
    };
  }

  // Initiate the first connection
  connect();

  return {
    data,
    status,

    send(value: TSend): void {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(value));
      }
    },

    close(): void {
      permanentlyClosed = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (socket) {
        socket.close();
        socket = null;
      }
      setStatus('closed');
    },

    on(handler: (data: TReceive) => void): () => void {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
}
