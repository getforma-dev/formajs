/**
 * `reconcileList` driven at DEPTH, through BOTH of its code paths.
 *
 * `SMALL_LIST_THRESHOLD` is 32: below it the reconciler does a flat array scan,
 * at or above it a Map + longest-increasing-subsequence keyed move. Every list
 * test in the suite used 2–5 items, so the LIS branch — the performance core of
 * a "no virtual DOM" library — executed zero times, and four separate mutations
 * of it survived the whole suite, including the duplicate-key collapse the
 * source comment claims was fixed.
 *
 * Every case here runs at BOTH sizes from one table, so neither branch can be
 * the one that is only covered by accident.
 */
import { describe, it, expect, vi } from 'vitest';
import { reconcileList } from '../list';

interface Row { id: number }

/** A parent whose children are `<i data-k="…">`, one per model row. */
function setup(ids: number[]): {
  parent: HTMLElement;
  items: Row[];
  nodes: Node[];
  created: number;
  updated: number;
} {
  const parent = document.createElement('div');
  const items = ids.map((id) => ({ id }));
  const nodes = items.map((item) => {
    const el = document.createElement('i');
    el.dataset.k = String(item.id);
    parent.appendChild(el);
    return el as Node;
  });
  return { parent, items, nodes, created: 0, updated: 0 };
}

const key = (r: Row): number => r.id;

function makeCreate(counter: { n: number }) {
  return (item: Row): Node => {
    counter.n += 1;
    const el = document.createElement('i');
    el.dataset.k = String(item.id);
    el.dataset.origin = 'created';
    return el;
  };
}

const update = (node: Node, item: Row): void => {
  (node as HTMLElement).dataset.k = String(item.id);
};

/** The keys actually present in the DOM, in document order. */
function domKeys(parent: HTMLElement): number[] {
  return [...parent.children].map((c) => Number((c as HTMLElement).dataset.k));
}

const range = (n: number, from = 0): number[] => Array.from({ length: n }, (_, i) => i + from);

/**
 * n = 8 exercises the flat-scan path, n = 64 the Map + LIS path. The threshold
 * is read from the OLD length, so both sizes are driven by the same table.
 */
const SIZES = [
  ['small (flat scan, n=8)', 8],
  ['large (Map + LIS, n=64)', 64],
] as const;

