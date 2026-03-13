/**
 * Forma DOM - Switch (Multi-branch Conditional)
 *
 * Maps a reactive value to one of N render branches.
 * Caches previously rendered nodes for instant swap-back.
 *
 * Each cached branch gets its own reactive root (ownership scope) so that:
 *  1. Inner effects survive when the switch effect re-runs (alien-signals
 *     would otherwise dispose child effects linked to the parent).
 *  2. Inner effects are explicitly disposed when the branch is evicted
 *     from the cache or the switch itself is torn down.
 *
 * SolidJS equivalent: <Switch><Match when={}>
 */

import { internalEffect, untrack, createRoot } from 'forma/reactive';

interface SwitchCase<T> {
  match: T;
  render: () => Node;
}

/** Cached branch: the rendered DOM node + a dispose function for its root. */
interface CachedBranch {
  node: Node;
  dispose: () => void;
}

/**
 * Multi-branch conditional rendering with node caching.
 *
 * ```ts
 * const [tab, setTab] = createSignal('home');
 * const fragment = createSwitch(tab, [
 *   { match: 'home', render: () => h('div', null, 'Home page') },
 *   { match: 'about', render: () => h('div', null, 'About page') },
 *   { match: 'contact', render: () => h('div', null, 'Contact page') },
 * ], () => h('div', null, '404'));
 * ```
 *
 * Previously rendered branches are cached — switching back to a tab
 * re-inserts the cached node without re-rendering.
 */
export function createSwitch<T>(
  value: () => T,
  cases: SwitchCase<T>[],
  fallback?: () => Node,
): DocumentFragment {
  const startMarker = document.createComment('forma-switch');
  const endMarker = document.createComment('/forma-switch');
  const fragment = document.createDocumentFragment();
  fragment.appendChild(startMarker);
  fragment.appendChild(endMarker);

  // Branch cache: value → { node, dispose }
  // Each branch has its own reactive root for explicit lifecycle management.
  const cache = new Map<T, CachedBranch>();
  let currentNode: Node | null = null;
  let currentMatch: T | typeof UNSET = UNSET;

  const switchDispose = internalEffect(() => {
    const val = value();
    if (val === currentMatch) return; // Same branch, skip

    const DEBUG = typeof (globalThis as any).__FORMA_DEBUG__ !== 'undefined';
    if (DEBUG) console.log('[forma:switch] transition', String(currentMatch), '→', String(val));

    currentMatch = val;

    const parent = startMarker.parentNode;
    if (!parent) {
      if (DEBUG) console.warn('[forma:switch] markers not in DOM yet, skipping');
      return;
    }

    // Remove current content between markers.
    // If currentNode was a DocumentFragment, its children transferred to the
    // DOM on insertion and the fragment is now detached (parentNode === null).
    // We must scoop the children BACK into the fragment so the cache stays
    // valid for re-insertion later.
    if (currentNode) {
      if (currentNode.parentNode === parent) {
        if (DEBUG) console.log('[forma:switch] removing single node');
        parent.removeChild(currentNode);
      } else if (currentNode.nodeType === 11 /* DOCUMENT_FRAGMENT_NODE */) {
        // Scoop DOM nodes back into the fragment for cache reuse
        if (DEBUG) console.log('[forma:switch] scooping nodes back into fragment');
        let scooped = 0;
        while (startMarker.nextSibling && startMarker.nextSibling !== endMarker) {
          currentNode.appendChild(startMarker.nextSibling);
          scooped++;
        }
        if (DEBUG) console.log('[forma:switch] scooped', scooped, 'nodes back into fragment');
      } else {
        // Other detached node — just clear between markers
        if (DEBUG) console.log('[forma:switch] clearing detached node between markers');
        while (startMarker.nextSibling && startMarker.nextSibling !== endMarker) {
          parent.removeChild(startMarker.nextSibling);
        }
      }
    }

    // Find matching case
    const matchedCase = cases.find(c => c.match === val);
    if (matchedCase) {
      let entry = cache.get(val);
      if (!entry) {
        // Render inside a createRoot so child effects are tracked for
        // disposal, and inside untrack so they are NOT linked to the
        // switch effect (alien-signals disposes child effects on parent
        // re-run, which would kill reactivity in cached branches).
        let branchDispose!: () => void;
        const node = createRoot((dispose) => {
          branchDispose = dispose;
          return untrack(() => matchedCase.render());
        });
        entry = { node, dispose: branchDispose };
        cache.set(val, entry);
        if (DEBUG) console.log('[forma:switch] rendered new branch for', String(val), '→', node.nodeName, 'type', node.nodeType);
      } else {
        if (DEBUG) console.log('[forma:switch] reusing cached branch for', String(val), '→', entry.node.nodeName, 'type', entry.node.nodeType, 'childNodes', entry.node.childNodes?.length);
      }
      currentNode = entry.node;
    } else {
      // Fallback — not cached, effects are owned by the switch effect
      // and correctly torn down on next re-run.
      currentNode = fallback?.() ?? null;
      if (DEBUG) console.log('[forma:switch] no match, using fallback');
    }

    if (currentNode) {
      parent.insertBefore(currentNode, endMarker);
      if (DEBUG) console.log('[forma:switch] inserted', currentNode.nodeName, 'before end marker');
    }
  });

  // Attach a cleanup marker so external disposal (via disposeComponent or
  // parent root teardown) can clean up all cached branches.
  (fragment as any).__switchDispose = () => {
    switchDispose();
    for (const entry of cache.values()) {
      entry.dispose();
    }
    cache.clear();
  };

  return fragment;
}

// Sentinel value for "no match yet"
const UNSET = Symbol('unset');
