/**
 * Forma Reactive - On
 *
 * Explicit dependency tracking for effects.
 * Only re-runs when the specified signals change, ignoring all other reads.
 *
 * SolidJS equivalent: on()
 * Vue equivalent: watch() with explicit deps
 * React equivalent: useEffect dependency array
 */

import { untrack } from './untrack.js';

/**
 * Create a tracked effect body that only fires when specific dependencies change.
 *
 * Wraps a function so that only the `deps` signals are tracked.
 * All signal reads inside `fn` are untracked (won't cause re-runs).
 *
 * Use with `createEffect`:
 *
 * ```ts
 * const [a, setA] = createSignal(1);
 * const [b, setB] = createSignal(2);
 *
 * // Only re-runs when `a` changes, NOT when `b` changes:
 * createEffect(on(a, (value, prev) => {
 *   console.log(`a changed: ${prev} → ${value}, b is ${b()}`);
 * }));
 *
 * setA(10);  // fires: "a changed: 1 → 10, b is 2"
 * setB(20);  // does NOT fire
 * ```
 *
 * Multiple dependencies:
 * ```ts
 * createEffect(on(
 *   () => [a(), b()] as const,
 *   ([aVal, bVal], prev) => { ... }
 * ));
 * ```
 */
export function on<T, U>(
  deps: () => T,
  fn: (value: T, prev: T | undefined) => U,
  options?: { defer?: boolean },
): () => U | undefined {
  let prev: T | undefined;
  let isFirst = true;

  return () => {
    // Track only the deps
    const value = deps();

    if (options?.defer && isFirst) {
      isFirst = false;
      prev = value;
      return undefined;
    }

    // Run the body untracked so it doesn't add extra dependencies
    const result = untrack(() => fn(value, prev));
    prev = value;
    return result;
  };
}
