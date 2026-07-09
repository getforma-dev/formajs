/**
 * Forma Reactive - Dev Mode
 *
 * Development utilities stripped from production builds via __DEV__ flag.
 * Bundlers replace __DEV__ with false → dead-code elimination removes all dev paths.
 */

// __DEV__ is replaced by the bundler (tsup define) for dead-code elimination in
// dist. For unbundled/raw-source usage it derives from NODE_ENV, and — when the
// environment is indeterminate — defaults to *false* (production-safe: no console
// noise) unless a consumer opts in via a global __FORMA_DEV__.
declare const process: { env?: Record<string, string | undefined> } | undefined;
declare const __FORMA_DEV__: boolean | undefined;

/**
 * Lazily evaluate whether we're in a dev environment. Read per-call (not frozen
 * at import) so runtime NODE_ENV changes are honored and so official prod dist
 * builds — where tsup hard-defines __DEV__ = false — stay quiet regardless.
 */
function isDev(): boolean {
  if (typeof process !== 'undefined') {
    return process!.env?.NODE_ENV !== 'production';
  }
  return typeof __FORMA_DEV__ !== 'undefined' ? !!__FORMA_DEV__ : false;
}

export const __DEV__: boolean = isDev();

// ---------------------------------------------------------------------------
// Global error handlers
// ---------------------------------------------------------------------------

/** Callback signature for a global {@link onError} handler. */
export type ErrorHandler = (error: unknown, info?: { source?: string }) => void;

const _errorHandlers = new Set<ErrorHandler>();

/**
 * Install a global error handler for FormaJS reactive errors. Called when
 * effects, computeds, or event handlers throw. Multiple handlers may be
 * registered; returns an unsubscribe function that removes only this handler.
 *
 * ```ts
 * const off = onError((err, info) => {
 *   Sentry.captureException(err, { tags: { source: info?.source } });
 * });
 * // later: off();
 * ```
 */
export function onError(handler: ErrorHandler): () => void {
  _errorHandlers.add(handler);
  return () => { _errorHandlers.delete(handler); };
}

/** @internal */
export function reportError(error: unknown, source?: string): void {
  for (const handler of _errorHandlers) {
    try { handler(error, source ? { source } : {}); } catch { /* prevent infinite loop */ }
  }
  if (isDev()) {
    console.error(`[forma] ${source ?? 'Unknown'} error:`, error);
  }
}
