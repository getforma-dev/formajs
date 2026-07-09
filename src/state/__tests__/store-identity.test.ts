// Store proxy identity / cache correctness (1.2.0).
import { describe, it, expect } from 'vitest';
import { createStore } from '../store';
import { internalEffect } from 'forma/reactive';

describe('store proxy identity / cache', () => {
  // ID1: inline cache must not orphan reads after a signal is deleted/recreated
  it('re-adding a deleted key on the same proxy keeps reads and writes on one signal', () => {
    const [state] = createStore({ obj: { a: 1, b: 2 } as Record<string, number> });
    const obj = state.obj;
    expect(obj.a).toBe(1); // primes any inline cache for key "a"
    delete (obj as any).a; // deletes the obj.a signal
    const seen: unknown[] = [];
    internalEffect(() => { seen.push((obj as any).a); });
    (obj as any).a = 5; // must notify the SAME signal the effect subscribed to
    expect(seen).toEqual([undefined, 5]);
  });

  it('reading a deleted-then-restored key does not read a stale signal value', () => {
    const [state] = createStore({ o: { k: 'first' } as Record<string, string> });
    const o = state.o;
    void o.k; // prime
    delete (o as any).k;
    (o as any).k = 'second';
    const seen: string[] = [];
    internalEffect(() => { seen.push((o as any).k); });
    (o as any).k = 'third';
    expect(seen).toEqual(['second', 'third']);
  });

  // ID2: aliased raw objects get distinct, path-bound proxies
  it('same raw object aliased at two paths yields distinct proxies', () => {
    const shared = { x: 1 };
    const [state] = createStore({ a: shared, b: shared });
    expect(state.a).not.toBe(state.b);
  });

  it('writing an aliased child notifies only the path that was written', () => {
    const shared = { x: 1 };
    const [state] = createStore({ a: shared, b: shared });
    const seenA: number[] = [];
    const seenB: number[] = [];
    internalEffect(() => { seenA.push(state.a.x); });
    internalEffect(() => { seenB.push(state.b.x); });
    (state.b as any).x = 99;
    expect(seenB).toEqual([1, 99]);
    expect(seenA).toEqual([1]);
  });

  // ID3: replacing an object evicts its stale proxy
  it('re-inserting a replaced object at a new path binds to the new path', () => {
    const child = { v: 1 };
    const [state] = createStore<{ p: { v: number }; q: { v: number } | null }>({ p: child, q: null });
    expect(state.p.v).toBe(1); // caches child proxy bound to "p"
    (state as any).p = { v: 2 }; // replace p; old child proxy must be evicted
    (state as any).q = child; // re-insert old raw at path "q"
    const seenQ: number[] = [];
    internalEffect(() => { seenQ.push((state.q as any).v); });
    (state.q as any).v = 42; // must notify q.v, not p.v
    expect(seenQ).toEqual([1, 42]);
  });

  it('replacing an object then reading the same path returns a fresh proxy for the new value', () => {
    const oldChild = { name: 'old' };
    const [state] = createStore<{ child: { name: string } }>({ child: oldChild });
    const p1 = state.child;
    (state as any).child = { name: 'new' };
    const p2 = state.child;
    expect(p2.name).toBe('new');
    expect(p2).not.toBe(p1);
  });
});
