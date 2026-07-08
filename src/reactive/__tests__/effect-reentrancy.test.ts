// Effect self-write re-entrancy (1.1.0): a running effect that writes a signal it
// depends on must re-run to observe the new value (alien-signals swallows the
// self-notify), bounded so a genuine cycle is reported instead of hanging.
import { describe, it, expect, vi } from 'vitest';
import { createSignal } from '../signal';
import { createEffect } from '../effect';
import { createRoot } from '../root';

describe('effect self-write re-entrancy (1.1.0)', () => {
  it('self-triggered dependency write re-runs the effect until it stabilises', () => {
    const seen: number[] = [];
    createRoot(() => {
      const [count, setCount] = createSignal(0);
      createEffect(() => {
        const c = count();
        seen.push(c);
        if (c < 3) setCount(c + 1);
      });
    });
    expect(seen).toEqual([0, 1, 2, 3]);
  });

  it('a same-value self-write does not cause an extra run or spin', () => {
    let runs = 0;
    createRoot(() => {
      const [count, setCount] = createSignal(5);
      createEffect(() => {
        runs++;
        count();
        setCount(5); // no change
      });
    });
    expect(runs).toBe(1);
  });

  it('unbounded self ping-pong is bounded and reported, not an infinite loop', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    createRoot(() => {
      const [count, setCount] = createSignal(0);
      createEffect(() => {
        const c = count();
        setCount(c + 1); // never stabilises
      });
    });
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('a nested effect self-write does not leak into the parent effect', () => {
    const outer: number[] = [];
    const inner: number[] = [];
    createRoot(() => {
      const [o] = createSignal(0);
      const [i, setI] = createSignal(0);
      createEffect(() => {
        outer.push(o());
        createEffect(() => {
          const iv = i();
          inner.push(iv);
          if (iv < 2) setI(iv + 1);
        });
      });
    });
    expect(inner).toEqual([0, 1, 2]);
    expect(outer).toEqual([0]);
  });

  it('functional-updater self-write also re-runs (covers the second write path)', () => {
    const seen: number[] = [];
    createRoot(() => {
      const [count, setCount] = createSignal(0);
      createEffect(() => {
        const c = count();
        seen.push(c);
        if (c < 2) setCount((p) => p + 1);
      });
    });
    expect(seen).toEqual([0, 1, 2]);
  });
});
