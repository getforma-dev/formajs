/**
 * Forma Reactive - Resource
 *
 * Async data fetching primitive with reactive loading/error state.
 * Tracks a source signal and refetches when it changes.
 *
 * SolidJS equivalent: createResource
 * React equivalent: use() + Suspense (React 19), or useSWR/react-query
 */

import { createSignal, type SignalGetter } from './signal.js';
import { internalEffect } from './effect.js';
import { untrack } from './untrack.js';
import { getSuspenseContext } from './suspense-context.js';

/** An async data resource with reactive loading and error state. */
export interface Resource<T> {
  /** The resolved data (or undefined while loading). */
  (): T | undefined;
  /** True while the fetcher is running. */
  loading: SignalGetter<boolean>;
  /** The error if the fetcher rejected (or undefined). */
  error: SignalGetter<unknown>;
  /** Manually refetch with the current source value. */
  refetch: () => void;
  /** Manually set the data (overrides fetcher result). */
  mutate: (value: T | undefined) => void;
}

/** Options for {@link createResource}. */
export interface ResourceOptions<T> {
  /** Initial value before first fetch resolves. */
  initialValue?: T;
}

/**
 * Create an async resource that fetches data reactively.
 *
 * When `source` changes, the fetcher re-runs automatically.
 * Provides reactive `loading` and `error` signals.
 *
 * ```ts
 * const [userId, setUserId] = createSignal(1);
 *
 * const user = createResource(
 *   userId,                                    // source signal
 *   (id) => fetch(`/api/users/${id}`).then(r => r.json()), // fetcher
 * );
 *
 * internalEffect(() => {
 *   if (user.loading()) console.log('Loading...');
 *   else if (user.error()) console.log('Error:', user.error());
 *   else console.log('User:', user());
 * });
 *
 * setUserId(2); // automatically refetches
 * ```
 *
 * Without a source signal (static fetch):
 * ```ts
 * const posts = createResource(
 *   () => true,  // constant source — fetches once
 *   () => fetch('/api/posts').then(r => r.json()),
 * );
 * ```
 */
export function createResource<T, S = true>(
  source: SignalGetter<S>,
  fetcher: (source: S) => Promise<T>,
  options?: ResourceOptions<T>,
): Resource<T> {
  const [data, setData] = createSignal<T | undefined>(options?.initialValue);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<unknown>(undefined);

  // Capture the Suspense context at creation time (not at fetch time).
  // This is critical because the Suspense boundary pushes/pops its context
  // synchronously during children() execution.
  const suspenseCtx = getSuspenseContext();

  let abortController: AbortController | null = null;
  let fetchVersion = 0;

  const doFetch = () => {
    // Read source outside tracking to get current value
    const sourceValue = untrack(source);

    // Abort previous in-flight request
    if (abortController) {
      abortController.abort();
    }
    const controller = new AbortController();
    abortController = controller;

    const version = ++fetchVersion;
    const isLatest = () => version === fetchVersion;
    let suspensePending = false;

    // Notify Suspense boundary that a fetch has started
    if (suspenseCtx) {
      suspenseCtx.increment();
      suspensePending = true;
    }

    setLoading(true);
    setError(undefined);

    Promise.resolve(fetcher(sourceValue))
      .then((result) => {
        // Only apply if this is still the latest fetch and wasn't aborted.
        if (isLatest() && !controller.signal.aborted) {
          setData(() => result);
        }
      })
      .catch((err) => {
        if (isLatest() && !controller.signal.aborted) {
          // Ignore abort errors
          if (err?.name !== 'AbortError') {
            setError(err);
          }
        }
      })
      .finally(() => {
        if (suspensePending) suspenseCtx?.decrement();
        if (isLatest()) {
          setLoading(false);
          if (abortController === controller) {
            abortController = null; // Release controller for GC
          }
        }
      });
  };

  // Auto-fetch when source changes
  internalEffect(() => {
    source(); // track the source signal
    doFetch();
  });

  // Build the resource object
  const resource = (() => data()) as Resource<T>;
  resource.loading = loading;
  resource.error = error;
  resource.refetch = doFetch;
  resource.mutate = (value) => setData(() => value);

  return resource;
}
