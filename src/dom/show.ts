/**
 * Forma DOM - Show (Conditional Rendering)
 *
 * Surgically swaps a single DOM node based on a boolean signal.
 * Uses comment markers (like createList) for zero-wrapper rendering.
 * When condition changes, only ONE node is removed and ONE inserted.
 *
 * Each branch is rendered inside createRoot + untrack so that:
 *  1. Inner effects survive when the show effect re-runs (alien-signals
 *     would otherwise dispose child effects linked to the parent).
 *  2. Inner effects are explicitly disposed when the branch changes.
 *
 * SolidJS equivalent: <Show when={} fallback={}>
 */

import { internalEffect, untrack, createRoot } from 'forma/reactive';
import { hydrating, type ShowDescriptor } from './hydrate.js';

/**
 * Conditionally render content based on a reactive boolean.
 *
 * ```ts
 * const [show, setShow] = createSignal(true);
 * const fragment = createShow(
 *   show,
 *   () => h('div', null, 'Visible!'),
 *   () => h('div', null, 'Hidden fallback'),
 * );
 * container.appendChild(fragment);
 * ```
 *
 * Returns a DocumentFragment with comment markers. The content between
 * markers is swapped reactively when `when()` changes.
 */
export function createShow(
  when: () => unknown,
  thenFn: () => Node,
  elseFn?: () => Node,
): DocumentFragment {
  if (hydrating) {
    const branch = when() ? thenFn() : (elseFn?.() ?? null);
    return {
      type: 'show',
      condition: when,
      whenTrue: thenFn,
      whenFalse: elseFn,
      initialBranch: branch,
    } as unknown as DocumentFragment;
  }

  const startMarker = document.createComment('forma-show');
  const endMarker = document.createComment('/forma-show');
  const fragment = document.createDocumentFragment();
  fragment.appendChild(startMarker);
  fragment.appendChild(endMarker);

  let currentNode: Node | null = null;
  let lastTruthy: boolean | null = null;
  let currentDispose: (() => void) | null = null;

  const showDispose = internalEffect(() => {
    const truthy = !!when();
    const DEBUG = typeof (globalThis as any).__FORMA_DEBUG__ !== 'undefined';
    const DEBUG_LABEL = DEBUG ? thenFn.toString().slice(0, 60) : '';

    if (truthy === lastTruthy) {
      if (DEBUG) console.log('[forma:show] skip (same)', truthy, DEBUG_LABEL);
      return;
    }
    if (DEBUG) console.log('[forma:show]', lastTruthy, '→', truthy, DEBUG_LABEL);
    lastTruthy = truthy;

    const parent = startMarker.parentNode;
    if (!parent) {
      if (DEBUG) console.warn('[forma:show] parentNode is null! skipping.', DEBUG_LABEL);
      return;
    }
    if (DEBUG) console.log('[forma:show] parent:', parent.nodeName, 'inDoc:', document.contains(parent as any));

    // Dispose previous branch's inner effects
    if (currentDispose) {
      currentDispose();
      currentDispose = null;
    }

    // Remove current node. If it was a DocumentFragment, its children
    // transferred to the DOM on insertion and the fragment is now detached.
    // In that case, clear everything between the markers.
    if (currentNode) {
      if (currentNode.parentNode === parent) {
        parent.removeChild(currentNode);
      } else {
        while (startMarker.nextSibling && startMarker.nextSibling !== endMarker) {
          parent.removeChild(startMarker.nextSibling);
        }
      }
    }

    // Render inside createRoot so child effects are tracked for disposal,
    // and inside untrack so they are NOT linked to the show effect
    // (alien-signals disposes child effects on parent re-run, which would
    // kill reactivity in branches whose condition stays the same).
    const branchFn = truthy ? thenFn : elseFn;
    if (branchFn) {
      let branchDispose!: () => void;
      currentNode = createRoot((dispose) => {
        branchDispose = dispose;
        return untrack(() => branchFn());
      });
      currentDispose = branchDispose;
    } else {
      currentNode = null;
    }

    if (currentNode) {
      parent.insertBefore(currentNode, endMarker);
    }
  });

  // Attach cleanup so external disposal can clean up the branch and effect.
  (fragment as any).__showDispose = () => {
    showDispose();
    if (currentDispose) {
      currentDispose();
      currentDispose = null;
    }
  };

  return fragment;
}
