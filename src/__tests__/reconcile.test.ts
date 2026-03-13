/**
 * Reconciler tests.
 *
 * These tests verify that rt.reconcile(container, html) correctly diffs and
 * patches the live DOM against a new HTML string, using data-forma-id keys
 * for element matching. The reconciler replaces morphdom as the single entry
 * point for DOM updates.
 *
 * `reconcile` is NOT exported from runtime.ts yet. ALL tests are expected to
 * FAIL until the reconciler is implemented (Task 4).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, setUnsafeEval, reconcile, setDirectiveMap } from '../runtime';

function waitForEffects(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('reconciler', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    setUnsafeEval(true);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    unmount(container);
    container.remove();
    setDirectiveMap(null);
  });

  // ── 1. Fast path: empty container ──────────────────────────────────

  describe('fast path (empty container)', () => {
    it('should populate an empty container and mount scopes', async () => {
      const html = `
        <div data-forma-id="card-1" data-module="movie-card"
             data-forma-state='{"title": "Batman"}'>
          <h2 data-text="{title}"></h2>
        </div>
      `;

      reconcile(container, html);
      await waitForEffects();

      // Container should have the child element
      const card = container.querySelector('[data-forma-id="card-1"]');
      expect(card).not.toBeNull();

      // Scope should be mounted (disposers exist)
      const stateEl = container.querySelector('[data-forma-state]');
      expect(stateEl).not.toBeNull();
      expect(Array.isArray((stateEl as any).__formaDisposers)).toBe(true);
      expect((stateEl as any).__formaDisposers.length).toBeGreaterThan(0);
    });

    it('should render multiple children into an empty container', async () => {
      const html = `
        <div data-forma-id="a" data-module="card"
             data-forma-state='{"x": 1}'>
          <span data-text="{x}"></span>
        </div>
        <div data-forma-id="b" data-module="card"
             data-forma-state='{"x": 2}'>
          <span data-text="{x}"></span>
        </div>
      `;

      reconcile(container, html);
      await waitForEffects();

      const children = container.querySelectorAll('[data-forma-id]');
      expect(children.length).toBe(2);
      expect(children[0].getAttribute('data-forma-id')).toBe('a');
      expect(children[1].getAttribute('data-forma-id')).toBe('b');
    });
  });

  // ── 2. PRESERVE mode (same module, same state shape) ───────────────

  describe('PRESERVE mode', () => {
    it('should preserve element identity when reconciling identical HTML', async () => {
      const html = `
        <div data-forma-id="card-1" data-module="movie-card"
             data-forma-state='{"title": "Batman"}'>
          <h2 data-text="{title}"></h2>
        </div>
      `;

      // Initial reconcile
      reconcile(container, html);
      await waitForEffects();

      const before = container.querySelector('[data-forma-id="card-1"]');
      expect(before).not.toBeNull();

      // Reconcile again with same HTML
      reconcile(container, html);
      await waitForEffects();

      const after = container.querySelector('[data-forma-id="card-1"]');
      expect(after).not.toBeNull();

      // Element reference should be identical (not recreated)
      expect(before === after).toBe(true);
    });

    it('should preserve reactive state across reconcile', async () => {
      const html = `
        <div data-forma-id="counter" data-module="counter"
             data-forma-state='{"count": 0}'>
          <span id="count-display" data-text="{count}"></span>
          <button id="inc-btn" data-on:click="count++">+1</button>
        </div>
      `;

      // Initial reconcile
      reconcile(container, html);
      await waitForEffects();

      // Mutate state: click the button to increment count
      const btn = container.querySelector('#inc-btn') as HTMLElement;
      expect(btn).not.toBeNull();
      btn.click();
      await waitForEffects();

      // Verify state was mutated
      const display = container.querySelector('#count-display');
      expect(display?.textContent).toBe('1');

      // Reconcile same HTML again (same state shape)
      reconcile(container, html);
      await waitForEffects();

      // State should survive — count should still be 1, not reset to 0
      const displayAfter = container.querySelector('#count-display');
      expect(displayAfter?.textContent).toBe('1');
    });

    it('should patch attribute changes while preserving scope', async () => {
      const htmlV1 = `
        <div data-forma-id="card-1" data-module="movie-card"
             data-forma-state='{"title": "Batman"}' class="card">
          <h2 data-text="{title}"></h2>
        </div>
      `;

      const htmlV2 = `
        <div data-forma-id="card-1" data-module="movie-card"
             data-forma-state='{"title": "Batman"}' class="card highlighted">
          <h2 data-text="{title}"></h2>
        </div>
      `;

      // Initial reconcile
      reconcile(container, htmlV1);
      await waitForEffects();

      const before = container.querySelector('[data-forma-id="card-1"]');
      expect(before).not.toBeNull();
      const disposersBefore = (before as any).__formaDisposers;

      // Reconcile with attribute change (class added)
      reconcile(container, htmlV2);
      await waitForEffects();

      const after = container.querySelector('[data-forma-id="card-1"]');
      expect(after).not.toBeNull();

      // Same element reference (not replaced)
      expect(before === after).toBe(true);

      // Attribute was patched
      expect(after!.classList.contains('highlighted')).toBe(true);

      // Scope preserved (same disposers array reference)
      expect((after as any).__formaDisposers === disposersBefore).toBe(true);
    });
  });

  // ── 3. RESET mode (same module, different state shape) ─────────────

  describe('RESET mode', () => {
    it('should dispose old scope and mount new one when state keys change', async () => {
      const htmlV1 = `
        <div data-forma-id="card-1" data-module="movie-card"
             data-forma-state='{"title": "Batman", "year": 2022}'>
          <h2 data-text="{title}"></h2>
          <span data-text="{year}"></span>
        </div>
      `;

      const htmlV2 = `
        <div data-forma-id="card-1" data-module="movie-card"
             data-forma-state='{"title": "Batman", "rating": 8.5}'>
          <h2 data-text="{title}"></h2>
          <span data-text="{rating}"></span>
        </div>
      `;

      // Initial reconcile
      reconcile(container, htmlV1);
      await waitForEffects();

      const el = container.querySelector('[data-forma-id="card-1"]');
      expect(el).not.toBeNull();
      const disposersBefore = (el as any).__formaDisposers;
      expect(Array.isArray(disposersBefore)).toBe(true);

      // Reconcile with different state keys (year -> rating)
      reconcile(container, htmlV2);
      await waitForEffects();

      const elAfter = container.querySelector('[data-forma-id="card-1"]');
      expect(elAfter).not.toBeNull();

      // New scope should have been mounted (different disposers array reference)
      const disposersAfter = (elAfter as any).__formaDisposers;
      expect(Array.isArray(disposersAfter)).toBe(true);
      expect(disposersAfter === disposersBefore).toBe(false);
    });
  });

  // ── 4. REPLACE mode (different module) ─────────────────────────────

  describe('REPLACE mode', () => {
    it('should fully replace element when data-module changes', async () => {
      const htmlV1 = `
        <div data-forma-id="slot-1" data-module="movie-card"
             data-forma-state='{"title": "Batman"}'>
          <h2 data-text="{title}"></h2>
        </div>
      `;

      const htmlV2 = `
        <div data-forma-id="slot-1" data-module="movie-poster"
             data-forma-state='{"imageUrl": "/batman.jpg"}'>
          <img data-bind:src="{imageUrl}" />
        </div>
      `;

      // Initial reconcile
      reconcile(container, htmlV1);
      await waitForEffects();

      const before = container.querySelector('[data-forma-id="slot-1"]');
      expect(before).not.toBeNull();
      expect(before!.getAttribute('data-module')).toBe('movie-card');

      // Reconcile with different module
      reconcile(container, htmlV2);
      await waitForEffects();

      const after = container.querySelector('[data-forma-id="slot-1"]');
      expect(after).not.toBeNull();
      expect(after!.getAttribute('data-module')).toBe('movie-poster');

      // Element should be a different reference (full replacement)
      expect(before === after).toBe(false);

      // Container should still have exactly one child (no ghost element)
      expect(container.children.length).toBe(1);

      // Old scope should have been cleaned up (no lingering disposers on old element)
      expect((before as any).__formaDisposers).toBeUndefined();

      // New scope should be mounted
      expect(Array.isArray((after as any).__formaDisposers)).toBe(true);
    });
  });

  // ── 5. Structural changes ─────────────────────────────────────────

  describe('structural changes', () => {
    it('should add a new child element', async () => {
      const htmlBefore = `
        <div data-forma-id="a" data-module="card"
             data-forma-state='{"x": 1}'>
          <span data-text="{x}"></span>
        </div>
      `;

      const htmlAfter = `
        <div data-forma-id="a" data-module="card"
             data-forma-state='{"x": 1}'>
          <span data-text="{x}"></span>
        </div>
        <div data-forma-id="b" data-module="card"
             data-forma-state='{"x": 2}'>
          <span data-text="{x}"></span>
        </div>
      `;

      reconcile(container, htmlBefore);
      await waitForEffects();

      expect(container.querySelectorAll('[data-forma-id]').length).toBe(1);

      // Add a second child
      reconcile(container, htmlAfter);
      await waitForEffects();

      const children = container.querySelectorAll('[data-forma-id]');
      expect(children.length).toBe(2);
      expect(children[1].getAttribute('data-forma-id')).toBe('b');

      // New child should be mounted
      const newChild = container.querySelector('[data-forma-id="b"]');
      expect(Array.isArray((newChild as any).__formaDisposers)).toBe(true);
    });

    it('should remove a child element and clean up its scope', async () => {
      const htmlBefore = `
        <div data-forma-id="a" data-module="card"
             data-forma-state='{"x": 1}'>
          <span data-text="{x}"></span>
        </div>
        <div data-forma-id="b" data-module="card"
             data-forma-state='{"x": 2}'>
          <span data-text="{x}"></span>
        </div>
      `;

      const htmlAfter = `
        <div data-forma-id="a" data-module="card"
             data-forma-state='{"x": 1}'>
          <span data-text="{x}"></span>
        </div>
      `;

      reconcile(container, htmlBefore);
      await waitForEffects();

      const removedEl = container.querySelector('[data-forma-id="b"]');
      expect(removedEl).not.toBeNull();
      expect(container.querySelectorAll('[data-forma-id]').length).toBe(2);

      // Remove second child
      reconcile(container, htmlAfter);
      await waitForEffects();

      expect(container.querySelectorAll('[data-forma-id]').length).toBe(1);

      // Removed element's scope should be cleaned up
      expect((removedEl as any).__formaDisposers).toBeUndefined();
    });

    it('should reorder keyed children without recreating them', async () => {
      const htmlOriginal = `
        <div data-forma-id="a" data-module="card"
             data-forma-state='{"label": "A"}'>
          <span data-text="{label}"></span>
        </div>
        <div data-forma-id="b" data-module="card"
             data-forma-state='{"label": "B"}'>
          <span data-text="{label}"></span>
        </div>
        <div data-forma-id="c" data-module="card"
             data-forma-state='{"label": "C"}'>
          <span data-text="{label}"></span>
        </div>
      `;

      const htmlReordered = `
        <div data-forma-id="c" data-module="card"
             data-forma-state='{"label": "C"}'>
          <span data-text="{label}"></span>
        </div>
        <div data-forma-id="a" data-module="card"
             data-forma-state='{"label": "A"}'>
          <span data-text="{label}"></span>
        </div>
        <div data-forma-id="b" data-module="card"
             data-forma-state='{"label": "B"}'>
          <span data-text="{label}"></span>
        </div>
      `;

      reconcile(container, htmlOriginal);
      await waitForEffects();

      // Capture references before reorder
      const refA = container.querySelector('[data-forma-id="a"]');
      const refB = container.querySelector('[data-forma-id="b"]');
      const refC = container.querySelector('[data-forma-id="c"]');

      // Reorder: C, A, B
      reconcile(container, htmlReordered);
      await waitForEffects();

      const children = container.querySelectorAll('[data-forma-id]');
      expect(children.length).toBe(3);

      // Verify new order
      expect(children[0].getAttribute('data-forma-id')).toBe('c');
      expect(children[1].getAttribute('data-forma-id')).toBe('a');
      expect(children[2].getAttribute('data-forma-id')).toBe('b');

      // Element references should be preserved (moved, not recreated)
      expect(children[0] === refC).toBe(true);
      expect(children[1] === refA).toBe(true);
      expect(children[2] === refB).toBe(true);
    });
  });

  // ── 6. Directive-owned subtrees ────────────────────────────────────

  describe('directive-owned subtrees', () => {
    it('should not diff children owned by data-list directive', async () => {
      const html = `
        <div data-forma-id="list-mod" data-module="movie-list"
             data-forma-state='{"movies": [{"id": 1, "title": "Batman"}, {"id": 2, "title": "Superman"}]}'>
          <ul data-list="{movies}">
            <li data-key="{item.id}">
              <span data-text="{item.title}"></span>
            </li>
          </ul>
        </div>
      `;

      // First reconcile — mount and let data-list render its children
      reconcile(container, html);
      await waitForEffects();

      const listEl = container.querySelector('[data-list]');
      expect(listEl).not.toBeNull();

      // data-list should have rendered 2 items
      const items = listEl!.querySelectorAll('li');
      expect(items.length).toBe(2);

      // Capture references to list-rendered children
      const firstItem = items[0];
      const secondItem = items[1];

      // Reconcile again with same HTML — list children should be untouched
      // (the reconciler should skip directive-owned subtrees)
      reconcile(container, html);
      await waitForEffects();

      const itemsAfter = listEl!.querySelectorAll('li');
      expect(itemsAfter.length).toBe(2);

      // List items should be the same references (not replaced by reconciler)
      expect(itemsAfter[0] === firstItem).toBe(true);
      expect(itemsAfter[1] === secondItem).toBe(true);
    });
  });

  // ── 7. MutationObserver disconnect/reconnect ──────────────────────

  describe('MutationObserver disconnect/reconnect', () => {
    it('should mount scopes exactly once during reconcile (no double-mount from observer)', async () => {
      const html = `
        <div data-forma-id="card-1" data-module="movie-card"
             data-forma-state='{"title": "Batman"}'>
          <h2 data-text="{title}"></h2>
        </div>
      `;

      reconcile(container, html);
      await waitForEffects();

      const stateEl = container.querySelector('[data-forma-state]');
      expect(stateEl).not.toBeNull();

      // Scope should be mounted exactly once
      // If MutationObserver double-fires, __formaDisposers would be set twice
      // or mountScope would be called redundantly
      const disposers = (stateEl as any).__formaDisposers;
      expect(Array.isArray(disposers)).toBe(true);

      // Mount a second element via reconcile to verify observer doesn't interfere
      const html2 = `
        <div data-forma-id="card-1" data-module="movie-card"
             data-forma-state='{"title": "Batman"}'>
          <h2 data-text="{title}"></h2>
        </div>
        <div data-forma-id="card-2" data-module="movie-card"
             data-forma-state='{"title": "Superman"}'>
          <h2 data-text="{title}"></h2>
        </div>
      `;

      reconcile(container, html2);
      await waitForEffects();

      const stateEls = container.querySelectorAll('[data-forma-state]');
      expect(stateEls.length).toBe(2);

      // Each should have exactly one set of disposers (no duplicates)
      for (const el of Array.from(stateEls)) {
        const d = (el as any).__formaDisposers;
        expect(Array.isArray(d)).toBe(true);
        expect(d.length).toBeGreaterThan(0);
      }
    });
  });

  // ── 8. Apply-like local upgrade (static -> connected without refresh) ─────

  describe('directive map refresh during local apply', () => {
    it('activates newly added directives immediately when directive map is refreshed', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ json: async () => ({ value: 'Joke A' }) })
        .mockResolvedValueOnce({ json: async () => ({ value: 'Joke B' }) });
      vi.stubGlobal('fetch', fetchMock);

      const staticHtml = `
        <article data-forma-id="root" data-module="joke-card"
                 data-forma-state='{"joke":"Static joke","category":"dev"}'>
          <p data-forma-id="txt" data-text="joke"></p>
          <button data-forma-id="btn" type="button">New Joke</button>
        </article>
      `;

      // Server map for initial static HTML (no fetch/computed/click directives yet)
      setDirectiveMap({
        root: ['data-forma-state'],
        txt: ['data-text'],
      });

      reconcile(container, staticHtml);
      await waitForEffects();

      const scope = container.querySelector('[data-forma-state]')!;
      unmount(scope);
      container.innerHTML = '';

      const connectedHtml = `
        <article data-forma-id="root" data-module="joke-card"
                 data-forma-state='{"joke":null,"category":"dev","__api":null}'
                 data-fetch="GET /api/data/proxy?url=x -> __api"
                 data-fetch-id="connect"
                 data-computed="joke = __api.value">
          <p data-forma-id="txt" data-text="joke"></p>
          <button data-forma-id="btn" type="button" data-on:click="$refetch('connect')">New Joke</button>
        </article>
      `;

      // This mirrors app.ts apply fix: refresh directive map before remount/reconcile.
      setDirectiveMap({
        root: ['data-forma-state', 'data-fetch', 'data-fetch-id', 'data-computed'],
        txt: ['data-text'],
        btn: ['data-on:click'],
      });

      reconcile(container, connectedHtml);
      await waitForEffects();
      await waitForEffects();

      const text = container.querySelector('[data-forma-id="txt"]');
      expect(text?.textContent).toBe('Joke A');

      const btn = container.querySelector('[data-forma-id="btn"]') as HTMLButtonElement;
      btn.click();
      await waitForEffects();
      await waitForEffects();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(text?.textContent).toBe('Joke B');

      vi.unstubAllGlobals();
    });
  });

  // ── 9. Text node patching ───────────────────────────────────────────

  describe('text node patching', () => {
    it('inserts new text nodes when new HTML has more than live', async () => {
      container.innerHTML = `
        <div data-forma-state='{"x":1}'>
          <p data-forma-id="p1">Hello</p>
        </div>
      `;
      mount(container);
      await waitForEffects();

      reconcile(container, `
        <div data-forma-state='{"x":1}'>
          <p data-forma-id="p1">Hello <strong data-forma-id="s1">world</strong> today</p>
        </div>
      `);
      await waitForEffects();

      const p = container.querySelector('[data-forma-id="p1"]')!;
      const textNodes = Array.from(p.childNodes).filter(n => n.nodeType === Node.TEXT_NODE);
      expect(textNodes.length).toBe(2);
      expect(textNodes[0].textContent).toBe('Hello ');
      expect(textNodes[1].textContent).toBe(' today');
    });

    it('removes extra text nodes when new HTML has fewer', async () => {
      container.innerHTML = `
        <div data-forma-state='{"x":1}'>
          <p data-forma-id="p1">Hello <strong data-forma-id="s1">world</strong> today</p>
        </div>
      `;
      mount(container);
      await waitForEffects();

      reconcile(container, `
        <div data-forma-state='{"x":1}'>
          <p data-forma-id="p1"><strong data-forma-id="s1">world</strong></p>
        </div>
      `);
      await waitForEffects();

      const p = container.querySelector('[data-forma-id="p1"]')!;
      const textNodes = Array.from(p.childNodes).filter(n => n.nodeType === Node.TEXT_NODE);
      expect(textNodes.length).toBe(0);
    });

    it('handles mixed content correctly (text + element + text)', async () => {
      container.innerHTML = `
        <div data-forma-state='{"x":1}'>
          <p data-forma-id="p1"><strong data-forma-id="s1">world</strong></p>
        </div>
      `;
      mount(container);
      await waitForEffects();

      reconcile(container, `
        <div data-forma-state='{"x":1}'>
          <p data-forma-id="p1">Greetings <strong data-forma-id="s1">world</strong> and friends</p>
        </div>
      `);
      await waitForEffects();

      const p = container.querySelector('[data-forma-id="p1"]')!;
      const children = Array.from(p.childNodes);
      expect(children.length).toBe(3);
      expect(children[0].textContent).toBe('Greetings ');
      expect((children[1] as Element).tagName).toBe('STRONG');
      expect(children[2].textContent).toBe(' and friends');
    });

    it('skips text nodes inside data-text elements', async () => {
      container.innerHTML = `
        <div data-forma-state='{"name":"Alice"}'>
          <span data-forma-id="s1" data-text="name">Alice</span>
        </div>
      `;
      mount(container);
      await waitForEffects();

      reconcile(container, `
        <div data-forma-state='{"name":"Alice"}'>
          <span data-forma-id="s1" data-text="name">Bob</span>
        </div>
      `);
      await waitForEffects();

      const span = container.querySelector('[data-forma-id="s1"]')!;
      expect(span.textContent).toBe('Alice');
    });
  });

  // ── 10. data-forma-leaving guards ─────────────────────────────────────

  describe('data-forma-leaving guards', () => {
    it('excludes leaving elements from liveKeyed map during diff', async () => {
      container.innerHTML = `
        <div data-forma-state='{"x":1}'>
          <div data-forma-id="a1">Old</div>
          <div data-forma-id="a2" data-forma-leaving="">Leaving</div>
        </div>
      `;
      mount(container);
      await waitForEffects();

      reconcile(container, `
        <div data-forma-state='{"x":1}'>
          <div data-forma-id="a1">Old</div>
          <div data-forma-id="a2">Fresh replacement</div>
        </div>
      `);
      await waitForEffects();

      const a2 = container.querySelector('[data-forma-id="a2"]:not([data-forma-leaving])');
      expect(a2).not.toBeNull();
      expect(a2!.textContent).toBe('Fresh replacement');
    });

    it('does not remove leaving elements in removal loop (transition handles them)', async () => {
      container.innerHTML = `
        <div data-forma-state='{"x":1}'>
          <div data-forma-id="a1">Keep</div>
          <div data-forma-id="a2" data-forma-leaving="">Animating out</div>
        </div>
      `;
      mount(container);
      await waitForEffects();

      const leavingEl = container.querySelector('[data-forma-leaving]')!;

      reconcile(container, `
        <div data-forma-state='{"x":1}'>
          <div data-forma-id="a1">Keep</div>
        </div>
      `);
      await waitForEffects();

      // Leaving element should still be in DOM (transition owns its removal)
      expect(leavingEl.parentElement).not.toBeNull();
    });
  });
});
