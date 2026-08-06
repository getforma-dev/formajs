import { defineConfig } from 'tsup';
import {
  FORMA_ALIAS,
  PROD_DEFINE,
} from './scripts/build-defines.mjs';

const formaAlias = { ...FORMA_ALIAS };

/**
 * Every shipped artifact is built with `__FORMA_DEV_BUILD__` replaced by the
 * literal `false` (PROD_DEFINE), which is what makes `__DEV__` a build-time
 * constant instead of a runtime NODE_ENV read.
 *
 * There is no longer an eval-posture define: the `new Function` fallback was
 * deleted from the source, so no build has one to switch on and the "hardened"
 * artifacts differ from the standard ones only in name and bundling strategy.
 * They are kept because they are documented CDN URLs and exports-map targets.
 *
 * Verified by: src/reactive/__tests__/dev-flag.test.ts > "resolves __DEV__ at build time and drops the NODE_ENV fallback"
 * Verified by: src/__tests__/build-artifacts.test.ts > "no build emits new Function or a with() scope wrapper"
 */
function defines() {
  return { ...PROD_DEFINE };
}

/**
 * Syntax-level minification ONLY (`minifyWhitespace`/`minifyIdentifiers` stay
 * off, so output keeps its line structure and real identifier names — minified
 * single-line files trigger false-positive "obfuscated code" flags in supply
 * chain scanners such as Socket.dev and Snyk).
 *
 * This is what makes the build-time dev flag real rather than decorative:
 * esbuild only inlines a `const` bound to a folded literal into its use sites
 * when syntax minification is on. Without it `__DEV__` is a constant nothing
 * reads at build time and `if (__DEV__) console.warn(…)` survives into the
 * shipped bytes.
 *
 * Inlining also stops at chunk boundaries, so the code-split entries keep some
 * unreachable `__DEV__ && …` calls. See src/reactive/dev.ts for what that does
 * and does not guarantee.
 *
 * Verified by: src/__tests__/build-artifacts.test.ts > "the allowlist interpreter is actually in the bundle"
 */
function applyEsbuildOptions(options: { alias?: Record<string, string>; pure?: string[]; minifySyntax?: boolean }, pure?: string[]) {
  options.alias = formaAlias;
  options.minifySyntax = true;
  if (pure) options.pure = pure;
}

// createEffect is NOT pure — it registers reactive subscriptions as side effects
const PURE_FACTORIES = ['createSignal', 'createComputed', 'createStore', 'createBus'];

// `dist/` is emptied once, up front, by `node scripts/clean-dist.mjs` in the
// `build` script. No config sets `clean` — tsup runs these configs in PARALLEL,
// so a clean inside any one of them races the outputs of the others (it used to
// delete config 4's declaration files after they were written, leaving the
// build's result dependent on scheduler timing).
export default defineConfig([
  // ESM + CJS + type declarations — tree-shakeable imports (production).
  // `alien-signals` stays EXTERNAL here on purpose: every Node/bundler consumer
  // must share a single copy of the reactive graph. The self-contained browser
  // build below is the one that inlines it.
  {
    entry: {
      index: 'src/index.ts',
      runtime: 'src/runtime.ts',
      'tc39-compat': 'src/reactive/tc39-compat.ts',
      'ssr/index': 'src/ssr/index.ts',
      http: 'src/http/index.ts',
      storage: 'src/storage/index.ts',
      server: 'src/server/index.ts',
      wasm: 'src/wasm/forma-wasm.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    outDir: 'dist',
    external: [],
    treeshake: true,
    splitting: true,
    target: 'es2022',
    minify: false,
    define: defines(),
    esbuildOptions(options) {
      applyEsbuildOptions(options, PURE_FACTORIES);
    },
  },
  // Self-contained browser ESM build — the artifact the README's
  // `<script type="module">` CDN recipe points at. `noExternal` inlines
  // alien-signals and `splitting: false` keeps it to a single file, so the
  // browser never has to resolve a bare specifier or a sibling chunk URL.
  //
  // Verified by: src/__tests__/build-artifacts.test.ts > "the browser ESM CDN artifact is self-contained"
  {
    entry: { 'forma.esm': 'src/index.ts' },
    format: ['esm'],
    noExternal: [/.*/],
    platform: 'browser',
    dts: false,
    sourcemap: true,
    outDir: 'dist',
    treeshake: true,
    splitting: false,
    target: 'es2022',
    minify: false,
    define: defines(),
    esbuildOptions(options) {
      applyEsbuildOptions(options, PURE_FACTORIES);
    },
  },
  // IIFE runtime build — for <script src="formajs-runtime.global.js"> (HTML API)
  {
    entry: { 'formajs-runtime': 'src/runtime.ts' },
    format: ['iife'],
    globalName: 'FormaRuntime',
    outDir: 'dist',
    minify: false,
    sourcemap: true,
    target: 'es2022',
    define: defines(),
    esbuildOptions(options) {
      applyEsbuildOptions(options);
    },
  },
  // "Hardened" runtime. Historically this was the build with the `new Function`
  // fallback compiled out; the fallback is gone from the source, so it is now
  // the same runtime under a second, tree-shaken, non-code-split name. It stays
  // because `@getforma/core/runtime-hardened`, `@getforma/core/runtime-csp` and
  // two documented CDN URLs point at it.
  //
  // Verified by: src/__tests__/build-artifacts.test.ts > "no build emits new Function or a with() scope wrapper"
  {
    entry: { 'runtime-hardened': 'src/runtime.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    outDir: 'dist',
    external: [],
    treeshake: true,
    splitting: false,
    target: 'es2022',
    minify: false,
    define: defines(),
    esbuildOptions(options) {
      applyEsbuildOptions(options);
    },
  },
  // Hardened IIFE. `treeshake` makes Rollup rewrite the IIFE wrapper into
  // `(function(exports){…})({})`, which publint correctly reads as CommonJS
  // served under an ESM `.js` extension — which is why this artifact is
  // reachable only by URL and not through the exports map. It is gated at
  // 28,000 B gzip by scripts/check-size.mjs.
  {
    entry: { 'formajs-runtime-hardened': 'src/runtime.ts' },
    format: ['iife'],
    globalName: 'FormaRuntime',
    outDir: 'dist',
    minify: false,
    treeshake: true,
    sourcemap: true,
    target: 'es2022',
    define: defines(),
    esbuildOptions(options) {
      applyEsbuildOptions(options);
    },
  },
]);
