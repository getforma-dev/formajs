import { describe, it, expect, vi } from 'vitest';
import { createList, reconcileList } from '../list';
import { activateIslands, deactivateAllIslands, deactivateIsland } from '../activate';
import { createSignal } from '../../reactive/signal';
import { createEffect } from '../../reactive/effect';
import { createRoot, registerDisposer } from '../../reactive/root';

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

const ISLAND_SELECTOR = '[data-forma-island]';

/**
 * Count the `[data-forma-island]` subtree scans performed while `fn` runs.
 *
 * This is the *cost* side of the guard: `deactivateIslandsIn` used to run one
 * of these per departing row, on every list on every page, at ~19 µs per
 * six-node row (docs/PERFORMANCE.md § List row removal).
 */
function countIslandScans(fn: () => void): number {
  type QuerySelectorAll = (selector: string) => NodeListOf<Element>;
  const proto = Element.prototype as unknown as { querySelectorAll: QuerySelectorAll };
  const original = proto.querySelectorAll;
  let scans = 0;
  proto.querySelectorAll = function (this: Element, selector: string): NodeListOf<Element> {
    if (selector === ISLAND_SELECTOR) scans++;
    return original.call(this, selector);
  };
  try {
    fn();
  } finally {
    proto.querySelectorAll = original;
  }
  return scans;
}

/**
 * A REAL island, activated through `activateIslands`.
 *
 * Hand-assembling an element with a `__formaDispose` property would exercise
 * the subtree walk without exercising the count that decides whether to walk at
 * all — and would therefore keep passing if the count never incremented.
 * `activateIslands` (and, through it, `hydrateIslandRoot`) is the only way an
 * island acquires anything to tear down, which is exactly why the count is a
 * sound proxy for "a row might contain one".
 *
 * The shell carries text so `hydrateIsland` adopts it instead of taking the CSR
 * fallback, which replaces the element.
 */
function activateIslandIn(
  container: HTMLElement,
  id: number,
  onDispose: (id: number) => void,
  trigger?: string,
): HTMLElement {
  const island = document.createElement('span');
  island.setAttribute('data-forma-island', String(id));
  island.setAttribute('data-forma-component', 'Widget');
  if (trigger) island.setAttribute('data-forma-hydrate', trigger);
  island.textContent = 'ssr';
  container.appendChild(island);
  activateIslands({ Widget: () => { registerDisposer(() => onDispose(id)); } }, container);
  return island;
}

/** Build three island-free rows, remove them all, and report the scans it cost. */
function scansForPlainRowRemoval(): number {
  const parent = document.createElement('div');
  const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const nodes: Node[] = items.map(() => {
    const row = document.createElement('div');
    row.appendChild(document.createElement('span'));
    parent.appendChild(row);
    return row;
  });
  return countIslandScans(() => {
    reconcileList(
      parent,
      items,
      [],
      nodes,
      (item: { id: number }) => item.id,
      () => document.createElement('div'),
      () => {},
    );
  });
}

