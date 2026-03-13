/**
 * Forma DOM - Suspense
 *
 * A Suspense boundary that shows fallback content while async resources
 * inside the children function are loading. Uses comment markers
 * (like createShow, createList) for zero-wrapper rendering.
 *
 * When all resources resolve, the fallback is swapped for the real content.
 * If a resource errors, the fallback remains (pair with createErrorBoundary
 * for error handling).
 *
 * SolidJS equivalent: <Suspense fallback={}>
 */

import { createSignal, internalEffect } from 'forma/reactive';
import {
  type SuspenseContext,
  pushSuspenseContext,
  popSuspenseContext,
} from 'forma/reactive/suspense-context';

// Re-export context utilities so consumers can import from dom/suspense
export { getSuspenseContext, pushSuspenseContext, popSuspenseContext } from 'forma/reactive/suspense-context';
export type { SuspenseContext } from 'forma/reactive/suspense-context';

// ---------------------------------------------------------------------------
// createSuspense
// ---------------------------------------------------------------------------

/**
 * Create a Suspense boundary that shows fallback content while async resources
 * inside the children function are loading.
 *
 * Uses comment markers: `<!--forma-suspense-->` / `<!--/forma-suspense-->`
 *
 * When all resources resolve, the fallback is swapped for the real content.
 * If a resource errors, the fallback remains (pair with createErrorBoundary
 * for errors).
 *
 * ```ts
 * const frag = createSuspense(
 *   () => h('div', null, 'Loading...'),
 *   () => {
 *     const data = createResource(source, fetcher);
 *     return h('div', null, () => data()?.name ?? '');
 *   },
 * );
 * container.appendChild(frag);
 * ```
 */
export function createSuspense(
  fallback: () => Node,
  children: () => Node,
): DocumentFragment {
  const startMarker = document.createComment('forma-suspense');
  const endMarker = document.createComment('/forma-suspense');
  const fragment = document.createDocumentFragment();
  fragment.appendChild(startMarker);
  fragment.appendChild(endMarker);

  const [pending, setPending] = createSignal(0);
  let currentNode: Node | null = null;
  let resolvedNode: Node | null = null;
  let fallbackNode: Node | null = null;

  const ctx: SuspenseContext = {
    increment() { setPending(p => p + 1); },
    decrement() { setPending(p => Math.max(0, p - 1)); },
  };

  // Render children within the Suspense context so that any createResource
  // calls inside will register with this boundary.
  pushSuspenseContext(ctx);
  try {
    resolvedNode = children();
  } finally {
    popSuspenseContext();
  }

  // Reactively swap between fallback and children based on pending count
  internalEffect(() => {
    const parent = startMarker.parentNode;
    if (!parent) return;

    const isPending = pending() > 0;
    const newNode = isPending ? (fallbackNode ??= fallback()) : resolvedNode;

    if (newNode === currentNode) return;

    // Remove current node
    if (currentNode && currentNode.parentNode === parent) {
      parent.removeChild(currentNode);
    }

    // Insert new node
    if (newNode) {
      parent.insertBefore(newNode, endMarker);
    }

    currentNode = newNode;
  });

  return fragment;
}
