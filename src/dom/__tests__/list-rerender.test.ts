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

  it.each([8, 64])('tracks replaced rows through both reconcile paths at n=%i', (size) => {
    // The replacement is createList's own ('rerender'); n=8 takes the small
    // path and n=64 the keyed one, each in order and reversed.
    createRoot((dispose) => {
      const start = Array.from({ length: size }, (_, id) => ({ id, v: 0 }));
      const [items, setItems] = createSignal(start);
      const container = h('div', null, createList(items, (item) => item.id,
        (item) => h(item.v % 2 ? 'i' : 'span', null, `${item.id}`), { updateOnItemChange: 'rerender' }));
      const ids = () => Array.from(container.children, (el) => Number(el.textContent));
      setItems(start.map((item) => ({ ...item, v: 1 })));
      expect(Array.from(container.children).every((el) => el.tagName === 'I')).toBe(true);
      expect(ids()).toEqual(start.map((item) => item.id));
      setItems(start.map((item) => ({ ...item, v: 2 })).reverse());
      expect(Array.from(container.children).every((el) => el.tagName === 'SPAN')).toBe(true);
      expect(ids()).toEqual(start.map((item) => item.id).reverse());
      expect(container.children).toHaveLength(size);
      dispose();
    });
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

  it('reconcileList ignores a node returned by a public update callback', () => {
    // 2.0.1's contract: updateFn patches the row in place, and whatever its
    // body evaluates to is not a replacement. An expression-bodied callback
    // returns appendChild's argument, which must not take the row's place.
    const parent = document.createElement('ul');
    const rows = ['a', 'b', 'c'].map((key) => {
      const li = document.createElement('li');
      li.appendChild(document.createElement('span')).textContent = key;
      parent.appendChild(li);
      return li;
    });
    const items = [{ k: 'a' }, { k: 'b' }, { k: 'c' }];
    const next = [{ k: 'c' }, { k: 'a' }, { k: 'b' }];
    const result = reconcileList(parent, items, next, rows, (x) => x.k,
      () => document.createElement('li'),
      (node, item) => node.firstChild!.appendChild(document.createTextNode(`+${item.k}`)));

    expect(Array.from(parent.children)).toEqual([rows[2], rows[0], rows[1]]);
    expect(result.nodes).toEqual([rows[2], rows[0], rows[1]]);
    expect(Array.from(parent.children, (li) => li.textContent)).toEqual(['c+c', 'a+a', 'b+b']);
    const again = reconcileList(parent, next, next, result.nodes, (x) => x.k,
      () => document.createElement('li'),
      (node, item) => node.firstChild!.appendChild(document.createTextNode(`!${item.k}`)));
    expect(again.nodes).toEqual([rows[2], rows[0], rows[1]]);
    expect(Array.from(parent.children, (li) => li.textContent)).toEqual(['c+c!c', 'a+a!a', 'b+b!b']);
  });
});
