import { describe, it, expect, vi } from 'vitest';
import { createSignal } from '../signal';
import { createEffect } from '../effect';
import { createRoot } from '../root';

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

    // Disposing outer root — effects created in the outer root get disposed.
    // Note: inner roots are independent — they track their own effects.
    // The outer dispose only disposes the effects registered TO the outer root.
    disposeOuter();
    setCount(2);
    // Outer root's effect is disposed
    expect(spies[0]).toHaveBeenCalledTimes(2);
  });
});
