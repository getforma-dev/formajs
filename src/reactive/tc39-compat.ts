/**
 * Forma Reactive - TC39 Signals Compatibility Layer
 *
 * Optional class-based API matching the TC39 Signals proposal (Stage 1).
 * Not included in main bundle — import from 'formajs/tc39' subpath.
 *
 * When the TC39 proposal advances, these classes can be replaced with
 * native Signal.State and Signal.Computed.
 *
 * @see https://github.com/tc39/proposal-signals
 */

import { createSignal, type SignalOptions } from './signal.js';
import { createComputed } from './computed.js';

/**
 * TC39-compatible reactive state container.
 * Equivalent to `Signal.State` in the TC39 proposal.
 *
 * ```ts
 * const count = new State(0);
 * console.log(count.get()); // 0
 * count.set(1);
 * ```
 */
export class State<T> {
  private _get: () => T;
  private _set: (v: T | ((prev: T) => T)) => void;

  constructor(initialValue: T, options?: SignalOptions<T>) {
    const [getter, setter] = createSignal(initialValue);
    this._get = getter;

    // Handle custom equality in the TC39 compat layer (not in createSignal hot path)
    if (options?.equals) {
      const eq = options.equals;
      this._set = (v: T | ((prev: T) => T)) => {
        const next = typeof v === 'function' ? (v as (prev: T) => T)(getter()) : v;
        if (!eq(getter(), next)) setter(() => next);
      };
    } else {
      this._set = setter;
    }

    if (options?.name) {
      Object.defineProperty(getter, 'name', { value: options.name });
    }
  }

  get(): T {
    return this._get();
  }

  set(value: T): void {
    this._set(value);
  }
}

/**
 * TC39-compatible computed value.
 * Equivalent to `Signal.Computed` in the TC39 proposal.
 *
 * ```ts
 * const count = new State(0);
 * const doubled = new Computed(() => count.get() * 2);
 * console.log(doubled.get()); // 0
 * count.set(5);
 * console.log(doubled.get()); // 10
 * ```
 */
export class Computed<T> {
  private _get: () => T;

  constructor(fn: () => T) {
    this._get = createComputed(fn);
  }

  get(): T {
    return this._get();
  }
}
