/**
 * Forma Reactive - Untrack
 *
 * Read signals without subscribing to them in the reactive graph.
 * Essential for reading values inside effects without creating dependencies.
 *
 * TC39 Signals equivalent: Signal.subtle.untrack()
 */

import { getActiveSub, setActiveSub } from 'alien-signals';

/**
 * Execute a function without tracking signal reads.
 * Any signals read inside `fn` will NOT become dependencies of the
 * surrounding effect or computed.
 *
 * ```ts
 * createEffect(() => {
 *   const a = count();           // tracked — effect re-runs when count changes
 *   const b = untrack(() => other()); // NOT tracked — effect ignores other changes
 * });
 * ```
 */
export function untrack<T>(fn: () => T): T {
  const prev = setActiveSub(undefined);
  try {
    return fn();
  } finally {
    setActiveSub(prev);
  }
}
