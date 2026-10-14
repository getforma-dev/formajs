/**
 * Forma Reactive - Batch
 *
 * Groups multiple signal updates and defers effect execution until the
 * outermost batch completes. Prevents intermediate re-renders.
 * Backed by alien-signals.
 *
 * TC39 Signals: no built-in batch — this is a userland optimization.
 */

import { startBatch, endBatch } from 'alien-signals';
import { runWithoutRoot } from './root.js';

/**
 * Group multiple signal updates so that effects only run once after all
 * updates have been applied.
 *
 * ```ts
 * batch(() => {
 *   setA(1);
 *   setB(2);
 *   // effects that depend on A and B won't run yet
 * });
 * // effects run here, once
 * ```
 *
 * Batches are nestable — only the outermost batch triggers the flush.
 */
export function batch(fn: () => void): void {
  startBatch();
  try {
    fn();
  } finally {
    endBatch();
  }
}

/** @internal Open a batch that {@link closeBatchWithoutRoot} closes (adoption, hydrate.ts). */
export function openBatch(): void {
  startBatch();
}

/**
 * @internal Close a batch with no current root or owner: the effects it
 * flushes run as a re-run outside any root does, so what they create is owned
 * by no caller (adoption ends its walk's batch this way, hydrate.ts).
 *
 * Verified by: src/dom/__tests__/list-adoption-count.test.ts > "another island's row created while a failing island adopts keeps its reactive binding"
 */
export function closeBatchWithoutRoot(): void {
  runWithoutRoot(endBatch);
}
