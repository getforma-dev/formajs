/**
 * Tests for createList hydration path (descriptor + adoption).
 *
 * Covers:
 * - createList returns ListDescriptor when hydrating=true
 * - createList returns DocumentFragment when hydrating=false
 * - collectMarkers collects list markers (f:l / /f:l pairs)
 * - adoptNode handles ListDescriptor: adopts SSR items by key, subsequent setItems reconciles
 * - adoptNode handles empty SSR list: subsequent update populates
 * - adoptNode handles SSR/client key mismatch: extra removed, missing rendered fresh
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSignal, createRoot } from 'forma/reactive';
import { createList } from '../list';
import {
  hydrating,
  setHydrating,
  isListDescriptor,
  collectMarkers,
  adoptNode,
  type HydrationDescriptor,
  type ListDescriptor,
} from '../hydrate';
import { h } from '../element';

afterEach(() => {
  setHydrating(false);
});

// ---------------------------------------------------------------------------
// createList returns ListDescriptor when hydrating
// ---------------------------------------------------------------------------

describe('createList hydration branch', () => {
  it('returns ListDescriptor when hydrating=true', () => {
    setHydrating(true);

    const items = () => [{ id: 1, text: 'A' }];
    const keyFn = (item: { id: number }) => item.id;
    const renderFn = (item: { id: number; text: string }, index: () => number) =>
      h('li', null, item.text);

    const result = createList(items, keyFn, renderFn);

    // It's cast as DocumentFragment but is actually a ListDescriptor
    expect(isListDescriptor(result)).toBe(true);

    const desc = result as unknown as ListDescriptor;
    expect(desc.type).toBe('list');
    expect(typeof desc.items).toBe('function');
    expect(typeof desc.keyFn).toBe('function');
    expect(typeof desc.renderFn).toBe('function');
  });

  it('returns DocumentFragment when hydrating=false', () => {
    setHydrating(false);

    let result: DocumentFragment | undefined;
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;
      const items = () => [{ id: 1, text: 'A' }];
      const keyFn = (item: { id: number }) => item.id;
      const renderFn = (item: { id: number; text: string }, index: () => number) =>
        h('li', null, item.text);

      result = createList(items, keyFn, renderFn);
    });

    expect(result).toBeInstanceOf(DocumentFragment);
    expect(isListDescriptor(result)).toBe(false);

    dispose?.();
  });

  it('preserves options in ListDescriptor', () => {
    setHydrating(true);

    const items = () => [{ id: 1 }];
    const keyFn = (item: { id: number }) => item.id;
    const renderFn = (item: { id: number }, index: () => number) =>
      h('li', null, String(item.id));

    const result = createList(items, keyFn, renderFn, { updateOnItemChange: 'rerender' });
    const desc = result as unknown as ListDescriptor;

    expect(desc.options).toEqual({ updateOnItemChange: 'rerender' });
  });
});

// ---------------------------------------------------------------------------
// isListDescriptor type guard
// ---------------------------------------------------------------------------

describe('isListDescriptor', () => {
  it('returns true for a valid ListDescriptor', () => {
    const desc: ListDescriptor = {
      type: 'list',
      items: () => [],
      keyFn: (item: any) => item.id,
      renderFn: (item: any, index: () => number) => document.createElement('li'),
    };
    expect(isListDescriptor(desc)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isListDescriptor(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isListDescriptor(undefined)).toBe(false);
  });

  it('returns false for a string', () => {
    expect(isListDescriptor('hello')).toBe(false);
  });

  it('returns false for a HydrationDescriptor', () => {
    const desc: HydrationDescriptor = {
      type: 'element',
      tag: 'div',
      props: null,
      children: [],
    };
    expect(isListDescriptor(desc)).toBe(false);
  });

  it('returns false for a ShowDescriptor', () => {
    expect(isListDescriptor({ type: 'show', condition: () => true })).toBe(false);
  });

  it('returns false for a plain object with wrong type', () => {
    expect(isListDescriptor({ type: 'other' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// collectMarkers collects list markers
// ---------------------------------------------------------------------------

describe('collectMarkers list markers', () => {
  it('collects a single f:l/closing pair', () => {
    const root = document.createElement('div');
    root.innerHTML = '<!--f:l0--><li data-forma-key="a">A</li><!--/f:l0-->';

    const markers = collectMarkers(root);
    expect(markers.list.size).toBe(1);

    const entry = markers.list.get(0)!;
    expect(entry).toBeDefined();
    expect((entry.start as Comment).data).toBe('f:l0');
    expect((entry.end as Comment).data).toBe('/f:l0');
  });

  it('collects multiple list marker pairs', () => {
    const root = document.createElement('div');
    root.appendChild(document.createComment('f:l0'));
    root.appendChild(document.createElement('li'));
    root.appendChild(document.createComment('/f:l0'));
    root.appendChild(document.createComment('f:l1'));
    root.appendChild(document.createElement('li'));
    root.appendChild(document.createComment('/f:l1'));

    const markers = collectMarkers(root);
    expect(markers.list.size).toBe(2);
    expect(markers.list.get(0)!.start.data).toBe('f:l0');
    expect(markers.list.get(0)!.end.data).toBe('/f:l0');
    expect(markers.list.get(1)!.start.data).toBe('f:l1');
    expect(markers.list.get(1)!.end.data).toBe('/f:l1');
  });

  it('ignores orphan list start markers (no closing)', () => {
    const root = document.createElement('div');
    root.innerHTML = '<!--f:l0--><li>orphan</li>';

    const markers = collectMarkers(root);
    expect(markers.list.size).toBe(0);
  });

  it('coexists with text and show markers', () => {
    const root = document.createElement('div');
    root.appendChild(document.createComment('f:t0'));
    root.appendChild(document.createTextNode('Hello'));
    root.appendChild(document.createComment('f:s0'));
    root.appendChild(document.createElement('span'));
    root.appendChild(document.createComment('/f:s0'));
    root.appendChild(document.createComment('f:l0'));
    root.appendChild(document.createElement('li'));
    root.appendChild(document.createComment('/f:l0'));

    const markers = collectMarkers(root);
    expect(markers.text.size).toBe(1);
    expect(markers.show.size).toBe(1);
    expect(markers.list.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// adoptNode handles ListDescriptor
// ---------------------------------------------------------------------------

describe('adoptNode list descriptor handling', () => {
  it('adopts SSR items by data-forma-key and attaches reconciler', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      // SSR DOM: <ul><!--f:l0--><li data-forma-key="a">A</li><li data-forma-key="b">B</li><!--/f:l0--></ul>
      const ssrEl = document.createElement('ul');
      const startComment = document.createComment('f:l0');
      const liA = document.createElement('li');
      liA.setAttribute('data-forma-key', 'a');
      liA.textContent = 'A';
      const liB = document.createElement('li');
      liB.setAttribute('data-forma-key', 'b');
      liB.textContent = 'B';
      const endComment = document.createComment('/f:l0');
      ssrEl.appendChild(startComment);
      ssrEl.appendChild(liA);
      ssrEl.appendChild(liB);
      ssrEl.appendChild(endComment);

      const [items, setItems] = createSignal([
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
      ]);

      const listDesc: ListDescriptor = {
        type: 'list',
        items: items as () => unknown[],
        keyFn: (item: any) => item.id,
        renderFn: (item: any, index: () => number) => {
          const li = document.createElement('li');
          li.setAttribute('data-forma-key', item.id);
          li.textContent = item.text;
          return li;
        },
      };

      const desc: HydrationDescriptor = {
        type: 'element',
        tag: 'ul',
        props: null,
        children: [listDesc],
      };

      adoptNode(desc, ssrEl);

      // SSR nodes should be reused (same references)
      const children = Array.from(ssrEl.children);
      expect(children).toContain(liA);
      expect(children).toContain(liB);

      // Now update items — reconciler should add new item
      setItems([
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
        { id: 'c', text: 'C' },
      ]);

      // After reconciliation, there should be 3 <li> elements
      const lis = ssrEl.querySelectorAll('li');
      expect(lis.length).toBe(3);
      expect(lis[2]!.textContent).toBe('C');
    });

    dispose?.();
  });

  it('handles empty SSR list and subsequent update populates it', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      // SSR DOM: <ul><!--f:l0--><!--/f:l0--></ul>
      const ssrEl = document.createElement('ul');
      const startComment = document.createComment('f:l0');
      const endComment = document.createComment('/f:l0');
      ssrEl.appendChild(startComment);
      ssrEl.appendChild(endComment);

      const [items, setItems] = createSignal<{ id: string; text: string }[]>([]);

      const listDesc: ListDescriptor = {
        type: 'list',
        items: items as () => unknown[],
        keyFn: (item: any) => item.id,
        renderFn: (item: any, index: () => number) => {
          const li = document.createElement('li');
          li.setAttribute('data-forma-key', item.id);
          li.textContent = item.text;
          return li;
        },
      };

      const desc: HydrationDescriptor = {
        type: 'element',
        tag: 'ul',
        props: null,
        children: [listDesc],
      };

      adoptNode(desc, ssrEl);

      // Initially empty
      expect(ssrEl.querySelectorAll('li').length).toBe(0);

      // Add items
      setItems([
        { id: 'x', text: 'X' },
        { id: 'y', text: 'Y' },
      ]);

      const lis = ssrEl.querySelectorAll('li');
      expect(lis.length).toBe(2);
      expect(lis[0]!.textContent).toBe('X');
      expect(lis[1]!.textContent).toBe('Y');
    });

    dispose?.();
  });

  it('handles SSR/client key mismatch: extra SSR nodes removed, missing rendered fresh', () => {
    let dispose: (() => void) | undefined;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    createRoot((d) => {
      dispose = d;

      // SSR DOM has items a, b, c
      const ssrEl = document.createElement('ul');
      const startComment = document.createComment('f:l0');
      const liA = document.createElement('li');
      liA.setAttribute('data-forma-key', 'a');
      liA.textContent = 'A';
      const liB = document.createElement('li');
      liB.setAttribute('data-forma-key', 'b');
      liB.textContent = 'B';
      const liC = document.createElement('li');
      liC.setAttribute('data-forma-key', 'c');
      liC.textContent = 'C';
      const endComment = document.createComment('/f:l0');
      ssrEl.appendChild(startComment);
      ssrEl.appendChild(liA);
      ssrEl.appendChild(liB);
      ssrEl.appendChild(liC);
      ssrEl.appendChild(endComment);

      // Client has items a, d (b and c removed, d is new)
      const [items, setItems] = createSignal([
        { id: 'a', text: 'A' },
        { id: 'd', text: 'D' },
      ]);

      const listDesc: ListDescriptor = {
        type: 'list',
        items: items as () => unknown[],
        keyFn: (item: any) => item.id,
        renderFn: (item: any, index: () => number) => {
          const li = document.createElement('li');
          li.setAttribute('data-forma-key', item.id);
          li.textContent = item.text;
          return li;
        },
      };

      const desc: HydrationDescriptor = {
        type: 'element',
        tag: 'ul',
        props: null,
        children: [listDesc],
      };

      adoptNode(desc, ssrEl);

      // liA should still be there (reused)
      const lis = ssrEl.querySelectorAll('li');
      expect(lis.length).toBe(2);
      expect(lis[0]).toBe(liA); // reused
      expect(lis[1]!.textContent).toBe('D'); // fresh rendered

      // b and c should have been removed
      expect(ssrEl.contains(liB)).toBe(false);
      expect(ssrEl.contains(liC)).toBe(false);
    });

    warnSpy.mockRestore();
    dispose?.();
  });

  it('reorders adopted nodes to match client item order', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      // SSR DOM has items a, b, c
      const ssrEl = document.createElement('ul');
      const startComment = document.createComment('f:l0');
      const liA = document.createElement('li');
      liA.setAttribute('data-forma-key', 'a');
      liA.textContent = 'A';
      const liB = document.createElement('li');
      liB.setAttribute('data-forma-key', 'b');
      liB.textContent = 'B';
      const liC = document.createElement('li');
      liC.setAttribute('data-forma-key', 'c');
      liC.textContent = 'C';
      const endComment = document.createComment('/f:l0');
      ssrEl.appendChild(startComment);
      ssrEl.appendChild(liA);
      ssrEl.appendChild(liB);
      ssrEl.appendChild(liC);
      ssrEl.appendChild(endComment);

      // Client has items in reversed order: c, b, a
      const [items, setItems] = createSignal([
        { id: 'c', text: 'C' },
        { id: 'b', text: 'B' },
        { id: 'a', text: 'A' },
      ]);

      const listDesc: ListDescriptor = {
        type: 'list',
        items: items as () => unknown[],
        keyFn: (item: any) => item.id,
        renderFn: (item: any, index: () => number) => {
          const li = document.createElement('li');
          li.setAttribute('data-forma-key', item.id);
          li.textContent = item.text;
          return li;
        },
      };

      const desc: HydrationDescriptor = {
        type: 'element',
        tag: 'ul',
        props: null,
        children: [listDesc],
      };

      adoptNode(desc, ssrEl);

      // All SSR nodes reused but reordered
      const lis = ssrEl.querySelectorAll('li');
      expect(lis.length).toBe(3);
      expect(lis[0]).toBe(liC);
      expect(lis[1]).toBe(liB);
      expect(lis[2]).toBe(liA);
    });

    dispose?.();
  });

  it('adopts SSR items with numeric keys (keyFn returns number, getAttribute returns string)', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      // SSR DOM uses string keys from data-forma-key attribute
      const ssrEl = document.createElement('ul');
      const startComment = document.createComment('f:l0');
      const li1 = document.createElement('li');
      li1.setAttribute('data-forma-key', '1');
      li1.textContent = 'One';
      const li2 = document.createElement('li');
      li2.setAttribute('data-forma-key', '2');
      li2.textContent = 'Two';
      const li3 = document.createElement('li');
      li3.setAttribute('data-forma-key', '3');
      li3.textContent = 'Three';
      const endComment = document.createComment('/f:l0');
      ssrEl.appendChild(startComment);
      ssrEl.appendChild(li1);
      ssrEl.appendChild(li2);
      ssrEl.appendChild(li3);
      ssrEl.appendChild(endComment);

      // Client items use numeric IDs — keyFn returns number
      const [items, setItems] = createSignal([
        { id: 1, text: 'One' },
        { id: 2, text: 'Two' },
        { id: 3, text: 'Three' },
      ]);

      const listDesc: ListDescriptor = {
        type: 'list',
        items: items as () => unknown[],
        keyFn: (item: any) => item.id, // returns number, not string
        renderFn: (item: any, index: () => number) => {
          const li = document.createElement('li');
          li.setAttribute('data-forma-key', String(item.id));
          li.textContent = item.text;
          return li;
        },
      };

      const desc: HydrationDescriptor = {
        type: 'element',
        tag: 'ul',
        props: null,
        children: [listDesc],
      };

      adoptNode(desc, ssrEl);

      // All SSR nodes should be reused despite numeric vs string key mismatch
      const lis = ssrEl.querySelectorAll('li');
      expect(lis.length).toBe(3);
      expect(lis[0]).toBe(li1); // reused, not re-rendered
      expect(lis[1]).toBe(li2);
      expect(lis[2]).toBe(li3);

      // Subsequent update with numeric keys should also work
      setItems([
        { id: 3, text: 'Three' },
        { id: 1, text: 'One' },
      ]);

      const lis2 = ssrEl.querySelectorAll('li');
      expect(lis2.length).toBe(2);
      expect(lis2[0]).toBe(li3); // reused and reordered
      expect(lis2[1]).toBe(li1); // reused and reordered
      // li2 removed
      expect(ssrEl.contains(li2)).toBe(false);
    });

    dispose?.();
  });

  it('subsequent reconciliation after adoption works correctly', () => {
    let dispose: (() => void) | undefined;

    createRoot((d) => {
      dispose = d;

      // SSR DOM: <ul><!--f:l0--><li data-forma-key="1">One</li><!--/f:l0--></ul>
      const ssrEl = document.createElement('ul');
      const startComment = document.createComment('f:l0');
      const li1 = document.createElement('li');
      li1.setAttribute('data-forma-key', '1');
      li1.textContent = 'One';
      const endComment = document.createComment('/f:l0');
      ssrEl.appendChild(startComment);
      ssrEl.appendChild(li1);
      ssrEl.appendChild(endComment);

      const [items, setItems] = createSignal([{ id: '1', text: 'One' }]);

      const listDesc: ListDescriptor = {
        type: 'list',
        items: items as () => unknown[],
        keyFn: (item: any) => item.id,
        renderFn: (item: any, index: () => number) => {
          const li = document.createElement('li');
          li.setAttribute('data-forma-key', item.id);
          li.textContent = item.text;
          return li;
        },
      };

      const desc: HydrationDescriptor = {
        type: 'element',
        tag: 'ul',
        props: null,
        children: [listDesc],
      };

      adoptNode(desc, ssrEl);

      // Initial state: 1 item, SSR node reused
      expect(ssrEl.querySelectorAll('li').length).toBe(1);
      expect(ssrEl.querySelector('li')).toBe(li1);

      // Update: replace item
      setItems([{ id: '2', text: 'Two' }]);

      const lis = ssrEl.querySelectorAll('li');
      expect(lis.length).toBe(1);
      expect(lis[0]!.textContent).toBe('Two');
      expect(lis[0]).not.toBe(li1); // new node, old removed

      // Update: add more items
      setItems([
        { id: '2', text: 'Two' },
        { id: '3', text: 'Three' },
      ]);

      const lis2 = ssrEl.querySelectorAll('li');
      expect(lis2.length).toBe(2);
      expect(lis2[0]!.textContent).toBe('Two');
      expect(lis2[1]!.textContent).toBe('Three');

      // Update: clear all
      setItems([]);
      expect(ssrEl.querySelectorAll('li').length).toBe(0);
    });

    dispose?.();
  });
});
