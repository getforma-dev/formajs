import { defineConfig } from 'tsup';
import {
  EVAL_MODE_FLAG,
  FORMA_ALIAS,
  PROD_DEFINE,
} from './scripts/build-defines.mjs';

const formaAlias = { ...FORMA_ALIAS };

/**
 * Every shipped artifact is built with `__FORMA_DEV_BUILD__` replaced by the
 * literal `false` (PROD_DEFINE), which is what makes `__DEV__` a build-time
 * constant instead of a runtime NODE_ENV read. `EVAL_MODE_FLAG` selects the
 * unsafe-eval posture of the runtime builds.
 *
 * Verified by: src/reactive/__tests__/dev-flag.test.ts > "resolves __DEV__ at build time and drops the NODE_ENV fallback"
 */
function defines(evalMode: 'mutable' | 'locked-off') {
  return { ...PROD_DEFINE, [EVAL_MODE_FLAG]: JSON.stringify(evalMode) };
}

/**
 * Syntax-level minification ONLY (`minifyWhitespace`/`minifyIdentifiers` stay
 * off, so output keeps its line structure and real identifier names — minified
 * single-line files trigger false-positive "obfuscated code" flags in supply
 * chain scanners such as Socket.dev and Snyk).
 *
 * This is what makes the build-time flags real rather than decorative: esbuild
 * only inlines a `const` bound to a folded literal into its use sites when
 * syntax minification is on. Without it, `__DEV__` and `__EVAL_CAPABLE__` are
 * constants nothing reads at build time, so `if (__DEV__) console.warn(…)` and
 * the `new Function` fallback both survive — rebuilding with this off puts
 * `new Function(` back into dist/runtime-hardened.js.
 *
 * It is necessary but not sufficient for the hardened build: esbuild inlines
 * the constant and drops the taken branch, and tsup's `treeshake` (Rollup) pass
 * then removes what became unreachable after it. Both stages are required,
 * which is why the hardened configs below keep `treeshake: true`.
 *
 * Inlining also stops at chunk boundaries, so the code-split entries keep some
 * unreachable `__DEV__ && …` calls. See src/reactive/dev.ts for what that does
 * and does not guarantee.
 *
 * Verified by: src/__tests__/build-artifacts.test.ts > "hardened builds emit no new Function at all"
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
    define: defines('mutable'),
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
    define: defines('mutable'),
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
    define: defines('mutable'),
    esbuildOptions(options) {
      applyEsbuildOptions(options);
    },
  },
  // Hardened runtime (unsafe-eval locked off, non-toggleable at runtime).
  // The `locked-off` define plus syntax minification plus the `treeshake`
  // (Rollup) pass together remove the eval branch, so `new Function` is absent
  // from the emitted bytes rather than merely unreachable — which is what keeps
  // Socket.dev static analysis quiet. Dropping `treeshake` here leaves the call
  // in the file: esbuild alone does not finish the job.
  //
  // Verified by: src/__tests__/build-artifacts.test.ts > "hardened builds emit no new Function at all"
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
    define: defines('locked-off'),
    esbuildOptions(options) {
      applyEsbuildOptions(options);
    },
  },
  // Hardened IIFE. Same requirement as above: without `treeshake` the eval
  // call stays in the file. The cost is that Rollup rewrites the IIFE wrapper
  // into `(function(exports){…})({})`, which publint correctly reads as
  // CommonJS served under an ESM `.js` extension — one more reason this
  // artifact is reachable only by URL and not through the exports map.
  {
    entry: { 'formajs-runtime-hardened': 'src/runtime.ts' },
    format: ['iife'],
    globalName: 'FormaRuntime',
    outDir: 'dist',
    minify: false,
    treeshake: true,
    sourcemap: true,
    target: 'es2022',
    define: defines('locked-off'),
    esbuildOptions(options) {
      applyEsbuildOptions(options);
    },
  },
]);
