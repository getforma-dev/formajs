// DOM 1.3.0: reconciler per-container cache (F1) + duplicate keys >= 32 (F2).
import { describe, it, expect } from 'vitest';
import { createReconciler, type ReconcilerConfig } from '../reconcile';
import { reconcileList } from '../list';

function makeReconciler() {
  const config: ReconcilerConfig = {
    mountScope: () => {},
    unmountScope: () => {},
    disconnectObserver: () => {},
    reconnectObserver: () => {},
    batch: (fn) => fn(),
  };
  return createReconciler(config);
}

describe('reconciler per-container HTML cache (F1)', () => {
  it('updates a second container reconciled to the same HTML as the first', () => {
    const reconcile = makeReconciler();
    const a = document.createElement('div');
    const b = document.createElement('div');
    document.body.append(a, b);
    // Pre-seed both so neither hits the empty-container fast path.
    a.innerHTML = '<div data-forma-id="seed-a">seed-a</div>';
    b.innerHTML = '<div data-forma-id="seed-b">seed-b</div>';

    const html = '<div data-forma-id="row-1">hello</div>';
    reconcile(a, html);
    reconcile(b, html);

    expect(a.querySelector('[data-forma-id="row-1"]')).not.toBeNull();
    expect(b.querySelector('[data-forma-id="row-1"]')).not.toBeNull();
    expect(a.textContent).toBe('hello');
    expect(b.textContent).toBe('hello');
    a.remove();
    b.remove();
  });

  it('still short-circuits an unchanged re-reconcile of the same container', () => {
    const reconcile = makeReconciler();
    const a = document.createElement('div');
    document.body.append(a);
    a.innerHTML = '<div data-forma-id="s">s</div>';
    const html = '<div data-forma-id="row">x</div>';
    reconcile(a, html);
    const firstNode = a.querySelector('[data-forma-id="row"]');
    reconcile(a, html); // identical → fast path, same node kept
    expect(a.querySelector('[data-forma-id="row"]')).toBe(firstNode);
    a.remove();
  });
});

describe('reconcileList duplicate keys across the 32-item threshold (F2)', () => {
  function makeItems(n: number, dupAt: number) {
    const items: Array<{ k: string; v: number }> = [];
    for (let i = 0; i < n; i++) {
      const k = i === dupAt ? 'k' + String(dupAt - 1) : 'k' + String(i);
      items.push({ k, v: i });
    }
    return items;
  }

  it('keeps every duplicate-keyed row for a list of >= 32 items', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const N = 40;
    const dupAt = 10; // items[10].k === items[9].k === 'k9'
    const items = makeItems(N, dupAt);

    const keyFn = (it: { k: string; v: number }) => it.k;
    const createFn = (it: { k: string; v: number }) => {
      const el = document.createElement('div');
      el.setAttribute('data-v', String(it.v));
      el.textContent = String(it.v);
      return el;
    };
    const updateFn = (node: Node, it: { k: string; v: number }) => {
      (node as HTMLElement).setAttribute('data-v', String(it.v));
      node.textContent = String(it.v);
    };

    const first = reconcileList(parent, [], items, [], keyFn, createFn, updateFn, null);
    expect(parent.children.length).toBe(N);
    expect(first.nodes.length).toBe(N);

    // Re-reconcile identical old->new; the >=32 Map path must preserve BOTH
    // duplicate occurrences instead of collapsing them to one node.
    const second = reconcileList(parent, items, items.slice(), first.nodes, keyFn, createFn, updateFn, null);
    expect(parent.children.length).toBe(N);
    expect(second.nodes.length).toBe(N);
    // The values 0..39 must all still be present (no dropped row).
    const values = Array.from(parent.children).map((c) => c.textContent);
    for (let i = 0; i < N; i++) expect(values).toContain(String(i));
    parent.remove();
  });
});
