/**
 * Forma Reactive - Ref
 *
 * Mutable container that does NOT trigger reactivity.
 * Use for DOM references, previous values, instance variables —
 * anything that needs to persist across effect re-runs without
 * causing re-execution.
 *
 * React equivalent: useRef
 * SolidJS equivalent: (none — uses plain variables in setup)
 */

export interface Ref<T> {
  current: T;
}

/**
 * Create a mutable ref container.
 *
 * Unlike signals, writing to `.current` does NOT trigger effects.
 * Use when you need a stable reference across reactive scopes.
 *
 * ```ts
 * const timerRef = createRef<number | null>(null);
 *
 * createEffect(() => {
 *   timerRef.current = setInterval(tick, 1000);
 *   onCleanup(() => clearInterval(timerRef.current!));
 * });
 *
 * // DOM ref pattern:
 * const elRef = createRef<HTMLElement | null>(null);
 * h('div', { ref: (el) => { elRef.current = el; } });
 * ```
 */
export function createRef<T>(initialValue: T): Ref<T> {
  return { current: initialValue };
}
