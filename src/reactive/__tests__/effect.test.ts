import { describe, it, expect, vi } from 'vitest';
import { createSignal } from '../signal';
import { createEffect } from '../effect';
import { createRoot } from '../root';
import { onCleanup } from '../cleanup';

describe('createEffect', () => {
  it('runs immediately on creation', () => {
    const spy = vi.fn();
    createRoot(() => {
      createEffect(() => { spy(); });
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('re-runs when dependency changes', () => {
    const log: number[] = [];
    createRoot(() => {
      const [count, setCount] = createSignal(0);
      createEffect(() => { log.push(count()); });

      expect(log).toEqual([0]);
      setCount(1);
      expect(log).toEqual([0, 1]);
      setCount(2);
      expect(log).toEqual([0, 1, 2]);
    });
  });

  it('tracks multiple dependencies', () => {
    const log: string[] = [];
    createRoot(() => {
      const [a, setA] = createSignal('a');
      const [b, setB] = createSignal('b');

      createEffect(() => { log.push(`${a()}-${b()}`); });
      expect(log).toEqual(['a-b']);

      setA('A');
      expect(log).toEqual(['a-b', 'A-b']);

      setB('B');
      expect(log).toEqual(['a-b', 'A-b', 'A-B']);
    });
  });

  it('does not re-run for unrelated signal changes', () => {
    const spy = vi.fn();
    createRoot(() => {
      const [tracked, setTracked] = createSignal(0);
      const [unrelated, setUnrelated] = createSignal(0);

      createEffect(() => {
        tracked();
        spy();
      });

      expect(spy).toHaveBeenCalledTimes(1);

      setUnrelated(1);
      expect(spy).toHaveBeenCalledTimes(1); // still 1

      setTracked(1);
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  it('cleanup function (returned) called before re-run', () => {
    const order: string[] = [];
    createRoot(() => {
      const [count, setCount] = createSignal(0);

      createEffect(() => {
        const c = count();
        order.push(`run:${c}`);
        return () => { order.push(`cleanup:${c}`); };
      });

      expect(order).toEqual(['run:0']);

      setCount(1);
      expect(order).toEqual(['run:0', 'cleanup:0', 'run:1']);

      setCount(2);
      expect(order).toEqual(['run:0', 'cleanup:0', 'run:1', 'cleanup:1', 'run:2']);
    });
  });

  it('cleanup function (via onCleanup) called before re-run', () => {
    const order: string[] = [];
    createRoot(() => {
      const [count, setCount] = createSignal(0);

      createEffect(() => {
        const c = count();
        order.push(`run:${c}`);
        onCleanup(() => { order.push(`cleanup:${c}`); });
      });

      expect(order).toEqual(['run:0']);

      setCount(1);
      expect(order).toEqual(['run:0', 'cleanup:0', 'run:1']);
    });
  });

  it('returns disposer function', () => {
    const spy = vi.fn();
    const [count, setCount] = createSignal(0);

    const dispose = createEffect(() => {
      count();
      spy();
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(typeof dispose).toBe('function');

    dispose();
    setCount(1);
    // After disposal, effect should not re-run
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('disposer runs final cleanup', () => {
    const cleanupSpy = vi.fn();
    const [count] = createSignal(0);

    const dispose = createEffect(() => {
      count();
      return () => { cleanupSpy(); };
    });

    expect(cleanupSpy).not.toHaveBeenCalled();
    dispose();
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
  });

  it('does not re-run when set to same value', () => {
    const spy = vi.fn();
    createRoot(() => {
      const [count, setCount] = createSignal(0);
      createEffect(() => {
        count();
        spy();
      });

      expect(spy).toHaveBeenCalledTimes(1);
      setCount(0); // same value
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  it('supports multiple onCleanup calls', () => {
    const cleanups: string[] = [];
    createRoot(() => {
      const [count, setCount] = createSignal(0);

      createEffect(() => {
        count();
        onCleanup(() => cleanups.push('a'));
        onCleanup(() => cleanups.push('b'));
        onCleanup(() => cleanups.push('c'));
      });

      expect(cleanups).toEqual([]);
      setCount(1);
      expect(cleanups).toEqual(['a', 'b', 'c']);
    });
  });

  it('nested effects run independently', () => {
    const outerLog: number[] = [];
    const innerLog: number[] = [];

    createRoot(() => {
      const [outer, setOuter] = createSignal(0);
      const [inner, setInner] = createSignal(0);

      createEffect(() => {
        outerLog.push(outer());
        createEffect(() => {
          innerLog.push(inner());
        });
      });

      expect(outerLog).toEqual([0]);
      expect(innerLog).toEqual([0]);

      setInner(1);
      expect(outerLog).toEqual([0]);
      expect(innerLog).toEqual([0, 1]);
    });
  });
});
