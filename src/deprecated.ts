/**
 * What 2.x deprecates and 3.0.0 removes: three entry points (FORMA-131; v2's
 * DR-22 to DR-24), each logging its code once, the first time it is loaded in
 * a development build, and the runtime's tierless `reconcile()` (FORMA-128;
 * DR-14), logging its code the first time it is called in one. Each code comes
 * with the line that goes with it.
 *
 * Only `src/server/index.ts`, `src/wasm/forma-wasm.ts`, `src/ssr/index.ts` and
 * `src/runtime.ts` import this module, each behind a condition the build folds
 * to `false`. The module has no side effects, so the build then drops the
 * import as well, and no published artifact contains any of it.
 *
 * Verified by: src/__tests__/deprecated-entries.test.ts > "a production build of each deprecated entry carries no warning"
 */
export const DEPRECATIONS = {
  FORMA_W_DEPRECATED_SERVER:
    '@getforma/core/server (server functions: "use server", $$serverFunction, handleRPC, ' +
    'createAction and the revalidation helpers) is deprecated and will be removed in 3.0.0. ' +
    "Serve the call from a route in your application's Rust server and fetch it.",
  FORMA_W_DEPRECATED_WASM:
    '@getforma/core/wasm (renderLocal, renderIsland: the WASM walker) is deprecated and will be ' +
    'removed in 3.0.0. Re-render an island in the browser with h(), as islands already do.',
  FORMA_W_DEPRECATED_SSR:
    '@getforma/core/ssr (renderToString, renderToStream) is deprecated and will be removed in 3.0.0. ' +
    'Render on the server with the Rust walker (forma-server). Unlike the walker, renderToString ' +
    "writes a textarea's and a select's value as a value attribute, which the HTML parser ignores.",
  FORMA_W_DEPRECATED_RECONCILE:
    'reconcile() from @getforma/core/runtime binds markup with every power the runtime has (the tierless ' +
    'path) and will be removed in 3.0.0. Mount through mountMarkup(root, markup, { tier, grants }), ' +
    'which binds only under the root it is handed, with the grants it names.',
} as const;

/** The code a deprecated entry logs. */
export type DeprecationCode = keyof typeof DEPRECATIONS;

declare const process: { env?: Record<string, string | undefined> } | undefined;
declare const __FORMA_DEV__: boolean | undefined;

/**
 * What `__DEV__` falls back to when nothing replaced the build flag, that is
 * when core runs from source: `isDev()` in `src/reactive/dev.ts`, restated.
 * It is restated rather than imported because importing `dev.ts` also runs its
 * duplicate-instance registration, and the build keeps that import for its
 * side effect even where the warning folds away: `dist/wasm.js` would gain an
 * import of core's reactive chunk.
 *
 * Verified by: src/__tests__/deprecated-entries.test.ts > "decides a development build as __DEV__ does, under every NODE_ENV"
 */
export function sourceIsDev(): boolean {
  if (typeof process !== 'undefined') {
    return process!.env?.NODE_ENV !== 'production';
  }
  return typeof __FORMA_DEV__ !== 'undefined' ? !!__FORMA_DEV__ : false;
}

/**
 * Log `code`'s deprecation once per process. The codes already logged live on
 * `globalThis` under a `Symbol.for` key, so a second copy of an entry (a test
 * that resets modules, a development server that reloads one) stays quiet.
 *
 * Verified by: src/__tests__/deprecated-entries.test.ts > "$subpath logs its deprecation once in development, with its code"
 */
export function warnDeprecated(code: DeprecationCode): void {
  const host = globalThis as unknown as Record<symbol, Set<string> | undefined>;
  const key = Symbol.for('@getforma/core#deprecations');
  const logged = host[key] ?? (host[key] = new Set<string>());
  if (logged.has(code)) return;
  logged.add(code);
  console.warn(`[forma] ${code}: ${DEPRECATIONS[code]}`);
}
