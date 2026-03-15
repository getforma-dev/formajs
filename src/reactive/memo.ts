/**
 * Forma Reactive - Memo
 *
 * Alias for createComputed with SolidJS/React-familiar naming.
 * A memoized derived value that only recomputes when its dependencies change.
 *
 * TC39 Signals equivalent: Signal.Computed
 */

import { createComputed } from './computed.js';

/**
 * Create a memoized computed value.
 * Identical to `createComputed` — provided for React/SolidJS familiarity.
 *
 * Note: Unlike SolidJS's createComputed (which is an eager synchronous
 * side effect), both createComputed and createMemo in FormaJS are lazy
 * cached derivations — equivalent to SolidJS's createMemo. They are
 * identical.
 *
 * The computation runs lazily and caches the result. It only recomputes
 * when a signal it reads during computation changes.
 *
 * ```ts
 * const [count, setCount] = createSignal(0);
 * const doubled = createMemo(() => count() * 2);
 * console.log(doubled()); // 0
 * setCount(5);
 * console.log(doubled()); // 10
 * ```
 */
export const createMemo: typeof createComputed = createComputed;
