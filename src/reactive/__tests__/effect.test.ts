import { describe, it, expect, vi } from 'vitest';
import { createSignal } from '../signal';
import { createEffect, internalEffect } from '../effect';
import { createRoot } from '../root';
import { onCleanup } from '../cleanup';
import { onError } from '../dev';

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

// ---------------------------------------------------------------------------
// internalEffect — per-binding error isolation (throwing-binding-aborts-flush)
// ---------------------------------------------------------------------------

describe('internalEffect error isolation', () => {
  it('a binding that throws on re-run does not abort the flush for other bindings', () => {
    const [count, setCount] = createSignal(0);
    const seen: number[] = [];
    const reported: unknown[] = [];
    const off = onError((err) => { reported.push(err); });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let dispose!: () => void;

    createRoot((d) => {
      dispose = d;
      // Island A's binding: fine on the first run, throws on every update.
      internalEffect(() => {
        if (count() > 0) throw new Error('island A binding is broken');
      });
      // Island B's binding on the SAME signal, queued after A.
      internalEffect(() => { seen.push(count()); });
    });

    expect(seen).toEqual([0]);

    // The write must not throw at the (unrelated) setter call site...
    expect(() => setCount(1)).not.toThrow();
    // ...and island B must still have been updated by that same flush.
    expect(seen).toEqual([0, 1]);
    // A second write still reaches B (the broken binding stays subscribed).
    setCount(2);
    expect(seen).toEqual([0, 1, 2]);

    // The error is reported, not swallowed.
    expect(reported).toHaveLength(2);
    expect((reported[0] as Error).message).toBe('island A binding is broken');

    dispose();
    off();
    consoleError.mockRestore();
  });

  it('a binding that throws on its first run still propagates to the caller', () => {
    // The first run is synchronous inside the caller (h() / adoption / mount),
    // which is how a broken component is reported as a failed island instead of
    // silently half-building.
    expect(() => {
      createRoot(() => {
        internalEffect(() => { throw new Error('boom on create'); });
      });
    }).toThrow('boom on create');
  });
});
