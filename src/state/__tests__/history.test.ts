import { describe, it, expect } from 'vitest';
import { createHistory } from '../history';
import { createSignal, batch } from 'forma/reactive';

describe('createHistory - object entries are snapshotted (bug 1)', () => {
  it('in-place mutation of a pushed object does not corrupt past history entries', () => {
    const [obj, setObj] = createSignal<{ n: number }>({ n: 0 });
    const h = createHistory([obj, setObj]);

    const v1 = { n: 1 };
    setObj(v1);
    const v2 = { n: 2 };
    setObj(v2);

    v1.n = 999;
    v2.n = 888;

    const hist = h.history() as Array<{ n: number }>;
    expect(hist[0].n).toBe(0);
    expect(hist[1].n).toBe(1);
    expect(hist[2].n).toBe(2);
  });

  it('undo returns a value that, when mutated, does not corrupt the stack', () => {
    const [obj, setObj] = createSignal<{ n: number }>({ n: 0 });
    const h = createHistory([obj, setObj]);

    setObj({ n: 1 });
    setObj({ n: 2 });

    h.undo();
    const restored = obj() as { n: number };
    expect(restored.n).toBe(1);
    restored.n = -1;

    const hist = h.history() as Array<{ n: number }>;
    expect(hist[1].n).toBe(1);
  });
});

describe('createHistory - batching robustness (bug 2)', () => {
  it('an external set batched together with undo() is still recorded', () => {
    const [count, setCount] = createSignal(0);
    const h = createHistory([count, setCount]);

    setCount(1);
    setCount(2);

    batch(() => {
      h.undo();
      setCount(50);
    });

    expect(count()).toBe(50);
    expect(h.history()).toContain(50);
    expect(h.history()[h.cursor()]).toBe(50);
    expect(h.canUndo()).toBe(true);
  });

  it('custom-equals source that suppresses the undo echo does not swallow the next set', () => {
    const [pt, setPt] = createSignal<{ v: number }>(
      { v: 0 },
      { equals: (a, b) => a.v === b.v },
    );
    const h = createHistory([pt, setPt]);

    setPt({ v: 1 });
    setPt({ v: 2 });

    h.undo();
    expect(pt().v).toBe(1);

    setPt({ v: 7 });
    expect(pt().v).toBe(7);
    expect(h.history().map((x: any) => x.v)).toContain(7);
    expect(h.history()[h.cursor()].v).toBe(7);
  });
});

describe('createHistory - destroy teardown (bug 3)', () => {
  it('exposes destroy() and stops tracking the source after destroy', () => {
    const [count, setCount] = createSignal(0);
    const h = createHistory([count, setCount]);

    expect(typeof h.destroy).toBe('function');

    setCount(1);
    expect(h.history()).toEqual([0, 1]);

    h.destroy();

    setCount(2);
    expect(h.history()).toEqual([0, 1]);
  });
});

describe('createHistory - existing behavior still holds', () => {
  it('undo/redo and canUndo/canRedo still work with primitives', () => {
    const [count, setCount] = createSignal(0);
    const h = createHistory([count, setCount]);
    setCount(1);
    setCount(2);
    expect(h.canRedo()).toBe(false);
    h.undo();
    expect(count()).toBe(1);
    expect(h.canRedo()).toBe(true);
    h.redo();
    expect(count()).toBe(2);
    expect(h.canRedo()).toBe(false);
  });
});