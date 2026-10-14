/**
 * createWebSocket's reconnect delay (FORMA-132, decision brief L-46).
 *
 * Before, the n-th reconnect waited exactly 2^(n-1) s, so after a deploy every
 * client of a server reconnected in the same instant. The delay now carries
 * full jitter: it is drawn uniformly between 0 and that doubling cap, still for
 * at most five attempts. The clock is faked and the random source is injected,
 * so each run replays.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebSocket } from '../ws';

/** A seeded uniform source in [0, 1) (mulberry32): one simulated client each. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sockets the code under test opened, with the fake clock's time of each. */
let opened: Array<{ url: string; at: number; socket: FakeWebSocket }> = [];

class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    opened.push({ url, at: Date.now(), socket: this });
  }
  send(): void {}
  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
  /** The server is down: the connection attempt fails. */
  fail(): void {
    this.onerror?.();
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
}

const latest = (url: string) => opened.filter((o) => o.url === url).at(-1)!;
const count = (url: string) => opened.filter((o) => o.url === url).length;

/**
 * Fail every connection attempt of the client at `url` while the server is
 * down, and return the delay before each reconnect it made.
 */
async function delaysWhileDown(url: string): Promise<number[]> {
  const delays: number[] = [];
  for (;;) {
    const before = count(url);
    const failedAt = Date.now();
    latest(url).socket.fail();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    if (count(url) === before) return delays;
    delays.push(latest(url).at - failedAt);
  }
}

describe('createWebSocket reconnect delay', () => {
  beforeEach(() => {
    opened = [];
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('with a seeded random source, the n-th reconnect delay lies between 0 and 2^(n-1) s and differs across simulated clients', async () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    const clients = seeds.map((seed) => {
      const url = `ws://client-${seed}`;
      const ws = createWebSocket(url, { random: seeded(seed) });
      return { url, ws, expected: seeded(seed) };
    });

    const delays: number[][] = [];
    for (const client of clients) delays.push(await delaysWhileDown(client.url));

    for (const [k, client] of clients.entries()) {
      // Five attempts, then it stops, as before.
      expect(delays[k]).toHaveLength(5);
      expect(count(client.url)).toBe(6);
      for (const [i, delay] of delays[k]!.entries()) {
        const cap = 1000 * 2 ** i;
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(cap);
        // The draw is the injected source's, scaled to this attempt's cap.
        expect(delay).toBe(Math.floor(client.expected() * cap));
      }
      expect(client.ws.status()).toBe('closed');
    }

    // No two simulated clients wait the same time at any attempt.
    for (let i = 0; i < 5; i++) {
      expect(new Set(delays.map((d) => d[i])).size).toBe(seeds.length);
    }
    // Spread over the cap, not bunched at its end: the 5th attempt's draws
    // cover both halves of its 16 s.
    expect(delays.some((d) => d[4]! < 8000)).toBe(true);
    expect(delays.some((d) => d[4]! >= 8000)).toBe(true);
  });

  it('a successful connection restarts the cap at reconnectInterval', async () => {
    const draws = [0.5, 0.5, 0.5, 0.5];
    const ws = createWebSocket('ws://restart', { random: () => draws.shift() ?? 0.5, reconnectInterval: 200 });

    const failedAt = () => Date.now();
    let t = failedAt();
    latest('ws://restart').socket.fail();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(latest('ws://restart').at - t).toBe(100); // half of 200 ms

    t = failedAt();
    latest('ws://restart').socket.fail();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(latest('ws://restart').at - t).toBe(200); // half of 400 ms

    latest('ws://restart').socket.open();
    expect(ws.status()).toBe('open');
    t = failedAt();
    latest('ws://restart').socket.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(latest('ws://restart').at - t).toBe(100); // the cap is 200 ms again
    expect(count('ws://restart')).toBe(4);
  });

  it('without a random source the delay is drawn from Math.random', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    createWebSocket('ws://default');
    const t = Date.now();
    latest('ws://default').socket.fail();
    await vi.advanceTimersByTimeAsync(249);
    expect(count('ws://default')).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(count('ws://default')).toBe(2);
    expect(latest('ws://default').at - t).toBe(250);
  });

  it('close() during the jittered wait cancels the reconnect', async () => {
    const ws = createWebSocket('ws://closing', { random: () => 0.9 });
    latest('ws://closing').socket.fail();
    await vi.advanceTimersByTimeAsync(500);
    ws.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(count('ws://closing')).toBe(1);
    expect(ws.status()).toBe('closed');
  });
});
