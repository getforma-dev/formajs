/**
 * Forma DOM - Error Boundary
 *
 * Catches errors during rendering and shows a fallback UI.
 * Provides a retry function to re-attempt the original render.
 *
 * SolidJS equivalent: <ErrorBoundary fallback={}>
 */

import { createSignal, internalEffect } from 'forma/reactive';

/**
 * Wrap a render function with error recovery.
 *
 * ```ts
 * const fragment = createErrorBoundary(
 *   () => h('div', null, riskyComponent()),
 *   (error, retry) => h('div', { class: 'error' },
 *     h('p', null, `Error: ${error.message}`),
 *     h('button', { onClick: retry }, 'Retry'),
 *   ),
 * );
 * ```
 *
 * If `tryFn` throws, `catchFn` is called with the error and a retry function.
 * Calling `retry()` re-runs `tryFn`.
 */
export function createErrorBoundary(
  tryFn: () => Node,
  catchFn: (error: Error, retry: () => void) => Node,
): DocumentFragment {
  const startMarker = document.createComment('forma-error-boundary');
  const endMarker = document.createComment('/forma-error-boundary');
  const fragment = document.createDocumentFragment();
  fragment.appendChild(startMarker);
  fragment.appendChild(endMarker);

  const [retryCount, setRetryCount] = createSignal(0);
  let currentNode: Node | null = null;

  internalEffect(() => {
    // Subscribe to retryCount so retry() triggers re-run
    retryCount();

    const parent = startMarker.parentNode;
    if (!parent) return;

    // Remove current
    if (currentNode && currentNode.parentNode === parent) {
      parent.removeChild(currentNode);
    }

    try {
      currentNode = tryFn();
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      const retry = () => setRetryCount(c => c + 1);
      currentNode = catchFn(error, retry);
    }

    if (currentNode) {
      parent.insertBefore(currentNode, endMarker);
    }
  });

  return fragment;
}
