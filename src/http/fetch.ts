/**
 * Forma HTTP - Fetch
 *
 * Typed fetch wrapper with reactive signal integration.
 * Zero dependencies — native browser APIs only.
 */

import { createSignal, internalEffect } from 'forma/reactive';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FetchOptions<T> extends Omit<RequestInit, 'signal'> {
  base?: string;
  params?: Record<string, string>;
  timeout?: number; // ms, default 30000
  transform?: (data: unknown) => T;
}

export interface FetchResult<T> {
  data: () => T | null;
  error: () => Error | null;
  loading: () => boolean;
  refetch: () => Promise<void>;
  abort: () => void;
}

// ---------------------------------------------------------------------------
// createFetch — reactive fetch with signals
// ---------------------------------------------------------------------------

/**
 * Create a reactive fetch that exposes data/error/loading as signals.
 *
 * If `url` is a signal getter (function), an effect auto-refetches when it
 * changes.
 *
 * ```ts
 * const { data, loading, error, refetch, abort } = createFetch<User[]>('/api/users');
 * ```
 */
export function createFetch<T>(
  url: string | (() => string),
  options?: FetchOptions<T>,
): FetchResult<T> {
  const [data, setData] = createSignal<T | null>(null);
  const [error, setError] = createSignal<Error | null>(null);
  const [loading, setLoading] = createSignal<boolean>(false);

  let currentController: AbortController | null = null;

  /** Resolve the URL string, applying base and params. */
  function resolveURL(): string {
    const raw = typeof url === 'function' ? url() : url;
    const base = options?.base || (typeof window !== 'undefined' ? window.location.origin : '');
    const fullURL = new URL(raw, base || undefined);

    if (options?.params) {
      for (const [key, value] of Object.entries(options.params)) {
        fullURL.searchParams.set(key, value);
      }
    }

    return fullURL.toString();
  }

  /** Execute a single fetch request. */
  async function execute(): Promise<void> {
    // Abort any in-flight request
    if (currentController) {
      currentController.abort();
    }

    currentController = new AbortController();
    const controller = currentController;
    const timeoutMs = options?.timeout ?? 30_000;

    // Set up timeout
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    setLoading(true);
    setError(null);

    try {
      const resolvedURL = resolveURL();

      const { base: _base, params: _params, timeout: _timeout, transform, ...fetchInit } =
        options ?? {};

      const response = await fetch(resolvedURL, {
        ...fetchInit,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const json: unknown = await response.json();
      const transformed = transform ? transform(json) : (json as T);
      setData(transformed);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Ignore aborts — they are intentional or timeouts
        return;
      }
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      clearTimeout(timeoutId);
      // Only update loading if this controller is still current
      if (currentController === controller) {
        currentController = null;
        setLoading(false);
      }
    }
  }

  // If url is a reactive getter, set up an effect to auto-refetch.
  if (typeof url === 'function') {
    internalEffect(() => {
      // Read the signal so the effect re-runs when it changes
      url();
      void execute();
    });
  } else {
    // Kick off the first request immediately
    void execute();
  }

  return {
    data,
    error,
    loading,
    refetch: execute,
    abort() {
      if (currentController) {
        currentController.abort();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// fetchJSON — simple one-shot helper
// ---------------------------------------------------------------------------

/**
 * One-shot fetch that returns parsed JSON.
 *
 * ```ts
 * const users = await fetchJSON<User[]>('/api/users');
 * ```
 */
export async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return (await response.json()) as T;
}
