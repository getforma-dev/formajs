/**
 * Regression suite for `store-proto-hijack-via-setter`.
 *
 * `JSON.parse` creates `__proto__` as a real own, enumerable property, so an
 * untrusted payload handed to `setState` reached `Reflect.set(target,
 * '__proto__', …)` — which invokes Object.prototype's setter with `this =
 * target` and swaps the store object's prototype. Every later read of a key the
 * app never set then resolved through the attacker's object, letting untrusted
 * server JSON forge state fields (`isAdmin`, feature flags, …).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createStore } from '../store';
import { createEffect } from 'forma/reactive';

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe('createStore prototype-pollution guards', () => {
  it('setState with a __proto__ key does not replace the store prototype', () => {
    const [state, setState] = createStore<Record<string, unknown>>({ user: 'ada' });

    // Exactly what an untrusted API response looks like after JSON.parse.
    const hostile = JSON.parse('{"__proto__":{"isAdmin":true},"user":"eve"}');
    setState(hostile);

    expect((state as Record<string, unknown>)['isAdmin']).toBeUndefined();
    expect(Object.getPrototypeOf(state)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)['isAdmin']).toBeUndefined();
    // The legitimate key in the same payload still applies.
    expect(state['user']).toBe('eve');
  });

  it('assigning __proto__ directly on the proxy does not replace the prototype', () => {
    const [state] = createStore<Record<string, unknown>>({ count: 0 });

    (state as Record<string, unknown>)['__proto__'] = { isAdmin: true };

    expect((state as Record<string, unknown>)['isAdmin']).toBeUndefined();
    expect(Object.getPrototypeOf(state)).toBe(Object.prototype);
  });

  it('rejects constructor and prototype keys through both write paths', () => {
    const [state, setState] = createStore<Record<string, unknown>>({ ok: 1 });

    setState(JSON.parse('{"constructor":{"bad":1},"prototype":{"bad":2},"ok":2}'));
    expect(state['ok']).toBe(2);
    expect((state as Record<string, unknown>)['constructor']).toBe(Object.prototype.constructor);
    expect(Object.prototype.hasOwnProperty.call(state, 'prototype')).toBe(false);

    (state as Record<string, unknown>)['constructor'] = { bad: 3 };
    expect((state as Record<string, unknown>)['constructor']).toBe(Object.prototype.constructor);
  });

  it('a rejected key does not throw and does not notify effects', () => {
    const [state, setState] = createStore<Record<string, unknown>>({ ok: 1 });
    let runs = 0;
    createEffect(() => { void state['ok']; runs++; });
    expect(runs).toBe(1);

    expect(() => setState(JSON.parse('{"__proto__":{"x":1}}'))).not.toThrow();
    expect(runs).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('__proto__'));
  });

  it('a functional-updater snapshot never inherits from an injected prototype', () => {
    // The raw initial object can itself come from JSON.parse, in which case
    // `__proto__` is an own key that deepClone would have re-applied through
    // Object.prototype's setter, poisoning the snapshot handed to the updater.
    const initial = JSON.parse('{"count":1,"__proto__":{"isAdmin":true}}');
    const [, setState] = createStore<Record<string, unknown>>(initial);

    let seenAdmin: unknown = 'unset';
    setState((prev) => {
      seenAdmin = (prev as Record<string, unknown>)['isAdmin'];
      return { count: 2 };
    });

    expect(seenAdmin).toBeUndefined();
  });

  it('keeps ordinary keys named like properties of Object.prototype', () => {
    const [state, setState] = createStore<Record<string, unknown>>({});
    setState({ toString: 'a label', valueOf: 'another' } as Record<string, unknown>);
    expect(state['toString']).toBe('a label');
    expect(state['valueOf']).toBe('another');
  });
});
