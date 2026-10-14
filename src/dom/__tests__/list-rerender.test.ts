import { describe, expect, it, vi } from 'vitest';
import { createEffect, createRoot, createSignal, onError, registerDisposer } from '../../reactive';
import { h } from '../element';
import { createList, reconcileList } from '../list';

describe('owned list rerenders', () => {
  it('disposes every replaced generation and all remaining effects on removal', () => {
    const [items, setItems] = createSignal([{ id: 1, label: 'A' }]);
    const [tick, setTick] = createSignal(0);
    const runs = vi.fn();
    const cleanups = vi.fn();
    const spans: HTMLElement[] = [];
    let disposeRoot!: () => void;
    const container = createRoot((dispose) => {
      disposeRoot = dispose;
      return h('ul', null, createList(items, (item) => item.id, (item) => {
        createEffect(() => {
          runs(item.label, tick());
          return () => cleanups(item.label);
        });
        const span = h('span', null, () => `${item.label}:${tick()}`);
        spans.push(span);
        return h('li', null, span);
      }, { updateOnItemChange: 'rerender' }));
    });
    setItems([{ id: 1, label: 'B' }]);
    setItems([{ id: 1, label: 'C' }]);
    expect(cleanups.mock.calls).toEqual([['A'], ['B']]);
    runs.mockClear();
    setTick(1);
    expect(runs.mock.calls).toEqual([['C', 1]]);
    expect(spans.map((span) => span.textContent)).toEqual(['A:0', 'B:0', 'C:1']);
    expect(container.textContent).toBe('C:1');
    setItems([]);
    runs.mockClear();
    setTick(2);
    expect(runs).not.toHaveBeenCalled();
    disposeRoot();
    expect(cleanups.mock.calls.map(([label]) => label)).toEqual(['A', 'B', 'C', 'C']);
  });

  it('does not leave a new reactive root detached when the root has bindings or events', () => {
    createRoot((dispose) => {
      const [items, setItems] = createSignal([{ id: 1, label: 'A' }]);
      const [tick, setTick] = createSignal(0);
      const clicked = vi.fn();
      const container = h('div', null, createList(items, (item) => item.id, (item) =>
        h('button', { class: () => `row-${tick()}`, onClick: () => clicked(item.label) },
          () => `${item.label}:${tick()}`),
      { updateOnItemChange: 'rerender' }));
      const first = container.firstElementChild as HTMLElement;
      setItems([{ id: 1, label: 'B' }]);
      const current = container.firstElementChild as HTMLElement;
      expect(current).not.toBe(first);
      current.click();
      expect(clicked).toHaveBeenCalledWith('B');
      setTick(1);
      expect(current.textContent).toBe('B:1');
      expect(first.textContent).toBe('A:0');
      expect(first.className).toBe('row-0');
      dispose();
      setTick(2);
      expect(current.textContent).toBe('B:1');
    });
  });

  it('disposes imperative row-root effects and retains the new ref target', () => {
    createRoot((dispose) => {
      const [items, setItems] = createSignal([{ id: 1, label: 'A' }]);
      const [tick, setTick] = createSignal(0);
      let ref!: HTMLElement;
      const container = h('div', null, createList(items, (item) => item.id, (item) => {
        const row = h('div', { ref: (el: HTMLElement) => { ref = el; } });
        createEffect(() => { row.textContent = `${item.label}:${tick()}`; });
        return row;
      }, { updateOnItemChange: 'rerender' }));
      const first = ref;
      setItems([{ id: 1, label: 'B' }]);
      expect(container.firstElementChild).toBe(ref);
      setTick(1);
      expect(ref.textContent).toBe('B:1');
      expect(first.textContent).toBe('A:0');
      dispose();
    });
  });

  it.each([8, 64])('retains unchanged keyed rows and reconciles replacements/reorders at n=%i', (size) => {
    createRoot((dispose) => {
      const original = Array.from({ length: size }, (_, id) => ({ id, label: `Item ${id}` }));
      const [items, setItems] = createSignal(original);
      const container = h('ul', null, createList(items, (item) => item.id, (item, index) =>
        h('li', { 'data-id': item.id }, () => `${index()}:${item.label}`),
      { updateOnItemChange: 'rerender' }));
      const nodes = Array.from(container.children);
      setItems([...original]);
      expect(Array.from(container.children)).toEqual(nodes);
      const next = [...original].reverse();
      const changed = Math.floor(size / 2);
      next[changed] = { ...next[changed]!, label: 'Changed' };
      setItems(next);
      next.forEach((item, index) => {
        const row = container.children[index]!;
        expect(row.textContent).toBe(`${index}:${item.label}`);
        if (index !== changed) expect(row).toBe(nodes[item.id]);
        else expect(row).not.toBe(nodes[item.id]);
      });
      setItems(next.slice(0, 2));
      expect(container.children).toHaveLength(2);
      expect(container.children[0]!.textContent).toBe(`0:${next[0]!.label}`);
      dispose();
    });
  });

  it.each([8, 64])('tracks replacement nodes in low-level reconciliation at n=%i', (size) => {
    const items = Array.from({ length: size }, (_, id) => ({ id }));
    const parent = h('div');
    const oldNodes = items.map((item) => h('span', null, item.id));
    parent.append(...oldNodes);
    const result = reconcileList(parent, items, items, oldNodes, (item) => item.id,
      () => h('b'), (_node, item) => h('i', null, item.id));
    expect(result.nodes).toEqual(Array.from(parent.children));
    expect(result.nodes.every((node) => (node as Element).tagName === 'I')).toBe(true);
  });

  it('disposes item roots if a non-array value clears the list', () => {
    createRoot((dispose) => {
      const [items, setItems] = createSignal<unknown>([{ id: 1 }]);
      const cleanups = vi.fn();
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const container = h('div', null, createList(items as () => { id: number }[], (item) => item.id, () => {
        registerDisposer(cleanups);
        return h('span');
      }));
      setItems(null);
      expect(container.childElementCount).toBe(0);
      expect(cleanups).toHaveBeenCalledTimes(1);
      dispose();
      expect(cleanups).toHaveBeenCalledTimes(1);
      warning.mockRestore();
    });
  });

  it('cleans partially rendered failed candidates and keeps the prior row live', () => {
    createRoot((dispose) => {
      const [items, setItems] = createSignal([{ id: 1, label: 'A' }]);
      const [tick, setTick] = createSignal(0);
      const runs = vi.fn();
      const cleanups = vi.fn();
      const stopErrors = onError(() => {});
      const container = h('div', null, createList(items, (item) => item.id, (item) => {
        createEffect(() => { runs(item.label, tick()); return () => cleanups(item.label); });
        if (item.label === 'fail') throw new Error('test render failure');
        return h('span', null, item.label);
      }, { updateOnItemChange: 'rerender' }));
      setItems([{ id: 1, label: 'fail' }]);
      expect(container.textContent).toBe('A');
      expect(cleanups).toHaveBeenCalledWith('fail');
      runs.mockClear();
      setTick(1);
      expect(runs.mock.calls).toEqual([['A', 1]]);
      setItems([{ id: 1, label: 'B' }]);
      expect(container.textContent).toBe('B');
      stopErrors();
      dispose();
    });
  });
});
