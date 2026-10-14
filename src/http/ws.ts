/**
 * Forma HTTP - WebSocket
 *
 * Reactive WebSocket wrapper with auto-reconnect and signal integration.
 * Zero dependencies — native browser APIs only.
 */

import { createSignal } from 'forma/reactive';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WSStatus = 'connecting' | 'open' | 'closed' | 'error';

export interface WSOptions<TReceive = unknown> {
  protocols?: string | string[];
  reconnect?: boolean; // default true
  /** The cap of the first reconnect delay, in ms (default 1000); it doubles each attempt. */
  reconnectInterval?: number;
  maxReconnects?: number; // default 5
  /**
   * The uniform source in [0, 1) the reconnect delay is drawn from. Defaults
   * to `Math.random`; a test passes a seeded one to replay a run. A value that
   * is not a function, or a draw outside [0, 1), falls back to `Math.random`.
   */
  random?: () => number;
  /** Custom parser for incoming messages. Defaults to JSON.parse with raw data fallback. */
  parse?: (data: string) => TReceive;
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
 * A closed connection is retried up to `maxReconnects` times. The n-th retry
 * waits a delay drawn uniformly between 0 and `reconnectInterval * 2^(n-1)`
 * (full jitter), so the clients of a server that restarts do not all reconnect
 * in the same instant. A successful open restarts the count.
 *
 * Verified by: src/http/__tests__/ws-reconnect.test.ts > "with a seeded random source, the n-th reconnect delay lies between 0 and 2^(n-1) s and differs across simulated clients"
 * Verified by: src/http/__tests__/ws-reconnect.test.ts > "a successful connection restarts the cap at reconnectInterval"
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
  options?: WSOptions<TReceive>,
): WSConnection<TSend, TReceive> {
  const shouldReconnect = options?.reconnect ?? true;
  const baseInterval = options?.reconnectInterval ?? 1000;
  const maxReconnects = options?.maxReconnects ?? 5;
  // Only a function is a source, and only a draw in [0, 1) is used: anything
  // else (an option from untyped config, a draw of 2, -1 or NaN) falls back to
  // Math.random, so the delay always lies within the cap.
  // Verified by: src/http/__tests__/ws-reconnect.test.ts > "a random option that is not a function, and a draw outside [0, 1), fall back to Math.random"
  const source = options?.random;
  const random = (): number => {
    const r = typeof source === 'function' ? source() : NaN;
    return r >= 0 && r < 1 ? r : Math.random();
  };

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

    const parseMessage = options?.parse ?? ((raw: string): TReceive => {
      try { return JSON.parse(raw) as TReceive; }
      catch { return raw as TReceive; }
    });

    socket.onmessage = (event: MessageEvent) => {
      const parsed = parseMessage(event.data as string);
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
        // Exponential backoff with full jitter: uniform in [0, baseInterval * 2^reconnectCount)
        const delay = Math.floor(random() * baseInterval * Math.pow(2, reconnectCount));
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
