/**
 * Forma Reactive - Dev Mode
 *
 * Dev-only diagnostics in this package are guarded by `__DEV__`.
 */

declare const process: { env?: Record<string, string | undefined> } | undefined;
declare const __FORMA_DEV__: boolean | undefined;
declare const __FORMA_DEV_BUILD__: boolean | undefined;

/**
 * Fallback used ONLY when nothing replaced `__FORMA_DEV_BUILD__` — i.e. when
 * this file is consumed as raw source (this repo's own vitest run, a consumer
 * compiling from src). Derives from NODE_ENV, and when the environment is
 * indeterminate defaults to *false* (production-safe: no console noise) unless
 * a consumer opts in via a global `__FORMA_DEV__`.
 */
function isDev(): boolean {
  if (typeof process !== 'undefined') {
    return process!.env?.NODE_ENV !== 'production';
  }
  return typeof __FORMA_DEV__ !== 'undefined' ? !!__FORMA_DEV__ : false;
}

/**
 * True when dev diagnostics are enabled.
 *
 * In every artifact `npm run build` publishes this is a BUILD-TIME constant:
 * tsup's `define` replaces the free identifier `__FORMA_DEV_BUILD__` with the
 * literal `false`, esbuild folds the expression while parsing, and both the
 * `isDev()` fallback and its `process.env.NODE_ENV` read are dropped from the
 * bundle entirely. Shipped code never inspects the environment, so dev
 * diagnostics cannot fire — not in a browser, and not in the Node/SSR or
 * bundler process that leaves NODE_ENV unset, which is where they used to.
 *
 * What that does NOT mean is that every guarded statement is gone. esbuild's
 * `minifySyntax` inlines the `false` into many `if (__DEV__)` sites and deletes
 * them, but it cannot do so where the constant crosses a code-splitting chunk
 * boundary (dist/index.js and dist/index.cjs import it from a shared chunk).
 * The surviving `__DEV__ && console.warn(…)` calls cost bytes; they cannot run.
 *
 * Two details this expression depends on, both load-bearing:
 *
 *   - `define` cannot substitute `__DEV__` itself. It is a module export, so
 *     every use site sees a *bound* identifier and esbuild only rewrites free
 *     ones. That is why the replaceable flag has a separate name.
 *   - The `&&`/`||` shape is deliberate. esbuild constant-folds `typeof`, `===`
 *     and the logical operators while parsing, but NOT the conditional operator,
 *     so the equivalent `cond ? a : b` would leave `true ? false : isDev()` in
 *     the output, keep the NODE_ENV read alive, and block const inlining.
 *
 * Verified by: src/reactive/__tests__/dev-flag.test.ts > "resolves __DEV__ at build time and drops the NODE_ENV fallback"
 */
export const __DEV__: boolean =
  (typeof __FORMA_DEV_BUILD__ === 'boolean' && __FORMA_DEV_BUILD__)
  || (typeof __FORMA_DEV_BUILD__ !== 'boolean' && isDev());

// ---------------------------------------------------------------------------
// Duplicate-instance detection
// ---------------------------------------------------------------------------

/** Registry shape stored on globalThis under {@link INSTANCE_KEY}. */
interface InstanceRegistry {
  count: number;
  warned: boolean;
}

/**
 * `Symbol.for` (the cross-realm registry) rather than a unique symbol: two
 * copies of this module must find the SAME key, which is the entire point.
 */
const INSTANCE_KEY = Symbol.for('@getforma/core#instances');

type InstanceHost = Record<symbol, InstanceRegistry | undefined>;

/**
 * Count this copy of the module graph and warn once if it is not the first.
 *
 * FormaJS keeps its scopes, owner tree, component registry and island registry
 * in module scope, so two copies of the package in one process behave as two
 * unrelated libraries: a signal created through copy A is invisible to copy B.
 * Two shipped topologies can cause that and neither is detectable statically:
 *
 *   1. Mixing `import` and `require` of `@getforma/core` in one process — the
 *      ESM and CJS outputs are independent full implementations.
 *   2. Loading `@getforma/core` together with `@getforma/core/runtime-hardened`
 *      or `@getforma/core/browser`, both of which bundle their own private copy
 *      of the core (they must: the hardened build compiles with a different
 *      unsafe-eval define, and the browser build inlines its dependencies).
 *
 * Deliberately NOT gated on `__DEV__`: this is a packaging mistake that only
 * manifests in built consumption, where `__DEV__` is `false`. It fires at most
 * once per process and does nothing when a single copy is loaded.
 *
 * Verified by: src/reactive/__tests__/dev-flag.test.ts > "warns once when a second copy of the module graph registers"
 */
function registerInstance(): void {
  const host = globalThis as unknown as InstanceHost;
  const registry = host[INSTANCE_KEY] ?? (host[INSTANCE_KEY] = { count: 0, warned: false });
  registry.count += 1;
  if (registry.count > 1 && !registry.warned) {
    registry.warned = true;
    console.warn(
      `[forma] Duplicate @getforma/core instance detected (${registry.count} copies loaded). ` +
      'Signals, the owner tree, the component registry and the island registry are per-copy, ' +
      'so state created through one copy is invisible to the other. Usual causes: mixing ' +
      "`import` and `require` of @getforma/core in one process, or loading '@getforma/core' " +
      "alongside '@getforma/core/runtime-hardened' or '@getforma/core/browser', which bundle " +
      'their own private copy of the core.'
    );
  }
}

registerInstance();

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
  // `__DEV__`, not `isDev()`: calling isDev() here re-read process.env.NODE_ENV
  // on every reported error, which is exactly the runtime dev-detection that
  // makes dist builds noisy when NODE_ENV is unset. Registered handlers above
  // still receive every error in every build.
  if (__DEV__) {
    console.error(`[forma] ${source ?? 'Unknown'} error:`, error);
  }
}
