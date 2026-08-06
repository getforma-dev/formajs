/**
 * show / switch / portal driven to DEPTH, with DISTINGUISHABLE branches.
 *
 * Three defects hid behind one-transition fixtures and branches that rendered
 * the same text:
 *
 *   - `show`: a DocumentFragment branch detaches on insertion, so removing it
 *     means sweeping the nodes between the markers. Delete the sweep and the
 *     old branch's content stays on the page under the new one. No test in the
 *     suite ever used a fragment branch.
 *   - `switch`: a cached fragment branch has to have its children SCOOPED BACK
 *     into the fragment on the way out, or the cache holds an empty fragment
 *     and the THIRD visit to that branch renders nothing. The cache test
 *     watched a render counter and never re-read the DOM, so it passed.
 *   - `portal`: re-rendering appends without removing the previous node, so the
 *     target accumulates. No portal test ever re-rendered.
 *
 * Every case here runs at least three transitions and asserts the invariant
 * after EVERY one, not just the last.
 */
import { describe, it, expect, vi } from 'vitest';
import { createSignal, createRoot } from 'forma/reactive';
import { h } from '../element';
import { createShow } from '../show';
import { createSwitch } from '../switch';
import { createPortal } from '../portal';

/** A branch made of a DocumentFragment — several top-level nodes, no wrapper. */
function fragmentBranch(label: string, count = 3): () => Node {
  return () => {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const el = document.createElement('p');
      el.dataset.branch = label;
      el.textContent = `${label}${i}`;
      frag.appendChild(el);
    }
    return frag;
  };
}

/** The branch label of every element currently in `parent`, in order. */
function labels(parent: ParentNode): string[] {
  return [...parent.querySelectorAll('[data-branch]')].map(
    (el) => (el as HTMLElement).dataset.branch!,
  );
}

function mountIn(node: Node): HTMLElement {
  const container = document.createElement('div');
  container.appendChild(node);
  document.body.appendChild(container);
  return container;
}

describe('createShow with DocumentFragment branches', () => {
  it('replaces the whole fragment on every toggle, four times over', () => {
    createRoot((dispose) => {
      const [on, setOn] = createSignal(true);
      const container = mountIn(
        createShow(on, fragmentBranch('then'), fragmentBranch('else')),
      );

      // Branches are DISTINGUISHABLE: a fixture whose branches both render
      // "Truthy" cannot tell a correct run from a poisoned one.
      expect(labels(container)).toEqual(['then', 'then', 'then']);

      for (let i = 0; i < 4; i++) {
        const expected = i % 2 === 0 ? 'else' : 'then';
        setOn(i % 2 !== 0);
        expect(labels(container), `toggle ${i}`).toEqual([expected, expected, expected]);
        expect(container.textContent, `toggle ${i}`).toBe(`${expected}0${expected}1${expected}2`);
      }

      dispose();
      container.remove();
    });
  });

  it('does not re-render the branch when the condition stays truthy', () => {
    createRoot((dispose) => {
      const [n, setN] = createSignal(1);
      let renders = 0;
      const container = mountIn(
        createShow(
          () => n() > 0,
          () => { renders += 1; const el = h('p', { 'data-branch': 'then' }, 'x'); return el; },
          () => h('p', { 'data-branch': 'else' }, 'y'),
        ),
      );
      const first = container.querySelector('p');

      setN(2);
      setN(3);
      setN(4);

      // Same node, not merely the same render count: identity is what a
      // consumer's event listeners and focus depend on.
      expect(container.querySelector('p')).toBe(first);
      expect(renders).toBe(1);
      expect(labels(container)).toEqual(['then']);

      setN(-1);
      expect(labels(container)).toEqual(['else']);
      setN(1);
      expect(labels(container)).toEqual(['then']);
      expect(renders).toBe(2);

      dispose();
      container.remove();
    });
  });

  it('renders nothing for a missing else branch, then recovers', () => {
    createRoot((dispose) => {
      const [on, setOn] = createSignal(false);
      const container = mountIn(createShow(on, fragmentBranch('then')));
      expect(labels(container)).toEqual([]);
      setOn(true);
      expect(labels(container)).toEqual(['then', 'then', 'then']);
      setOn(false);
      expect(labels(container)).toEqual([]);
      setOn(true);
      expect(labels(container)).toEqual(['then', 'then', 'then']);
      dispose();
      container.remove();
    });
  });
});

