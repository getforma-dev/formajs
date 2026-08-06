/**
 * `createList` initial render, keyed reconciliation, and row disposal.
 *
 * This is where the product thesis lives: no virtual DOM, no diffing, LIS-
 * minimal moves. It is also where the hardening lane added per-row work.
 * `reconcileList` now routes every removal through `removeRow` →
 * `deactivateIslandsIn` (src/dom/list.ts), which for each departing row runs
 * `instanceof Element`, `hasAttribute('data-forma-island')` and — the expensive
 * one — `row.querySelectorAll('[data-forma-island]')`. That is a full subtree
 * scan per removed row, in the one place the reconciler used to do a single
 * `parent.removeChild`.
 *
 * The removal benchmarks below therefore come in three shapes for the same
 * 1000 rows: the reconciler's remove-all, the same removal done by hand with
 * `removeChild` (the pre-hardening cost), and a build-only control so the
 * build half of each round trip can be subtracted.
 *
 * Reconciliation benchmarks are written as CYCLES (see bench/_support.ts): a
 * shuffle applies a fixed permutation, and an append is followed by the trim
 * that undoes it, so iteration 500 does exactly the work iteration 1 did.
 */

import { bench, describe } from 'vitest';
import { createSignal, createRoot, untrack } from 'forma/reactive';
import { createList, reconcileList, h } from 'forma/dom';
import {
  HEAVY,
  MACRO,
  MICRO,
  applyPermutation,
  detachedContainer,
  makeRows,
  permutation,
  type Row,
} from './_support';

const key = (r: Row): number => r.id;
const renderRow = (r: Row): HTMLElement => h('li', { class: 'todo', 'data-id': String(r.id) }, r.label);

// ---------------------------------------------------------------------------
// Initial render
// ---------------------------------------------------------------------------

describe('createList: initial render', () => {
  for (const [n, preset] of [[100, MACRO], [1000, MACRO], [10_000, HEAVY]] as const) {
    const rows = makeRows(n);
    bench(`${n} rows: createList → mount → first reconcile`, () => {
      createRoot((dispose) => {
        const parent = detachedContainer();
        const [items] = createSignal(rows);
        parent.appendChild(createList(items, key, renderRow));
        dispose();
      });
    }, preset);
  }

  // The floor: the same nodes, appended by hand. Everything above this line is
  // what keying, the marker pair, the per-row root and the index signal cost.
  for (const [n, preset] of [[1000, MACRO], [10_000, HEAVY]] as const) {
    const rows = makeRows(n);
    bench(`${n} rows: h() + appendChild by hand, no list (floor)`, () => {
      const parent = detachedContainer();
      for (let i = 0; i < n; i++) parent.appendChild(renderRow(rows[i]!));
    }, preset);
  }

  /**
   * The same nodes again, inserted before a trailing comment marker instead of
   * appended. This isolates the ONE structural difference between `createList`
   * and the appendChild floor above: the list delimits its range with comment
   * markers (so it can live inside `<table>`/`<ul>`/`<select>`) and therefore
   * inserts every row with `insertBefore(node, endMarker)`.
   *
   * It exists because the appendChild floor is linear (exactly 10× for 10× the
   * rows) while `createList` is not, and the superlinearity had been attributed
   * to Forma's per-row bookkeeping on suspicion alone. It is not: happy-dom's
   * `insertBefore` runs `nodeArray.includes(referenceNode)` AND
   * `nodeArray.indexOf(referenceNode)` on every call, which is two O(n) scans
   * per inserted row and O(n²) over the render. A browser does this in O(1).
   * See docs/PERFORMANCE.md § createList initial render.
   */
  for (const [n, preset] of [[1000, MACRO], [10_000, HEAVY]] as const) {
    const rows = makeRows(n);
    bench(`${n} rows: h() + insertBefore an end marker by hand, no list (floor)`, () => {
      const parent = detachedContainer();
      const endMarker = document.createComment('forma-list-end');
      parent.appendChild(endMarker);
      for (let i = 0; i < n; i++) parent.insertBefore(renderRow(rows[i]!), endMarker);
    }, preset);
  }

  /**
   * The other half: the per-row bookkeeping with NO DOM at all — one child root
   * and one index signal per row, the keyed cache, and the re-index pass that
   * runs after every reconcile. That is everything `createList` does around
   * `renderFn`, and nothing else.
   *
   * With the insertBefore floor above, this splits the gap between `createList`
   * and the appendChild floor into a DOM half and a reactive half, so the next
   * person does not have to guess which one is not scaling.
   */
  interface RowState { setIndex: (v: number) => void; dispose: () => void }

  for (const [n, preset] of [[1000, MACRO], [10_000, HEAVY]] as const) {
    bench(`${n} rows: per-row root + index signal + cache, no DOM (floor)`, () => {
      createRoot((dispose) => {
        const cache = new Map<number, RowState>();
        for (let i = 0; i < n; i++) {
          const [, setIndex] = createSignal(0);
          let rowDispose!: () => void;
          createRoot((d) => { rowDispose = d; });
          cache.set(i, { setIndex, dispose: rowDispose });
        }
        const rebuilt = new Map<number, RowState>();
        for (let i = 0; i < n; i++) {
          const cached = cache.get(i)!;
          cached.setIndex(i);
          rebuilt.set(i, cached);
        }
        dispose();
      });
    }, preset);
  }

  /**
   * The whole shape by hand, with the reconciler taken out: the marker pair in a
   * DocumentFragment, every row built inside its own child root with an index
   * signal and a cache entry and inserted before the end marker, the fragment
   * then mounted into the container, the cache rebuilt and re-indexed, and the
   * parent root disposed. Byte for byte what `createList` does on a first
   * render, minus `reconcileList` and the keyed bookkeeping around it.
   *
   * This is the benchmark that decides the question, because the two floors
   * above do NOT add up to `createList`: if this one lands on `createList`'s
   * number then nothing in the reconciler is superlinear and the growth belongs
   * to the environment, and the ladder (append → insertBefore → +reactive →
   * +fragment mount) says which step each millisecond came from.
   */
  for (const [n, preset] of [[1000, MACRO], [10_000, HEAVY]] as const) {
    const rows = makeRows(n);
    bench(`${n} rows: hand-rolled list, everything but the reconciler (floor)`, () => {
      createRoot((dispose) => {
        const container = detachedContainer();
        const fragment = document.createDocumentFragment();
        const startMarker = document.createComment('forma-list-start');
        const endMarker = document.createComment('forma-list-end');
        fragment.appendChild(startMarker);
        fragment.appendChild(endMarker);

        const cache = new Map<number, RowState>();
        for (let i = 0; i < n; i++) {
          const row = rows[i]!;
          const [, setIndex] = createSignal(0);
          let rowDispose!: () => void;
          const el = createRoot((d) => { rowDispose = d; return untrack(() => renderRow(row)); });
          fragment.insertBefore(el, endMarker);
          cache.set(row.id, { setIndex, dispose: rowDispose });
        }
        container.appendChild(fragment);

        const rebuilt = new Map<number, RowState>();
        for (let i = 0; i < n; i++) {
          const cached = cache.get(rows[i]!.id)!;
          cached.setIndex(i);
          rebuilt.set(rows[i]!.id, cached);
        }
        dispose();
      });
    }, preset);
  }
});

