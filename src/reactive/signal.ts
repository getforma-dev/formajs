/**
 * Forma Reactive - Signal
 *
 * Fine-grained reactive primitive backed by alien-signals.
 * API: createSignal returns [getter, setter] tuple following SolidJS conventions.
 *
 * TC39 Signals equivalent: Signal.State
 */

import { signal as createRawSignal, setActiveSub, getActiveSub, trigger } from 'alien-signals';
import { __DEV__ } from './dev.js';
import { notifyReactiveWrite } from './effect.js';

// Debug names live in a side table rather than on the getter's `.name`, so
// alien-signals' isSignal() (which keys off the bound function name) still
// recognizes named signals.
const signalNames = new WeakMap<object, string>();

/** Debug name of a signal getter, if one was provided (dev-only). */
export function getSignalName(fn: unknown): string | undefined {
  return typeof fn === 'function' ? signalNames.get(fn as object) : undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** A function that reads the current value of a signal. */
export type SignalGetter<T> = () => T;
/** A function that updates a signal — accepts a value or an updater function. */
export type SignalSetter<T> = (v: T | ((prev: T) => T)) => void;

export interface SignalOptions<T> {
  /** Debug name — attached to getter in dev mode for devtools inspection. */
  name?: string;
  /**
   * Custom equality check. When provided, the setter will read the current
   * value and only update the signal if `equals(prev, next)` returns `false`.
   *
   * Default: none (alien-signals uses strict inequality `!==` internally).
   *
   * ```ts
   * const [pos, setPos] = createSignal(
   *   { x: 0, y: 0 },
   *   { equals: (a, b) => a.x === b.x && a.y === b.y },
   * );
   *
   * setPos({ x: 0, y: 0 }); // skipped — equals returns true
   * setPos({ x: 1, y: 0 }); // applied — equals returns false
   * ```
   */
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
  equals?: (prev: T, next: T) => boolean,
): void {
  const isFn = typeof v === 'function';
  const activeSub = getActiveSub();

  // Fast path: plain value, no equals, and no running sub on the stack — nothing
  // extra to compute, byte-for-byte the original behavior.
  if (!isFn && !equals && activeSub === undefined) {
    s(v);
    return;
  }

  // Read the current value without tracking (needed for equals, for a functional
  // updater, and/or to detect a real self-write while an effect is running).
  const prevSub = setActiveSub(undefined);
  const prev = s();
  setActiveSub(prevSub);
  const next = isFn ? (v as (prev: T) => T)(prev) : (v as T);

  if (equals && equals(prev, next)) return; // suppressed by custom equality

  s(next);

  const sameRef = Object.is(prev, next);
  if (equals && sameRef) {
    // equals decided to APPLY (returned false) but the reference is identical, so
    // alien-signals suppressed propagation (its guard is pendingValue !== value).
    // Force-notify subscribers so equals:()=>false ("always notify") works.
    trigger(() => { s(); });
  }
  if (activeSub !== undefined && (!sameRef || equals)) {
    // A running effect just wrote a signal it depends on. alien-signals never
    // notifies a currently-running subscriber, so bridge it: request a re-run so
    // the effect observes the value it set.
    notifyReactiveWrite();
  }
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
 *
 * With custom equality:
 *
 * ```ts
 * const [pos, setPos] = createSignal(
 *   { x: 0, y: 0 },
 *   { equals: (a, b) => a.x === b.x && a.y === b.y },
 * );
 * ```
 */
export function createSignal<T>(initialValue: T, options?: SignalOptions<T>): [get: SignalGetter<T>, set: SignalSetter<T>] {
  const s = createRawSignal<T>(initialValue) as RawSignal<T>;
  const getter = s as unknown as SignalGetter<T>;
  if (__DEV__ && options?.name) {
    signalNames.set(getter as object, options.name);
  }
  const eq = options?.equals;
  const setter: SignalSetter<T> = (v: T | ((prev: T) => T)) => applySignalSet(s, v, eq);

  return [getter, setter];
}