describe('createSwitch cache with DocumentFragment branches', () => {
  it('a cached fragment branch renders again on its THIRD visit', () => {
    createRoot((dispose) => {
      const [tab, setTab] = createSignal('a');
      const renders: Record<string, number> = { a: 0, b: 0, c: 0 };
      const branch = (label: string) => (): Node => {
        renders[label] += 1;
        return fragmentBranch(label)();
      };
      const container = mountIn(
        createSwitch(tab, [
          { match: 'a', render: branch('a') },
          { match: 'b', render: branch('b') },
          { match: 'c', render: branch('c') },
        ]),
      );

      const visit = (t: string): void => {
        setTab(t);
        // The DOM, not a counter: the counter cannot see an empty cached branch.
        expect(labels(container), `visit ${t}`).toEqual([t, t, t]);
        expect(container.textContent, `visit ${t}`).toBe(`${t}0${t}1${t}2`);
      };

      expect(labels(container)).toEqual(['a', 'a', 'a']);
      visit('b');
      visit('a'); // second visit — served from cache
      visit('c');
      visit('a'); // THIRD visit — the one that used to render nothing
      visit('b');
      visit('b');

      // …and the cache really was a cache: each branch rendered once.
      expect(renders).toEqual({ a: 1, b: 1, c: 1 });

      dispose();
      container.remove();
    });
  });

  it('an unmatched value clears the region and a later match restores it', () => {
    createRoot((dispose) => {
      const [tab, setTab] = createSignal('a');
      const container = mountIn(
        createSwitch(tab, [
          { match: 'a', render: fragmentBranch('a') },
          { match: 'b', render: () => h('p', { 'data-branch': 'b' }, 'B') },
        ]),
      );
      expect(labels(container)).toEqual(['a', 'a', 'a']);
      setTab('nope');
      expect(labels(container)).toEqual([]);
      setTab('b');
      expect(labels(container)).toEqual(['b']);
      setTab('a');
      expect(labels(container)).toEqual(['a', 'a', 'a']);
      dispose();
      container.remove();
    });
  });
});

describe('createPortal re-render', () => {
  it('replaces its node in the target instead of accumulating', () => {
    createRoot((dispose) => {
      const target = document.createElement('div');
      target.id = 'portal-target';
      document.body.appendChild(target);
      const [n, setN] = createSignal(1);

      createPortal(() => h('p', { 'data-branch': 'portal' }, () => `n=${n()}`), target);

      expect(target.children).toHaveLength(1);
      expect(target.textContent).toBe('n=1');

      // The content is reactive INSIDE the node, so re-running the portal body
      // is driven by a separate signal below; first prove the stable case.
      setN(2);
      expect(target.children).toHaveLength(1);
      expect(target.textContent).toBe('n=2');

      dispose();
      target.remove();
    });
  });

  it('removes the previous node on every re-render, three times over', () => {
    createRoot((dispose) => {
      const target = document.createElement('div');
      document.body.appendChild(target);
      const [which, setWhich] = createSignal('a');

      // The children function READS the signal, so the effect re-runs and a new
      // node is produced each time — the shape that used to accumulate.
      createPortal(() => h('p', { 'data-branch': which() }, which()), target);

      expect(labels(target)).toEqual(['a']);
      for (const next of ['b', 'c', 'a', 'd']) {
        setWhich(next);
        expect(target.children, `after ${next}`).toHaveLength(1);
        expect(labels(target), `after ${next}`).toEqual([next]);
        expect(target.textContent).toBe(next);
      }

      dispose();
      expect(target.children).toHaveLength(0); // and disposal detaches it
      target.remove();
    });
  });

  it('resolves a string target through querySelector', () => {
    const target = document.createElement('div');
    target.id = 'portal-by-selector';
    document.body.appendChild(target);
    createRoot((dispose) => {
      createPortal(() => h('p', { 'data-branch': 'sel' }, 'x'), '#portal-by-selector');
      expect(labels(target)).toEqual(['sel']);
      dispose();
    });
    expect(target.children).toHaveLength(0);
    target.remove();
  });

  it('throws a named error when the target selector matches nothing', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    createRoot((dispose) => {
      expect(() => createPortal(() => h('p', null, 'x'), '#nope')).toThrow(/target not found/);
      // …and nothing was appended anywhere as a side effect of failing.
      expect(document.querySelectorAll('[data-branch]')).toHaveLength(0);
      dispose();
    });
    spy.mockRestore();
  });
});
