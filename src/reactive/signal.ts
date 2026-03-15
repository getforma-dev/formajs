/**
 * Forma Reactive - Signal
 *
 * Fine-grained reactive primitive backed by alien-signals.
 * API: createSignal returns [getter, setter] tuple following SolidJS conventions.
 *
 * TC39 Signals equivalent: Signal.State
 */

import { signal as createRawSignal, pauseTracking, resumeTracking } from 'alien-signals';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type SignalGetter<T> = () => T;
export type SignalSetter<T> = (v: T | ((prev: T) => T)) => void;

export interface SignalOptions<T> {
  /** Debug name — attached to getter in dev mode for devtools inspection. */
  name?: string;
  /** Custom equality check. Default: Object.is (via alien-signals). */
  equals?: (prev: T, next: T) => boolean;
}

/**
 * Wrap a value so the setter treats it as a literal value, not a functional updater.
 *
 * When `T` is itself a function type, passing a function to the setter is
 * ambiguous -- it looks like a functional update (`prev => next`). Use
 * `value()` to disambiguate:
 *
 * ```ts
 * const [getFn, setFn] = createSignal<() => void>(() => console.log('a'));
 *
 * // BUG: interpreted as a functional update -- calls the arrow with prev
 * // setFn(() => console.log('b'));
 *
 * // Correct: wraps in a thunk so the setter stores it as-is
 * setFn(value(() => console.log('b')));
 * ```
 */
export function value<T>(v: T): () => T {
  return () => v;
}

type RawSignal<T> = {
  (): T;
  (value: T): void;
};

function applySignalSet<T>(
  s: RawSignal<T>,
  v: T | ((prev: T) => T),
): void {
  if (typeof v !== 'function') {
    s(v);
    return;
  }

  pauseTracking();
  const prev = s();
  resumeTracking();
  s((v as (prev: T) => T)(prev));
}

/**
 * Create a reactive signal.
 *
 * ```ts
 * const [count, setCount] = createSignal(0);
 * console.log(count()); // 0
 * setCount(1);
 * setCount(prev => prev + 1);
 * ```
 */
export function createSignal<T>(initialValue: T): [get: SignalGetter<T>, set: SignalSetter<T>] {
  const s = createRawSignal<T>(initialValue) as RawSignal<T>;
  const getter = s as unknown as SignalGetter<T>;
  const setter: SignalSetter<T> = (v: T | ((prev: T) => T)) => applySignalSet(s, v);

  return [getter, setter];
}
