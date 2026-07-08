// createRoot dispose-during-setup (1.1.0): calling the provided dispose() inside
// the setup callback must defer teardown so everything created afterward is still
// disposed, instead of leaking (scope.scopeDispose was null at call time).
import { describe, it, expect, vi } from 'vitest';
import { createSignal } from '../signal';
import { createEffect } from '../effect';
import { createRoot, createUnownedRoot } from '../root';

describe('createRoot dispose-during-setup (1.1.0)', () => {
  it('effect created AFTER an in-setup dispose() is still torn down', () => {
    const spy = vi.fn();
    const [count, setCount] = createSignal(0);
    createRoot((dispose) => {
      dispose();
      createEffect(() => { count(); spy(); });
    });
    expect(spy).toHaveBeenCalledTimes(1);
    setCount(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('child root created AFTER parent in-setup dispose() cascades cleanup', () => {
    const spy = vi.fn();
    const [count, setCount] = createSignal(0);
    createRoot((dispose) => {
      dispose();
      createRoot(() => {
        createEffect(() => { count(); spy(); });
      });
    });
    expect(spy).toHaveBeenCalledTimes(1);
    setCount(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('userland disposer registered before an in-setup dispose() still runs', () => {
    const cleanupSpy = vi.fn();
    createRoot((dispose) => {
      createEffect(() => () => { cleanupSpy(); });
      dispose();
    });
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
  });

  it('createUnownedRoot: effect after in-setup dispose() is torn down', () => {
    const spy = vi.fn();
    const [count, setCount] = createSignal(0);
    createUnownedRoot((dispose) => {
      dispose();
      createEffect(() => { count(); spy(); });
    });
    expect(spy).toHaveBeenCalledTimes(1);
    setCount(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('in-setup dispose() then a post-setup dispose() remains idempotent', () => {
    const spy = vi.fn();
    const [count, setCount] = createSignal(0);
    let captured: (() => void) | undefined;
    createRoot((dispose) => {
      captured = dispose;
      dispose();
      createEffect(() => { count(); spy(); });
    });
    expect(() => captured && captured()).not.toThrow();
    setCount(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('createRoot still returns the callback value when disposed during setup', () => {
    const value = createRoot((dispose) => {
      dispose();
      return 42;
    });
    expect(value).toBe(42);
  });
});
