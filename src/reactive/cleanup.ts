/**
 * Forma Reactive - Cleanup
 *
 * Register cleanup functions within reactive scopes.
 * Inspired by SolidJS onCleanup().
 */

// ---------------------------------------------------------------------------
// Cleanup context tracking
// ---------------------------------------------------------------------------

type CleanupCollector = ((fn: () => void) => void) | null;

let currentCleanupCollector: CleanupCollector = null;

/**
 * Register a cleanup function in the current reactive scope.
 * The cleanup runs before the effect re-executes and on disposal.
 *
 * More composable than returning a cleanup from the effect function,
 * since it can be called from helper functions.
 *
 * ```ts
 * createEffect(() => {
 *   const timer = setInterval(tick, 1000);
 *   onCleanup(() => clearInterval(timer));
 * });
 * ```
 */
export function onCleanup(fn: () => void): void {
  currentCleanupCollector?.(fn);
}

/**
 * @internal — Set the cleanup collector for the current effect execution.
 */
export function setCleanupCollector(collector: CleanupCollector): CleanupCollector {
  const prev = currentCleanupCollector;
  currentCleanupCollector = collector;
  return prev;
}