// ---------------------------------------------------------------------------
// Keyed reconciliation
// ---------------------------------------------------------------------------

/**
 * A mounted list whose items are driven by a signal. Built once per benchmark
 * at module scope; every benchmark body below returns it to its starting state
 * so repeated iterations are identical.
 */
function mountedList(rows: Row[]): { set: (r: Row[]) => void; parent: HTMLElement } {
  return createRoot(() => {
    const parent = detachedContainer();
    const [items, setItems] = createSignal(rows);
    parent.appendChild(createList(items, key, renderRow));
    return { set: setItems, parent };
  });
}

describe('createList: keyed reconciliation on 1000 rows', () => {
  const BASE = makeRows(1000);
  const APPENDED = BASE.concat(makeRows(100, 10_000));
  const PREPENDED = makeRows(100, 20_000).concat(BASE);
  const REMOVED = BASE.slice(100);
  const PERM = permutation(1000);
  const SHUFFLED = applyPermutation(BASE, PERM);

  const appendList = mountedList(BASE);
  bench('append 100 + trim back to 1000 (round trip)', () => {
    appendList.set(APPENDED);
    appendList.set(BASE);
  }, MACRO);

  const prependList = mountedList(BASE);
  bench('prepend 100 + trim back to 1000 (round trip)', () => {
    prependList.set(PREPENDED);
    prependList.set(BASE);
  }, MACRO);

  const removeList = mountedList(BASE);
  bench('remove first 100 + restore (round trip)', () => {
    removeList.set(REMOVED);
    removeList.set(BASE);
  }, MACRO);

  // A permutation is its own cycle: applying it repeatedly keeps producing a
  // fully scrambled order without ever needing a reset, so each sample is one
  // honest worst-case reconciliation rather than half of a round trip.
  const shuffleList = mountedList(BASE);
  let flip = false;
  bench('shuffle 1000 rows (one full reorder)', () => {
    flip = !flip;
    shuffleList.set(flip ? SHUFFLED : BASE);
  }, MACRO);

  // Same keys, same order: the reconciler's fast path. This is the update a
  // typical "one field changed" render produces, so it is the one that has to
  // be nearly free.
  const sameOrder = mountedList(BASE);
  const BASE_COPY = BASE.slice();
  let toggle = false;
  bench('same keys, same order — reconciler fast path', () => {
    toggle = !toggle;
    sameOrder.set(toggle ? BASE_COPY : BASE);
  }, MACRO);
});

