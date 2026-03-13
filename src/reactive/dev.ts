/**
 * Forma Reactive - Dev Mode
 *
 * Development utilities stripped from production builds via __DEV__ flag.
 * Bundlers replace __DEV__ with false → dead-code elimination removes all dev paths.
 */

// __DEV__ is replaced by bundler (tsup define). Defaults to true for unbundled usage.
declare const process: { env?: Record<string, string | undefined> } | undefined;
export const __DEV__: boolean = typeof process !== 'undefined'
  ? (process!.env?.NODE_ENV !== 'production')
  : true;

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------

type ErrorHandler = (error: unknown, info?: { source?: string }) => void;

let _errorHandler: ErrorHandler | null = null;

/**
 * Install a global error handler for FormaJS reactive errors.
 * Called when effects, computeds, or event handlers throw.
 *
 * ```ts
 * onError((err, info) => {
 *   console.error(`[${info?.source}]`, err);
 *   Sentry.captureException(err);
 * });
 * ```
 */
export function onError(handler: ErrorHandler): void {
  _errorHandler = handler;
}

/** @internal */
export function reportError(error: unknown, source?: string): void {
  if (_errorHandler) {
    try { _errorHandler(error, source ? { source } : {}); } catch { /* prevent infinite loop */ }
  }
  if (__DEV__) {
    console.error(`[forma] ${source ?? 'Unknown'} error:`, error);
  }
}
