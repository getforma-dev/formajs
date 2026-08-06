/**
 * Build-time constants shared by tsup.config.ts, scripts/verify-dist.mjs,
 * scripts/check-size.mjs and the packaging tests.
 *
 * They live in one plain-ESM module so the value the build substitutes and the
 * value the tests/gates assert on cannot drift apart: tsup.config.ts is a
 * TypeScript file the .mjs scripts cannot import, and the .mjs scripts are what
 * `npm run build` actually runs.
 */

/**
 * Free identifier that `src/reactive/dev.ts` folds into its exported `__DEV__`
 * constant. esbuild's `define` can only substitute *free* identifiers, so the
 * flag the build replaces has to be a different name from the module export
 * that consumers import.
 */
export const DEV_BUILD_FLAG = '__FORMA_DEV_BUILD__';

/**
 * Identifier `src/reactive/dev.ts` uses only inside its raw-source NODE_ENV
 * fallback. If it is still present in a built artifact, the fallback survived
 * and `__DEV__` is being computed at runtime — which is exactly the bug
 * `dev-flag-define-is-inert-in-dist` describes. verify-dist.mjs asserts its
 * absence from every shipped artifact.
 */
export const RAW_SOURCE_DEV_GLOBAL = '__FORMA_DEV__';

/**
 * esbuild `define` entries applied to every shipped artifact. Values are source
 * text, per esbuild's contract.
 */
export const PROD_DEFINE = Object.freeze({
  [DEV_BUILD_FLAG]: 'false',
});

/** Alias map so `forma/...` imports resolve to `src/...` during a build. */
export const FORMA_ALIAS = Object.freeze({ forma: './src' });

/**
 * The one artifact that must be loadable straight from a CDN by a browser
 * `<script type="module">`, i.e. with every dependency inlined and no bare
 * import specifiers left in it.
 */
export const BROWSER_ESM_OUTPUT = 'dist/forma.esm.js';

/**
 * Artifacts consumers reach by URL rather than by specifier. Nothing in the
 * exports map points at them — the IIFE bundles are classic scripts and could
 * not define their global if they were imported as modules — so verify-dist has
 * to assert their existence explicitly or a rename would silently 404 every
 * documented CDN snippet.
 */
export const CDN_URL_ARTIFACTS = Object.freeze([
  BROWSER_ESM_OUTPUT,
  'dist/formajs-runtime.global.js',
  'dist/formajs-runtime-hardened.global.js',
  'dist/forma-runtime.js',
  'dist/forma-runtime-csp.js',
]);

/**
 * Artifacts that must keep `alien-signals` external so that every Node consumer
 * of the package shares one copy of the reactive graph.
 */
export const EXTERNAL_DEPS_OUTPUTS = Object.freeze(['dist/index.js', 'dist/index.cjs']);
