import { describe, it, expect, vi } from 'vitest';
import { createSignal } from '../signal';
import { createEffect } from '../effect';
import { createComputed } from '../computed';
import { createRoot } from '../root';
import { untrack } from '../untrack';

describe('untrack', () => {
  it('returns the value from the callback', () => {
    const [count] = createSignal(42);
    const result = untrack(() => count());
    expect(result).toBe(42);
  });

  it('reading signal inside untrack does not create dependency', () => {
    const spy = vi.fn();
    createRoot(() => {
      const [tracked, setTracked] = createSignal(0);
      const [untracked, setUntracked] = createSignal(0);

      createEffect(() => {
        tracked();
        untrack(() => untracked());
        spy();
      });

      expect(spy).toHaveBeenCalledTimes(1);

      // Changing untracked signal should NOT re-run the effect
      setUntracked(1);
      expect(spy).toHaveBeenCalledTimes(1);

      // Changing tracked signal SHOULD re-run the effect
      setTracked(1);
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  it('effect does not re-run for untracked reads', () => {
    const log: string[] = [];
    createRoot(() => {
      const [a, setA] = createSignal('a');
      const [b, setB] = createSignal('b');

      createEffect(() => {
        const aVal = a();
        const bVal = untrack(() => b());
        log.push(`${aVal}-${bVal}`);
      });

      expect(log).toEqual(['a-b']);

      setB('B');
      expect(log).toEqual(['a-b']); // no re-run

      setA('A');
      // When a changes and effect re-runs, it reads the current b value
      expect(log).toEqual(['a-b', 'A-B']);
    });
  });

  it('untrack can be nested', () => {
    const spy = vi.fn();
    createRoot(() => {
      const [a, setA] = createSignal(0);
      const [b, setB] = createSignal(0);

      createEffect(() => {
        untrack(() => {
          a();
          untrack(() => {
            b();
          });
        });
        spy();
      });

      expect(spy).toHaveBeenCalledTimes(1);

      setA(1);
      expect(spy).toHaveBeenCalledTimes(1);

      setB(1);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  it('untrack only affects the callback scope', () => {
    const spy = vi.fn();
    createRoot(() => {
      const [a, setA] = createSignal(0);
      const [b, setB] = createSignal(0);

      createEffect(() => {
        untrack(() => a());
        b(); // this is tracked normally
        spy();
      });

      expect(spy).toHaveBeenCalledTimes(1);

      setA(1);
      expect(spy).toHaveBeenCalledTimes(1); // a untracked

      setB(1);
      expect(spy).toHaveBeenCalledTimes(2); // b tracked
    });
  });

  it('works with computed values', () => {
    const spy = vi.fn();
    createRoot(() => {
      const [count, setCount] = createSignal(0);
      const doubled = createComputed(() => count() * 2);

      createEffect(() => {
        untrack(() => doubled());
        spy();
      });

      expect(spy).toHaveBeenCalledTimes(1);

      setCount(5);
      expect(spy).toHaveBeenCalledTimes(1); // no re-run
    });
  });
});