describe('createList: keyed reconciliation on 100 rows (small-list path)', () => {
  // Under SMALL_LIST_THRESHOLD (32) reconcileList takes the flat-scan path; at
  // 100 it takes the Map path. Both are worth pinning, since the threshold is a
  // tuning constant nobody has re-measured since it was chosen.
  for (const n of [20, 100] as const) {
    const base = makeRows(n);
    const perm = permutation(n);
    const shuffled = applyPermutation(base, perm);
    const list = mountedList(base);
    let flip = false;
    bench(`shuffle ${n} rows (one full reorder)`, () => {
      flip = !flip;
      list.set(flip ? shuffled : base);
    }, MICRO);
  }
});

// ---------------------------------------------------------------------------
// Row disposal — what deactivateIslandsIn costs per removed row
// ---------------------------------------------------------------------------

/**
 * `reconcileList` is exported, so removal can be measured without the signal
 * plumbing in the way. Each benchmark builds its own rows and then removes
 * them; the build-only control is subtracted to leave the removal cost.
 */
describe('reconcileList: row removal', () => {
  const N = 1000;
  const ROWS = makeRows(N);
  const NONE: Row[] = [];
  const noopUpdate = (): void => {};

  function build(): { parent: HTMLElement; nodes: Node[] } {
    const parent = detachedContainer();
    const nodes = new Array<Node>(N);
    for (let i = 0; i < N; i++) {
      const node = renderRow(ROWS[i]!);
      parent.appendChild(node);
      nodes[i] = node;
    }
    return { parent, nodes };
  }

  bench(`${N} plain rows: build only (control)`, () => {
    build();
  }, MACRO);

  bench(`${N} plain rows: build + reconcileList removes all`, () => {
    const { parent, nodes } = build();
    reconcileList(parent, ROWS, NONE, nodes, key, renderRow, noopUpdate);
  }, MACRO);

  bench(`${N} plain rows: build + removeChild by hand (pre-hardening cost)`, () => {
    const { parent, nodes } = build();
    for (let i = 0; i < N; i++) parent.removeChild(nodes[i]!);
  }, MACRO);

  /**
   * Rows with real depth. `deactivateIslandsIn` runs `querySelectorAll` over
   * each departing row, so its cost scales with the row's subtree size, not with
   * the row count alone — a flat `<li>` is the cheapest case the guard ever
   * sees and would understate it.
   */
  const deepRow = (r: Row): HTMLElement =>
    h('li', { class: 'todo', 'data-id': String(r.id) },
      h('span', { class: 'handle' }, '::'),
      h('div', { class: 'body' },
        h('strong', { class: 'title' }, r.label),
        h('p', { class: 'meta' }, 'updated just now'),
      ),
      h('button', { class: 'btn', type: 'button' }, 'x'),
    );

  function buildDeep(): { parent: HTMLElement; nodes: Node[] } {
    const parent = detachedContainer();
    const nodes = new Array<Node>(N);
    for (let i = 0; i < N; i++) {
      const node = deepRow(ROWS[i]!);
      parent.appendChild(node);
      nodes[i] = node;
    }
    return { parent, nodes };
  }

  bench(`${N} 6-node rows: build only (control)`, () => {
    buildDeep();
  }, MACRO);

  bench(`${N} 6-node rows: build + reconcileList removes all`, () => {
    const { parent, nodes } = buildDeep();
    reconcileList(parent, ROWS, NONE, nodes, key, deepRow, noopUpdate);
  }, MACRO);

  bench(`${N} 6-node rows: build + removeChild by hand (pre-hardening cost)`, () => {
    const { parent, nodes } = buildDeep();
    for (let i = 0; i < N; i++) parent.removeChild(nodes[i]!);
  }, MACRO);
});

// ---------------------------------------------------------------------------
// Full teardown through createList
// ---------------------------------------------------------------------------

describe('createList: full teardown', () => {
  const ROWS = makeRows(1000);
  const NONE: Row[] = [];
  const list = mountedList(ROWS);

  bench('1000 rows → [] → 1000 rows (drain + refill round trip)', () => {
    list.set(NONE);
    list.set(ROWS);
  }, MACRO);
});
