import { defineConfig } from 'tsup';

const formaAlias = { 'forma': './src' };

export default defineConfig([
  // ESM + CJS + type declarations — tree-shakeable imports (production)
  {
    entry: {
      index: 'src/index.ts',
      runtime: 'src/runtime.ts',
      'tc39-compat': 'src/reactive/tc39-compat.ts',
      'ssr/index': 'src/ssr/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    outDir: 'dist',
    external: [],
    treeshake: true,
    splitting: true,
    target: 'es2022',
    minify: false,
    define: {
      '__DEV__': 'false',
      '__FORMA_UNSAFE_EVAL_MODE__': '"mutable"',
    },
    esbuildOptions(options) {
      options.alias = formaAlias;
      // Enable pure annotations for tree-shaking
      // createEffect is NOT pure — it registers reactive subscriptions as side effects
      options.pure = ['createSignal', 'createComputed', 'createStore', 'createBus'];
    },
  },
  // IIFE global build — for <script src="formajs.min.js"> usage
  {
    entry: { formajs: 'src/index.ts' },
    format: ['iife'],
    globalName: 'FormaJS',
    outDir: 'dist',
    minify: true,
    sourcemap: true,
    target: 'es2022',
    define: {
      '__DEV__': 'false',
      '__FORMA_UNSAFE_EVAL_MODE__': '"mutable"',
    },
    esbuildOptions(options) {
      options.alias = formaAlias;
    },
  },
  // IIFE runtime build — for <script src="formajs.runtime.min.js"> (HTML API)
  {
    entry: { 'formajs-runtime': 'src/runtime.ts' },
    format: ['iife'],
    globalName: 'FormaRuntime',
    outDir: 'dist',
    minify: true,
    sourcemap: true,
    target: 'es2022',
    define: {
      '__DEV__': 'false',
      '__FORMA_UNSAFE_EVAL_MODE__': '"mutable"',
    },
    esbuildOptions(options) {
      options.alias = formaAlias;
    },
  },
  // Hardened runtime (unsafe-eval locked off, non-toggleable at runtime)
  {
    entry: { 'runtime-hardened': 'src/runtime.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: false,
    outDir: 'dist',
    external: [],
    treeshake: true,
    splitting: false,
    target: 'es2022',
    minify: false,
    define: {
      '__DEV__': 'false',
      '__FORMA_UNSAFE_EVAL_MODE__': '"locked-off"',
    },
    esbuildOptions(options) {
      options.alias = formaAlias;
    },
  },
  {
    entry: { 'formajs-runtime-hardened': 'src/runtime.ts' },
    format: ['iife'],
    globalName: 'FormaRuntime',
    outDir: 'dist',
    minify: true,
    sourcemap: true,
    target: 'es2022',
    define: {
      '__DEV__': 'false',
      '__FORMA_UNSAFE_EVAL_MODE__': '"locked-off"',
    },
    esbuildOptions(options) {
      options.alias = formaAlias;
    },
  },
]);
