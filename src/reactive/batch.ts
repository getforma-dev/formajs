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
