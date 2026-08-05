import { describe, it, expect, vi } from 'vitest';
import { createList, reconcileList } from '../list';
import { createSignal } from '../../reactive/signal';
import { createEffect } from '../../reactive/effect';
import { createRoot } from '../../reactive/root';

function mountFragment(frag: DocumentFragment): HTMLElement {
  const container = document.createElement('div');
  container.appendChild(frag);
  return container;
}

describe('createList disposal', () => {
  it('item effects are disposed when item is removed from list', () => {
    const spy = vi.fn();
    const [items, setItems] = createSignal([
      { id: 1, text: 'A' },
      { id: 2, text: 'B' },
    ]);
    const [tick, setTick] = createSignal(0);

    createRoot(() => {
      const frag = createList(
        items,
        (item) => item.id,
        (item) => {
          const el = document.createElement('div');
          createEffect(() => {
            tick(); // subscribe to tick
            spy(item.id);
          });
          el.textContent = item.text;
          return el;
        },
      );
      mountFragment(frag);
    });

    // Both items' effects ran once
    expect(spy).toHaveBeenCalledTimes(2);

    // Tick — both effects run again
    setTick(1);
    expect(spy).toHaveBeenCalledTimes(4);

    // Remove item 2
    setItems([{ id: 1, text: 'A' }]);

    // Tick — only item 1's effect should run (item 2 is disposed)
    spy.mockClear();
    setTick(2);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(1);
  });

  it('all item effects are disposed when parent root is disposed', () => {
    const spy = vi.fn();
    const [items] = createSignal([
      { id: 1, text: 'A' },
      { id: 2, text: 'B' },
    ]);
    const [tick, setTick] = createSignal(0);

    let disposeRoot!: () => void;

    createRoot((dispose) => {
      disposeRoot = dispose;
      const frag = createList(
        items,
        (item) => item.id,
        (item) => {
          const el = document.createElement('div');
          createEffect(() => {
            tick();
            spy(item.id);
          });
          el.textContent = item.text;
          return el;
        },
      );
      mountFragment(frag);
    });

    expect(spy).toHaveBeenCalledTimes(2);

    // Dispose root — all item effects should stop
    disposeRoot();
    spy.mockClear();

    setTick(1);
    expect(spy).toHaveBeenCalledTimes(0); // no orphaned effects
  });
});

// ---------------------------------------------------------------------------
// Islands inside removed rows (islands-inside-removed-list-rows-never-deactivated)
// ---------------------------------------------------------------------------

describe('island teardown on row removal', () => {
  function makeIsland(id: number, onDispose: (id: number) => void): HTMLElement {
    const island = document.createElement('span');
    island.setAttribute('data-forma-island', String(id));
    island.setAttribute('data-forma-status', 'active');
    (island as any).__formaDispose = () => onDispose(id);
    return island;
  }

  it('deactivates an island inside a removed row', () => {
    const disposed: number[] = [];
    const [items, setItems] = createSignal([{ id: 1 }, { id: 2 }]);

    createRoot(() => {
      const frag = createList(
        items,
        (item) => item.id,
        (item) => {
          const row = document.createElement('div');
          row.appendChild(makeIsland(item.id, (id) => disposed.push(id)));
          return row;
        },
      );
      mountFragment(frag);
    });

    expect(disposed).toEqual([]);

    // Row 2 leaves: its island root is unowned (createUnownedRoot in
    // activate.ts), so nothing else would ever tear it down.
    setItems([{ id: 1 }]);
    expect(disposed).toEqual([2]);

    // Row 1 leaves via the "new list is empty" path.
    setItems([]);
    expect(disposed).toEqual([2, 1]);
  });

  it('deactivates an island that IS the removed row element', () => {
    const disposed: number[] = [];
    const [items, setItems] = createSignal([{ id: 1 }, { id: 2 }]);

    createRoot(() => {
      const frag = createList(
        items,
        (item) => item.id,
        (item) => makeIsland(item.id, (id) => disposed.push(id)),
      );
      mountFragment(frag);
    });

    setItems([{ id: 2 }]);
    expect(disposed).toEqual([1]);
  });

  it('defers island deactivation until an animated row is actually removed', () => {
    const disposed: number[] = [];
    const parent = document.createElement('div');
    const rowA = document.createElement('div');
    rowA.appendChild(makeIsland(1, (id) => disposed.push(id)));
    parent.appendChild(rowA);

    let finish: (() => void) | undefined;
    reconcileList(
      parent,
      [{ id: 1 }],
      [],
      [rowA],
      (item: { id: number }) => item.id,
      () => document.createElement('div'),
      () => {},
      null,
      { onBeforeRemove: (_node, done) => { finish = done; } },
    );

    // Exit animation in flight: the island keeps working.
    expect(disposed).toEqual([]);
    expect(parent.contains(rowA)).toBe(true);

    finish!();
    expect(disposed).toEqual([1]);
    expect(parent.contains(rowA)).toBe(false);
  });
});
