import { describe, it, expect, vi } from 'vitest';
import { createSignal } from '../signal';
import { createEffect } from '../effect';
import { createComputed } from '../computed';
import { createRoot } from '../root';
import { batch } from '../batch';

describe('batch', () => {
  it('batches multiple updates — effect runs once', () => {
    const spy = vi.fn();
    createRoot(() => {
      const [a, setA] = createSignal(0);
      const [b, setB] = createSignal(0);

      createEffect(() => {
        a();
        b();
        spy();
      });

      expect(spy).toHaveBeenCalledTimes(1);

      batch(() => {
        setA(1);
        setB(2);
      });

      // Effect should run only once more (not twice)
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  it('effect sees final values after batch', () => {
    const log: string[] = [];
    createRoot(() => {
      const [a, setA] = createSignal(0);
      const [b, setB] = createSignal(0);

      createEffect(() => {
        log.push(`${a()}-${b()}`);
      });

      expect(log).toEqual(['0-0']);

      batch(() => {
        setA(10);
        setB(20);
      });

      expect(log).toEqual(['0-0', '10-20']);
    });
  });

  it('nested batches — only outermost flush triggers effects', () => {
    const spy = vi.fn();
    createRoot(() => {
      const [a, setA] = createSignal(0);
      const [b, setB] = createSignal(0);
      const [c, setC] = createSignal(0);

      createEffect(() => {
        a();
        b();
        c();
        spy();
      });

      expect(spy).toHaveBeenCalledTimes(1);

      batch(() => {
        setA(1);
        batch(() => {
          setB(2);
          setC(3);
        });
        // Inner batch ended, but outer batch still open — no flush yet
      });

      // Only one additional run
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  it('updates without batch run effects per-signal', () => {
    const spy = vi.fn();
    createRoot(() => {
      const [a, setA] = createSignal(0);
      const [b, setB] = createSignal(0);

      createEffect(() => {
        a();
        b();
        spy();
      });

      expect(spy).toHaveBeenCalledTimes(1);

      // Without batch, each set triggers the effect
      setA(1);
      setB(2);
      expect(spy).toHaveBeenCalledTimes(3); // 1 initial + 2 updates
    });
  });

  it('errors inside batch do not break batching', () => {
    const spy = vi.fn();
    createRoot(() => {
      const [count, setCount] = createSignal(0);

      createEffect(() => {
        count();
        spy();
      });

      expect(spy).toHaveBeenCalledTimes(1);

      expect(() => {
        batch(() => {
          setCount(1);
          throw new Error('boom');
        });
      }).toThrow('boom');

      // The batch should have ended (via finally), so the update still takes effect
      expect(count()).toBe(1);
    });
  });

  it('batch with no updates does not trigger effects', () => {
    const spy = vi.fn();
    createRoot(() => {
      const [count] = createSignal(0);

      createEffect(() => {
        count();
        spy();
      });

      expect(spy).toHaveBeenCalledTimes(1);

      batch(() => {
        // no updates
      });

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  it('batch with computed dependencies', () => {
    const log: number[] = [];
    createRoot(() => {
      const [a, setA] = createSignal(1);
      const [b, setB] = createSignal(2);
      const sum = createComputed(() => a() + b());

      createEffect(() => {
        log.push(sum());
      });

      expect(log).toEqual([3]);

      batch(() => {
        setA(10);
        setB(20);
      });

      expect(log).toEqual([3, 30]);
    });
  });
});
