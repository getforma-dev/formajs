/**
 * Forma Reactive - Computed
 *
 * Lazy, cached derived value that participates in the reactive graph.
 * Backed by alien-signals for automatic dependency tracking
 * and cache invalidation.
 *
 * TC39 Signals equivalent: Signal.Computed
 */

import { computed as rawComputed } from 'alien-signals';

/**
 * Create a lazy, cached computed value.
 *
 * Note: Unlike SolidJS's createComputed (which is an eager synchronous
 * side effect), this is a lazy cached derivation — equivalent to
 * SolidJS's createMemo. Both createComputed and createMemo in FormaJS
 * are identical.
 *
 * The getter receives the previous value as an argument, enabling
 * efficient diffing patterns without a separate signal:
 *
 * ```ts
 * const [count, setCount] = createSignal(0);
 * const doubled = createComputed(() => count() * 2);
 * console.log(doubled()); // 0
 * setCount(5);
 * console.log(doubled()); // 10
 * ```
 *
 * With previous value (for diffing):
 *
 * ```ts
 * const changes = createComputed((prev) => {
 *   const next = items();
 *   if (prev) console.log(`changed from ${prev.length} to ${next.length} items`);
 *   return next;
 * });
 * ```
 */
export function createComputed<T>(fn: (previousValue?: T) => T): () => T {
  return rawComputed(fn);
}
