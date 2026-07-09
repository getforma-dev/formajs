// Fixes for defects found by adversarial verification of the 1.1.0 reactive work.
import { describe, it, expect } from 'vitest';
import { createSignal } from '../signal';
import { createEffect } from '../effect';
import { createComputed } from '../computed';
import { createResource } from '../resource';
import { createRoot } from '../root';
import { onCleanup } from '../cleanup';
import { batch } from '../batch';

describe('self-write detection is precise (HIGH)', () => {
  it('writing an UNRELATED signal does not spuriously re-run the effect', () => {
    let runs = 0;
    createRoot(() => {
      const [a] = createSignal(0);
      const [, setB] = createSignal(0);
      createEffect(() => {
        runs++;
        a();          // depends only on a
        setB(runs);   // writes b (never read) — must NOT trigger a self re-run
      });
    });
    expect(runs).toBe(1);
  });

  it('a computed getter writing an unrelated signal does not re-run the subscribing effect', () => {
    let runs = 0;
    createRoot(() => {
      const [trigger] = createSignal(0);
      const [, setSide] = createSignal(0);
      const c = createComputed(() => { setSide(trigger() + 100); return trigger() * 2; });
      createEffect(() => { runs++; c(); }); // never reads `side`
    });
    expect(runs).toBe(1);
  });

  it('createResource inside createEffect does not spuriously re-run the effect', () => {
    let runs = 0;
    createRoot(() => {
      const [dep] = createSignal(0);
      createEffect(() => {
        runs++;
        dep();
        createResource(() => true, () => new Promise<string>(() => {}));
      });
    });
    expect(runs).toBe(1);
  });

  it('a genuine self-write still converges', () => {
    const seen: number[] = [];
    createRoot(() => {
      const [n, setN] = createSignal(0);
      createEffect(() => { const c = n(); seen.push(c); if (c < 3) setN(c + 1); });
    });
    expect(seen).toEqual([0, 1, 2, 3]);
  });

  it('a batched self-write still converges', () => {
    const seen: number[] = [];
    createRoot(() => {
      const [n, setN] = createSignal(0);
      createEffect(() => { const c = n(); seen.push(c); if (c < 3) batch(() => setN(c + 1)); });
    });
    expect(seen).toEqual([0, 1, 2, 3]);
  });
});

describe('cleanup ordering: children before parents on both paths (MEDIUM)', () => {
  it('nested cleanup runs before the parent own-cleanup on re-run AND on dispose', () => {
    let parentResourceOpen = false;
    const rerun: string[] = [];
    const onDispose: string[] = [];
    let phase: string[] = rerun;
    let disposeRoot = () => {};
    createRoot((dispose) => {
      disposeRoot = dispose;
      const [o, setO] = createSignal(0);
      createEffect(() => {
        o();
        parentResourceOpen = true;
        onCleanup(() => { parentResourceOpen = false; phase.push('parent-free'); });
        createEffect(() => {
          onCleanup(() => phase.push('child-uses(open=' + String(parentResourceOpen) + ')'));
        });
      });
      // trigger a re-run
      phase = rerun;
      setO(1);
      // now capture dispose ordering
      phase = onDispose;
    });
    disposeRoot();
    expect(rerun).toEqual(['child-uses(open=true)', 'parent-free']);
    expect(onDispose).toEqual(['child-uses(open=true)', 'parent-free']);
  });
});

describe('resource settle writes are atomic and dispose-safe', () => {
  it('does not expose a glitch frame on fetch COMPLETION (MEDIUM)', async () => {
    let r: any;
    createRoot(() => {
      r = createResource(() => true, () => Promise.resolve('data'));
    });
    const frames: string[] = [];
    createRoot(() => {
      createEffect(() => {
        frames.push('L=' + String(r.loading()) + ' D=' + String(r()));
      });
    });
    frames.length = 0;
    await new Promise((res) => setTimeout(res, 10));
    // Completion must be a single atomic frame, not loading=false-then-data or
    // data-then-loading=false.
    expect(frames).toEqual(['L=false D=data']);
  });

  it('does not write loading after the owning root is disposed (LOW)', async () => {
    let loadingWritesAfterDispose = 0;
    let dispose = () => {};
    let r: any;
    dispose = createRoot((d) => {
      r = createResource(() => true, () => Promise.resolve('x'));
      return d;
    });
    // subscribe from an independent root that outlives the resource's root
    createRoot(() => {
      let first = true;
      createEffect(() => {
        r.loading();
        if (!first) loadingWritesAfterDispose++;
        first = false;
      });
    });
    dispose();
    await new Promise((res) => setTimeout(res, 10));
    expect(loadingWritesAfterDispose).toBe(0);
  });
});