describe('island teardown on row removal', () => {
  it('deactivates an island inside a removed row', () => {
    const disposed: number[] = [];
    const [items, setItems] = createSignal([{ id: 1 }, { id: 2 }]);

    createRoot(() => {
      const frag = createList(
        items,
        (item) => item.id,
        (item) => {
          const row = document.createElement('div');
          activateIslandIn(row, item.id, (id) => disposed.push(id));
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
        (item) => activateIslandIn(
          document.createElement('div'),
          item.id,
          (id) => disposed.push(id),
        ),
      );
      mountFragment(frag);
    });

    setItems([{ id: 2 }]);
    expect(disposed).toEqual([1]);

    setItems([]);
    expect(disposed).toEqual([1, 2]);
  });

  it('defers island deactivation until an animated row is actually removed', () => {
    const disposed: number[] = [];
    const parent = document.createElement('div');
    const rowA = document.createElement('div');
    activateIslandIn(rowA, 1, (id) => disposed.push(id));
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

  it('deactivates a scheduled island that never hydrated inside a removed row', () => {
    const [items, setItems] = createSignal([{ id: 1 }]);
    let island!: HTMLElement;

    createRoot(() => {
      const frag = createList(
        items,
        (item) => item.id,
        (item) => {
          const row = document.createElement('div');
          island = activateIslandIn(row, item.id, () => {}, 'interaction');
          return row;
        },
      );
      mountFragment(frag);
    });

    // Scheduled, never hydrated: no reactive root yet, only the pointerdown /
    // focusin listeners — the leak the guard must not reintroduce.
    expect((island as any).__formaScheduled).toBe(true);
    expect(island.getAttribute('data-forma-status')).toBeNull();

    setItems([]);
    expect((island as any).__formaScheduled).toBeUndefined();
    expect((island as any).__formaInteractionHandler).toBeUndefined();
    expect((island as any).__formaDisposed).toBe(true);
    expect(scansForPlainRowRemoval()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The count that decides whether a departing row is scanned at all.
//
// A count that drifts UP silently restores the per-row subtree scan; a count
// that drifts DOWN silently restores the leak. Both directions are tested.
// ---------------------------------------------------------------------------

describe('the scheduled-or-active island count', () => {
  it('does not scan a removed row when no island has ever been activated', () => {
    expect(scansForPlainRowRemoval()).toBe(0);
  });

  it('scans every removed row while an island is live', () => {
    const holder = document.createElement('div');
    const island = activateIslandIn(holder, 1, () => {});

    // The control for the test above: with the count non-zero the scan happens,
    // so a zero there is the guard working, not a broken spy.
    expect(scansForPlainRowRemoval()).toBe(3);

    deactivateIsland(island);
    expect(scansForPlainRowRemoval()).toBe(0);
  });

  it('still deactivates a live island after a different island was deactivated', () => {
    const disposed: number[] = [];
    const holder = document.createElement('div');
    const other = activateIslandIn(holder, 1, (id) => disposed.push(id));

    const [items, setItems] = createSignal([{ id: 2 }]);
    createRoot(() => {
      const frag = createList(
        items,
        (item) => item.id,
        (item) => {
          const row = document.createElement('div');
          activateIslandIn(row, item.id, (id) => disposed.push(id));
          return row;
        },
      );
      mountFragment(frag);
    });

    deactivateIsland(other);
    expect(disposed).toEqual([1]);

    setItems([]);
    expect(disposed).toEqual([1, 2]);
    expect(scansForPlainRowRemoval()).toBe(0);
  });

  it('still deactivates a live island after the same island was deactivated twice', () => {
    const disposed: number[] = [];
    const holder = document.createElement('div');
    const other = activateIslandIn(holder, 1, (id) => disposed.push(id));

    const [items, setItems] = createSignal([{ id: 2 }]);
    createRoot(() => {
      const frag = createList(
        items,
        (item) => item.id,
        (item) => {
          const row = document.createElement('div');
          activateIslandIn(row, item.id, (id) => disposed.push(id));
          return row;
        },
      );
      mountFragment(frag);
    });

    // deactivateIsland is documented idempotent; the second call must not
    // decrement a second time and hide the island still inside the list.
    deactivateIsland(other);
    deactivateIsland(other);
    expect(disposed).toEqual([1]);

    setItems([]);
    expect(disposed).toEqual([1, 2]);
    expect(scansForPlainRowRemoval()).toBe(0);
  });

  it('stops scanning once every island has been deactivated with deactivateAllIslands', () => {
    const holder = document.createElement('div');
    activateIslandIn(holder, 1, () => {});
    activateIslandIn(holder, 2, () => {});
    expect(scansForPlainRowRemoval()).toBe(3);

    deactivateAllIslands(holder);
    expect(scansForPlainRowRemoval()).toBe(0);
  });

  it('stops scanning after an island whose hydrate function threw', () => {
    const holder = document.createElement('div');
    const island = document.createElement('span');
    island.setAttribute('data-forma-island', '1');
    island.setAttribute('data-forma-component', 'Broken');
    island.textContent = 'ssr';
    holder.appendChild(island);

    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    activateIslands({ Broken: () => { throw new Error('boom'); } }, holder);
    errors.mockRestore();

    expect(island.getAttribute('data-forma-status')).toBe('error');
    // A failed island has no root and no scheduled trigger left. If it kept
    // being counted, one broken island would make every list on the page pay
    // the subtree walk for the rest of the session.
    expect(scansForPlainRowRemoval()).toBe(0);
  });

  it('moves the count to the element that replaced an empty island shell', () => {
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const holder = document.createElement('div');
    const shell = document.createElement('span');
    shell.setAttribute('data-forma-island', '1');
    shell.setAttribute('data-forma-component', 'Widget');
    holder.appendChild(shell);

    let disposed = false;
    activateIslands({
      Widget: () => {
        registerDisposer(() => { disposed = true; });
        // An EMPTY shell takes hydrateIsland's CSR fallback, which replaces the
        // shell with the component's own root element.
        return document.createElement('article');
      },
    }, holder);
    warns.mockRestore();

    const replacement = holder.querySelector('article') as HTMLElement;
    expect(replacement.getAttribute('data-forma-island')).toBe('1');
    expect(holder.contains(shell)).toBe(false);
    expect(scansForPlainRowRemoval()).toBe(3);

    // deactivateIsland is called with the element actually in the tree, so the
    // count has to have moved there along with the disposer.
    deactivateIsland(replacement);
    expect(disposed).toBe(true);
    expect(scansForPlainRowRemoval()).toBe(0);
  });

  it('does not double-count an island that activateIslands is called on twice', () => {
    const holder = document.createElement('div');
    const island = activateIslandIn(holder, 1, () => {});
    activateIslands({ Widget: () => {} }, holder); // HMR / SPA re-mount
    expect(scansForPlainRowRemoval()).toBe(3);

    deactivateIsland(island);
    expect(scansForPlainRowRemoval()).toBe(0);
  });
});
