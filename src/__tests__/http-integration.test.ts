import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFetch, createSSE, createWebSocket, fetchJSON } from '../http';

function waitForEffects(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('http integration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('resolves createFetch data and loading state', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ value: 42 }),
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const req = createFetch<{ value: number }>('https://example.test/api/value');
    await waitForEffects();
    await waitForEffects();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/api/value',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(req.loading()).toBe(false);
    expect(req.error()).toBeNull();
    expect(req.data()).toEqual({ value: 42 });
  });

  it('throws on non-2xx in fetchJSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await expect(fetchJSON('/api/fail')).rejects.toThrow(
      'HTTP 500: Internal Server Error',
    );
  });

  it('parses SSE payloads and updates connection state', () => {
    const sources: FakeEventSource[] = [];

    class FakeEventSource {
      static instances = sources;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      private listeners = new Map<string, Set<(event: MessageEvent) => void>>();
      constructor(_url: string, _opts?: { withCredentials?: boolean }) {
        FakeEventSource.instances.push(this);
      }
      addEventListener(event: string, cb: EventListener): void {
        const set = this.listeners.get(event) ?? new Set<(event: MessageEvent) => void>();
        set.add(cb as (event: MessageEvent) => void);
        this.listeners.set(event, set);
      }
      removeEventListener(event: string, cb: EventListener): void {
        this.listeners.get(event)?.delete(cb as (event: MessageEvent) => void);
      }
      emitOpen(): void {
        this.onopen?.(new Event('open'));
      }
      emitMessage(data: string): void {
        this.onmessage?.({ data } as MessageEvent);
      }
      emitNamed(event: string, data: string): void {
        const message = { data } as MessageEvent;
        for (const listener of this.listeners.get(event) ?? []) {
          listener(message);
        }
      }
      close(): void {}
    }

    vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);

    const sse = createSSE<{ message: string }>('/events');
    const source = sources[0]!;

    const seen: unknown[] = [];
    const off = sse.on('custom', (payload) => seen.push(payload));

    source.emitOpen();
    source.emitMessage(JSON.stringify({ message: 'hello' }));
    source.emitNamed('custom', JSON.stringify({ message: 'custom' }));
    off();

    expect(sse.connected()).toBe(true);
    expect(sse.data()).toEqual({ message: 'hello' });
    expect(seen).toEqual([{ message: 'custom' }]);
  });

  it('parses websocket messages and notifies subscribers', () => {
    const sockets: FakeWebSocket[] = [];

    class FakeWebSocket {
      static OPEN = 1;
      static CLOSED = 3;
      readyState = 0;
      onopen: (() => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      sent: string[] = [];
      constructor(_url: string, _protocols?: string | string[]) {
        sockets.push(this);
      }
      send(payload: string): void {
        this.sent.push(payload);
      }
      close(): void {
        this.readyState = FakeWebSocket.CLOSED;
        this.onclose?.();
      }
      emitOpen(): void {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.();
      }
      emitMessage(payload: string): void {
        this.onmessage?.({ data: payload } as MessageEvent);
      }
    }

    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);

    const ws = createWebSocket<{ text: string }, { text: string }>('ws://socket', {
      reconnect: false,
    });
    const socket = sockets[0]!;
    const received: unknown[] = [];
    const off = ws.on((payload) => received.push(payload));

    expect(ws.status()).toBe('connecting');
    socket.emitOpen();
    expect(ws.status()).toBe('open');

    ws.send({ text: 'hello' });
    expect(socket.sent).toEqual(['{"text":"hello"}']);

    socket.emitMessage('{"text":"world"}');
    expect(ws.data()).toEqual({ text: 'world' });
    expect(received).toEqual([{ text: 'world' }]);

    off();
    ws.close();
    expect(ws.status()).toBe('closed');
  });
});
