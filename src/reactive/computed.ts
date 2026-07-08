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
import { reportError } from './dev.js';

/** Unique per-throw marker so alien-signals sees a value change and propagates. */
const ERR = Symbol('formaComputedError');
interface ErrBox { [ERR]: unknown; }
function isErrBox(v: unknown): v is ErrBox {
  return typeof v === 'object' && v !== null && ERR in (v as object);
}

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
  // alien-signals' updateComputed leaves a throwing computed flagged clean with a
  // stale value, so a later read silently returns the stale value and never
  // rethrows. We cache the error in closure and rethrow on read until a
  // dependency changes (TC39/Solid). On throw we return a FRESH sentinel object so
  // alien-signals sees a value change and propagates the error to subscribers; the
  // user getter only ever sees the last GOOD value as `previousValue`.
  let errored = false;
  let error: unknown;
  let lastGood: T | undefined;

  const raw = rawComputed<T | ErrBox>(() => {
    try {
      const v = fn(lastGood);
      errored = false;
      error = undefined;
      lastGood = v;
      return v;
    } catch (e) {
      errored = true;
      error = e;
      reportError(e, 'computed');
      return { [ERR]: e };
    }
  });

  const reader = () => {
    const v = raw();
    if (errored || isErrBox(v)) throw error;
    return v as T;
  };
  // Preserve alien-signals' isComputed() recognition, which keys off the bound
  // function name (`bound computedOper`). Our reader wraps the raw computed, so
  // copy the raw name onto it.
  Object.defineProperty(reader, 'name', { value: raw.name, configurable: true });
  return reader;
}
