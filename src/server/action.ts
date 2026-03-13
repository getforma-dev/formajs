/**
 * FormaJS Server - Action
 *
 * Creates an action that wraps a server function with optimistic UI support.
 * The action immediately applies an optimistic update, then reconciles when
 * the server responds (or rolls back on error).
 */

import { createValueSignal, batch } from '../reactive/index.js';
import type { Resource } from '../reactive/resource.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActionOptions<Args extends unknown[], Result> {
  /**
   * Apply an optimistic update immediately when the action is called.
   * This runs BEFORE the server function.
   * Store whatever you need to roll back in the return value or via closures.
   */
  optimistic?: (...args: Args) => void;

  /**
   * Called when the server function resolves successfully.
   * Use this to apply the server result to local state.
   */
  onSuccess?: (result: Result, ...args: Args) => void;

  /**
   * Called when the server function rejects.
   * Use this to roll back the optimistic update.
   */
  onError?: (error: unknown, ...args: Args) => void;

  /**
   * Resources to refetch after the action completes successfully.
   * Used with single-flight mutations: if the server response includes
   * revalidation data, these resources are updated without a refetch.
   */
  invalidates?: Resource<unknown>[];
}

export interface Action<Args extends unknown[], Result> {
  /** Execute the action. */
  (...args: Args): Promise<Result>;
  /** Whether the action is currently in-flight. */
  pending: () => boolean;
  /** The last error from the action (or undefined). */
  error: () => unknown;
  /** Clear the error state. */
  clearError: () => void;
}

/**
 * Create an action that wraps a server function with optimistic UI.
 *
 * ```ts
 * const addTodo = createAction(
 *   serverCreateTodo,
 *   {
 *     optimistic: (text) => {
 *       // Immediately add to local list
 *       setTodos(prev => [...prev, { text, done: false, id: 'temp' }]);
 *     },
 *     onSuccess: (result) => {
 *       // Replace temp item with server result
 *       setTodos(prev => prev.map(t => t.id === 'temp' ? result : t));
 *     },
 *     onError: (err, text) => {
 *       // Remove the optimistic item
 *       setTodos(prev => prev.filter(t => t.id !== 'temp'));
 *     },
 *     invalidates: [todosResource],
 *   },
 * );
 *
 * // Use:
 * await addTodo('Buy milk');
 * ```
 */
export function createAction<Args extends unknown[], Result>(
  serverFn: (...args: Args) => Promise<Result>,
  options?: ActionOptions<Args, Result>,
): Action<Args, Result> {
  const [pending, setPending] = createValueSignal(false);
  const [error, setError] = createValueSignal<unknown>(undefined);

  const action = async (...args: Args): Promise<Result> => {
    setPending(true);
    setError(undefined);

    // Apply optimistic update immediately
    if (options?.optimistic) {
      try {
        batch(() => options.optimistic!(...args));
      } catch {
        // Swallow errors in optimistic callback
      }
    }

    try {
      const result = await serverFn(...args);

      // Apply success handler
      if (options?.onSuccess) {
        batch(() => options.onSuccess!(result, ...args));
      }

      // Revalidate dependent resources
      if (options?.invalidates) {
        for (const resource of options.invalidates) {
          resource.refetch();
        }
      }

      setPending(false);
      return result;
    } catch (err) {
      // Apply error/rollback handler
      if (options?.onError) {
        try {
          batch(() => options.onError!(err, ...args));
        } catch {
          // Swallow errors in rollback
        }
      }

      setError(err);
      setPending(false);
      throw err;
    }
  };

  // Attach signal accessors to the action function
  const typedAction = action as Action<Args, Result>;
  typedAction.pending = pending;
  typedAction.error = error;
  typedAction.clearError = () => setError(undefined);

  return typedAction;
}
