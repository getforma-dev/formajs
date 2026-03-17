/**
 * Forma Reactive - Reducer
 *
 * State machine pattern — dispatch actions to a pure reducer function.
 * Fine-grained: only the resulting state signal is reactive.
 *
 * React equivalent: useReducer
 * SolidJS equivalent: (none — uses createSignal + helpers)
 */

import { createSignal, type SignalGetter } from './signal.js';

/** A function that dispatches an action to a reducer. */
export type Dispatch<A> = (action: A) => void;

/**
 * Create a reducer — predictable state updates via dispatched actions.
 *
 * The reducer function must be pure: `(state, action) => newState`.
 * Returns a [state, dispatch] tuple.
 *
 * ```ts
 * type Action = { type: 'increment' } | { type: 'decrement' } | { type: 'reset' };
 *
 * const [count, dispatch] = createReducer(
 *   (state: number, action: Action) => {
 *     switch (action.type) {
 *       case 'increment': return state + 1;
 *       case 'decrement': return state - 1;
 *       case 'reset': return 0;
 *     }
 *   },
 *   0,
 * );
 *
 * dispatch({ type: 'increment' }); // count() === 1
 * dispatch({ type: 'increment' }); // count() === 2
 * dispatch({ type: 'reset' });     // count() === 0
 * ```
 */
export function createReducer<S, A>(
  reducer: (state: S, action: A) => S,
  initialState: S,
): [state: SignalGetter<S>, dispatch: Dispatch<A>] {
  const [state, setState] = createSignal(initialState);

  const dispatch: Dispatch<A> = (action) => {
    setState((prev) => reducer(prev, action));
  };

  return [state, dispatch];
}
