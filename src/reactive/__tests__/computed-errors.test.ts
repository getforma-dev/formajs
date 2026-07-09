// Computed error semantics (1.1.0): a throwing getter must cache-and-rethrow on
// every read until a dependency changes (TC39/Solid), never return a stale value,
// propagate the error/recovery transition to subscribers, and route through onError.
import { describe, it, expect, vi } from 'vitest';
import { createSignal } from '../signal';
import { createComputed } from '../computed';
import { createMemo } from '../memo';
import { createEffect } from '../effect';
import { createRoot } from '../root';
import { onError } from '../dev';

describe('createComputed error caching (TC39/Solid rethrow semantics)', () => {
  it('rethrows the cached error on every read until deps change', () => {
    const [n, setN] = createSignal(1);
    const c = createComputed(() => {
      if (n() === 2) throw new Error('boom');
      return n() * 10;
    });
    expect(c()).toBe(10);
    setN(2);
    expect(() => c()).toThrow('boom');
    // Unchanged deps must STILL throw the cached error, not return stale 10.
    expect(() => c()).toThrow('boom');
    expect(() => c()).toThrow('boom');
    setN(3);
    expect(c()).toBe(30);
  });

  it('does not return a stale value after the getter throws', () => {
    const [n, setN] = createSignal(5);
    const c = createComputed(() => {
      if (n() < 0) throw new Error('neg');
      return n();
    });
    expect(c()).toBe(5);
    setN(-1);
    let observed: number | undefined;
    let secondThrew = false;
    expect(() => c()).toThrow('neg');
    try { observed = c(); } catch { secondThrew = true; }
    expect(secondThrew).toBe(true);
    expect(observed).toBeUndefined();
  });

  it('propagates the error/recovery transition to a subscribing effect', () => {
    const log: string[] = [];
    createRoot(() => {
      const [n, setN] = createSignal(1);
      const c = createComputed(() => {
        if (n() === 2) throw new Error('boom');
        return n() * 10;
      });
      createEffect(() => {
        try { log.push(String(c())); } catch (e) { log.push('ERR:' + (e as Error).message); }
      });
      expect(log).toEqual(['10']);
      setN(2);
      expect(log).toEqual(['10', 'ERR:boom']);
      setN(3);
      expect(log).toEqual(['10', 'ERR:boom', '30']);
    });
  });

  it('preserves previousValue semantics across an error (getter never sees the sentinel)', () => {
    const [n, setN] = createSignal(1);
    const seen: Array<number | undefined> = [];
    const c = createComputed<number>((prev) => {
      seen.push(prev);
      if (n() === 2) throw new Error('boom');
      return n() * 10;
    });
    expect(c()).toBe(10);
    setN(2);
    try { c(); } catch { /* expected */ }
    setN(3);
    expect(c()).toBe(30);
    for (const p of seen) {
      expect(p === undefined || typeof p === 'number').toBe(true);
    }
    expect(seen).toContain(10);
  });

  it('routes the thrown error through the onError dev handler', () => {
    const handler = vi.fn();
    const off = onError(handler);
    try {
      const [n, setN] = createSignal(1);
      const c = createComputed(() => {
        if (n() === 2) throw new Error('boom');
        return n();
      });
      c();
      setN(2);
      try { c(); } catch { /* expected */ }
      expect(handler).toHaveBeenCalledTimes(1);
      const firstArg = handler.mock.calls[0][0] as Error;
      const secondArg = handler.mock.calls[0][1] as { source?: string };
      expect(firstArg.message).toBe('boom');
      expect(secondArg.source).toBe('computed');
    } finally {
      off();
    }
  });

  it('createMemo shares the same rethrow semantics', () => {
    const [n, setN] = createSignal(1);
    const m = createMemo(() => {
      if (n() === 2) throw new Error(String.fromCharCode(88)); // 'X'
      return n();
    });
    expect(m()).toBe(1);
    setN(2);
    expect(() => m()).toThrow('X');
    expect(() => m()).toThrow('X');
    setN(4);
    expect(m()).toBe(4);
  });
});