describe.each(SIZES)('keyed reconciliation — %s', (_label, n) => {
  /** Apply `next` to a list currently holding `range(n)` and return the state. */
  function reconcile(next: number[], hooks?: Parameters<typeof reconcileList>[8]): {
    parent: HTMLElement;
    before: Map<number, Node>;
    result: { nodes: Node[]; items: Row[] };
    created: { n: number };
    inserts: number;
  } {
    const { parent, items, nodes } = setup(range(n));
    const before = new Map<number, Node>(items.map((it, i) => [it.id, nodes[i]!]));
    const created = { n: 0 };
    let inserts = 0;
    const realInsert = parent.insertBefore.bind(parent);
    const realAppend = parent.appendChild.bind(parent);
    vi.spyOn(parent, 'insertBefore').mockImplementation(((node: Node, ref: Node | null) => {
      inserts += 1;
      return realInsert(node, ref);
    }) as typeof parent.insertBefore);
    vi.spyOn(parent, 'appendChild').mockImplementation(((node: Node) => {
      inserts += 1;
      return realAppend(node);
    }) as typeof parent.appendChild);

    const result = reconcileList(
      parent, items, next.map((id) => ({ id })), nodes, key, makeCreate(created), update,
      null, hooks,
    );
    vi.restoreAllMocks();
    return { parent, before, result, created, inserts };
  }

  it('a reversal ends in the model order with every node reused', () => {
    const next = range(n).reverse();
    const { parent, before, result, created } = reconcile(next);
    expect(domKeys(parent)).toEqual(next);
    expect(result.items.map(key)).toEqual(next);
    expect(created.n).toBe(0);
    for (const id of next) expect(parent.querySelector(`[data-k="${id}"]`)).toBe(before.get(id));
  });

  it('a shuffle ends in the model order with every node reused', () => {
    // Deterministic shuffle: a fixed permutation, not Math.random, so a failure
    // is reproducible.
    const next = range(n).map((_, i) => (i * 7 + 3) % n);
    const { parent, before, result, created } = reconcile(next);
    expect(domKeys(parent)).toEqual(next);
    expect(result.nodes).toHaveLength(n);
    expect(created.n).toBe(0);
    for (const id of next) expect(parent.querySelector(`[data-k="${id}"]`)).toBe(before.get(id));
  });

  it('removing from the middle takes those rows out of the DOM', () => {
    const removed = [Math.floor(n / 3), Math.floor(n / 2), n - 2];
    const next = range(n).filter((id) => !removed.includes(id));
    const { parent, result } = reconcile(next);
    expect(domKeys(parent)).toEqual(next);
    expect(parent.children).toHaveLength(next.length);
    for (const id of removed) expect(parent.querySelector(`[data-k="${id}"]`)).toBeNull();
    expect(result.items.map(key)).toEqual(next);
  });

  it('inserting at the head keeps every existing node and adds only the new one', () => {
    const next = [999, ...range(n)];
    const { parent, before, result, created } = reconcile(next);
    expect(domKeys(parent)).toEqual(next);
    expect(created.n).toBe(1);
    expect((parent.firstElementChild as HTMLElement).dataset.origin).toBe('created');
    for (const id of range(n)) expect(parent.querySelector(`[data-k="${id}"]`)).toBe(before.get(id));
    expect(result.nodes).toHaveLength(n + 1);
  });

  it('the LIS is preserved: moving one row moves ONE node, not the whole list', () => {
    // This is the property the algorithm exists for. Deleting the lisFlags
    // assignment leaves the DOM order correct and the work quadratic, so only a
    // count of the DOM moves can see it.
    const next = [n - 1, ...range(n - 1)];
    const { parent, inserts } = reconcile(next);
    expect(domKeys(parent)).toEqual(next);
    // One move for the row that actually moved. A reconciler that lost its LIS
    // bookkeeping re-inserts all n.
    expect(inserts).toBeLessThanOrEqual(2);
  });

  it('an unchanged list performs no DOM moves at all', () => {
    const { parent, before, inserts, created } = reconcile(range(n));
    expect(domKeys(parent)).toEqual(range(n));
    expect(inserts).toBe(0);
    expect(created.n).toBe(0);
    for (const id of range(n)) expect(parent.querySelector(`[data-k="${id}"]`)).toBe(before.get(id));
  });

  it('duplicate keys map to DISTINCT nodes, one per occurrence', () => {
    // The regression the source comment claims was fixed: consuming the key
    // bucket with `bucket[0]` instead of `bucket.shift()` collapses every
    // occurrence of a duplicated key onto the same DOM node, so an n-row list
    // renders fewer than n rows.
    const { parent, items, nodes } = setup(range(n));
    const created = { n: 0 };
    const next = [...range(n), ...range(3)].map((id) => ({ id }));
    const result = reconcileList(
      parent, items, next, nodes, key, makeCreate(created), update, null,
    );
    expect(parent.children).toHaveLength(n + 3);
    expect(domKeys(parent)).toEqual(next.map(key));
    expect(new Set(result.nodes).size).toBe(n + 3);
    expect(created.n).toBe(3);
  });

  it('a key duplicated in the OLD list keeps BOTH of its nodes', () => {
    // The other half of the duplicate-key regression, and the half the final
    // DOM order cannot see: the reconciler indexes old rows by key, so a
    // registry that keeps one index per key (`map.set(k, [i])` instead of
    // pushing onto a bucket) silently drops one of the two existing nodes and
    // builds a replacement. The order still matches the model — only node
    // IDENTITY and the create count show it.
    const { parent, items, nodes } = setup([...range(n), 0]);
    const firstZero = nodes[0]!;
    const secondZero = nodes[n]!;
    const created = { n: 0 };
    const next = [0, 0, ...range(n).slice(1).reverse()].map((id) => ({ id }));

    const result = reconcileList(parent, items, next, nodes, key, makeCreate(created), update, null);

    expect(domKeys(parent)).toEqual(next.map(key));
    expect(parent.children).toHaveLength(next.length);
    // Both original nodes survive, and nothing was built to stand in for one.
    expect(created.n).toBe(0);
    expect(new Set(result.nodes).size).toBe(next.length);
    expect(result.nodes.slice(0, 2).sort()).toEqual([firstZero, secondZero].sort());
    expect(firstZero.parentNode).toBe(parent);
    expect(secondZero.parentNode).toBe(parent);
  });

  it('clearing the list removes every node and fires the exit hook for each', () => {
    const { parent, items, nodes } = setup(range(n));
    const seen: Node[] = [];
    const result = reconcileList(
      parent, items, [], nodes, key, makeCreate({ n: 0 }), update, null,
      { onBeforeRemove: (node, done) => { seen.push(node); done(); } },
    );
    expect(seen).toHaveLength(n);
    expect(parent.children).toHaveLength(0);
    expect(result.nodes).toEqual([]);
  });

  it('onInsert fires for every node created from an empty list', () => {
    const parent = document.createElement('div');
    const inserted: Node[] = [];
    reconcileList(
      parent, [], range(n).map((id) => ({ id })), [], key, makeCreate({ n: 0 }), update, null,
      { onInsert: (node) => inserted.push(node) },
    );
    expect(inserted).toHaveLength(n);
    expect(domKeys(parent)).toEqual(range(n));
  });
});

describe('keyed reconciliation across the small/large threshold', () => {
  it('produces the same DOM either side of SMALL_LIST_THRESHOLD', () => {
    // Both branches must be reachable and must agree. Pinning 31 and 32 means a
    // mutation of the threshold in either direction (to 1, or to a number no
    // list reaches) sends every fixture down one path and this diverges.
    const shuffle = (ids: number[]): number[] => ids.map((_, i) => ids[(i * 7 + 3) % ids.length]!);
    for (const n of [31, 32, 33]) {
      const { parent, items, nodes } = setup(range(n));
      const next = shuffle(range(n));
      reconcileList(parent, items, next.map((id) => ({ id })), nodes, key, makeCreate({ n: 0 }), update, null);
      expect(domKeys(parent), `n=${n}`).toEqual(next);
      expect(parent.children, `n=${n}`).toHaveLength(n);
    }
  });

  it('an interleaved add/remove/move at n=200 still lands on the model', () => {
    const n = 200;
    const { parent, items, nodes } = setup(range(n));
    const next = range(n)
      .filter((id) => id % 5 !== 0)
      .reverse()
      .concat([1000, 1001, 1002]);
    const created = { n: 0 };
    const result = reconcileList(
      parent, items, next.map((id) => ({ id })), nodes, key, makeCreate(created), update, null,
    );
    expect(domKeys(parent)).toEqual(next);
    expect(result.items.map(key)).toEqual(next);
    expect(created.n).toBe(3);
    expect(parent.children).toHaveLength(next.length);
  });
});
