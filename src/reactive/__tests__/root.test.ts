import { describe, it, expect, vi } from 'vitest';
import { createSignal } from '../signal';
import { createEffect } from '../effect';
import { createRoot, createUnownedRoot } from '../root';

describe('createRoot', () => {
  it('provides disposal scope', () => {
    const spy = vi.fn();
    const [count, setCount] = createSignal(0);

    createRoot((dispose) => {
      createEffect(() => {
        count();
        spy();
      });

      expect(spy).toHaveBeenCalledTimes(1);

      setCount(1);
      expect(spy).toHaveBeenCalledTimes(2);

      dispose();
    });

    // After disposal, effect should not re-run
    setCount(2);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('disposes all effects on cleanup', () => {
    const spy1 = vi.fn();
    const spy2 = vi.fn();
    const [count, setCount] = createSignal(0);

    createRoot((dispose) => {
      createEffect(() => { count(); spy1(); });
      createEffect(() => { count(); spy2(); });

      expect(spy1).toHaveBeenCalledTimes(1);
      expect(spy2).toHaveBeenCalledTimes(1);

      dispose();
    });

    setCount(1);
    expect(spy1).toHaveBeenCalledTimes(1); // not re-run
    expect(spy2).toHaveBeenCalledTimes(1); // not re-run
  });

  it('returns value from callback', () => {
    const result = createRoot(() => {
      return 42;
    });
    expect(result).toBe(42);
  });

  it('nested roots dispose independently', () => {
    const outerSpy = vi.fn();
    const innerSpy = vi.fn();
    const [count, setCount] = createSignal(0);

    let disposeInner!: () => void;

    createRoot(() => {
      createEffect(() => { count(); outerSpy(); });

      createRoot((dispose) => {
        disposeInner = dispose;
        createEffect(() => { count(); innerSpy(); });
      });
    });

    expect(outerSpy).toHaveBeenCalledTimes(1);
    expect(innerSpy).toHaveBeenCalledTimes(1);

    setCount(1);
    expect(outerSpy).toHaveBeenCalledTimes(2);
    expect(innerSpy).toHaveBeenCalledTimes(2);

    // Dispose inner root only
    disposeInner();
    setCount(2);
    expect(outerSpy).toHaveBeenCalledTimes(3); // outer still runs
    expect(innerSpy).toHaveBeenCalledTimes(2); // inner stopped
  });

  it('dispose is idempotent (calling twice is safe)', () => {
    const spy = vi.fn();
    const [count, setCount] = createSignal(0);

    createRoot((dispose) => {
      createEffect(() => { count(); spy(); });
      dispose();
      dispose(); // second call should be a no-op
    });

    setCount(1);
    expect(spy).toHaveBeenCalledTimes(1); // only the initial run
  });

  it('deeply nested roots all get cleaned up through parent disposal', () => {
    const spies = [vi.fn(), vi.fn(), vi.fn()];
    const [count, setCount] = createSignal(0);

    let disposeOuter!: () => void;

    createRoot((dispose) => {
      disposeOuter = dispose;
      createEffect(() => { count(); spies[0]!(); });

      createRoot(() => {
        createEffect(() => { count(); spies[1]!(); });

        createRoot(() => {
          createEffect(() => { count(); spies[2]!(); });
        });
      });
    });

    setCount(1);
    expect(spies[0]).toHaveBeenCalledTimes(2);
    expect(spies[1]).toHaveBeenCalledTimes(2);
    expect(spies[2]).toHaveBeenCalledTimes(2);

    // Disposing outer root cascades to all child roots (Solid-style ownership)
    disposeOuter();
    setCount(2);
    expect(spies[0]).toHaveBeenCalledTimes(2); // stopped
    expect(spies[1]).toHaveBeenCalledTimes(2); // stopped
    expect(spies[2]).toHaveBeenCalledTimes(2); // stopped
  });

  it('child root dispose is idempotent after parent disposal', () => {
    const spy = vi.fn();
    const [count, setCount] = createSignal(0);

    let disposeOuter!: () => void;
    let disposeInner!: () => void;

    createRoot((dispose) => {
      disposeOuter = dispose;
      createRoot((dispose2) => {
        disposeInner = dispose2;
        createEffect(() => { count(); spy(); });
      });
    });

    expect(spy).toHaveBeenCalledTimes(1);
    setCount(1);
    expect(spy).toHaveBeenCalledTimes(2);

    // Parent disposes child via cascade
    disposeOuter();
    // Manually disposing child again is a safe no-op
    expect(() => disposeInner()).not.toThrow();

    setCount(2);
    expect(spy).toHaveBeenCalledTimes(2); // still stopped
  });

  it('createUnownedRoot does NOT auto-register with parent', () => {
    const outerSpy = vi.fn();
    const innerSpy = vi.fn();
    const [count, setCount] = createSignal(0);

    let disposeOuter!: () => void;
    let disposeInner!: () => void;

    createRoot((dispose) => {
      disposeOuter = dispose;
      createEffect(() => { count(); outerSpy(); });

      createUnownedRoot((dispose2) => {
        disposeInner = dispose2;
        createEffect(() => { count(); innerSpy(); });
      });
    });

    setCount(1);
    expect(outerSpy).toHaveBeenCalledTimes(2);
    expect(innerSpy).toHaveBeenCalledTimes(2);

    // Disposing outer root does NOT cascade to unowned inner root
    disposeOuter();
    setCount(2);
    expect(outerSpy).toHaveBeenCalledTimes(2); // stopped
    expect(innerSpy).toHaveBeenCalledTimes(3); // still running!

    // Must dispose unowned root manually
    disposeInner();
    setCount(3);
    expect(innerSpy).toHaveBeenCalledTimes(3); // now stopped
  });

  it('createUnownedRoot works at top level (no parent root)', () => {
    const spy = vi.fn();
    const [count, setCount] = createSignal(0);

    let dispose!: () => void;
    createUnownedRoot((d) => {
      dispose = d;
      createEffect(() => { count(); spy(); });
    });

    expect(spy).toHaveBeenCalledTimes(1);
    setCount(1);
    expect(spy).toHaveBeenCalledTimes(2);

    dispose();
    setCount(2);
    expect(spy).toHaveBeenCalledTimes(2); // stopped
  });
});
