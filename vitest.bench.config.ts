import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import BenchSamplesReporter from './scripts/bench-reporter.mjs';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));
const srcDirWithSlash = `${srcDir}/`;

/**
 * Benchmark config — deliberately separate from vitest.config.ts.
 *
 * `vitest bench` and `vitest run` disagree on almost every setting that
 * matters here: benchmarks must not share a CPU with anything, must not be
 * sharded across workers, and must keep their raw per-iteration samples so
 * scripts/bench.mjs can compute median/p95 rather than trusting a mean.
 *
 * Environment note: happy-dom, not a browser. Every DOM figure this suite
 * produces is a happy-dom figure — useful as a *relative* signal (the
 * JavaScript Forma runs before it touches the DOM is the same either way) and
 * useless as an absolute one. docs/PERFORMANCE.md says so on its first screen.
 */
/**
 * Benchmarks must measure the configuration users actually run.
 *
 * Under plain vitest, `process.env.NODE_ENV` is "test", so src/reactive/dev.ts
 * resolves `__DEV__` to TRUE and every dev-only branch executes — the duplicate-
 * key Set `createList` builds on each reconcile, the `isRawHtmlAttr` lookup on
 * each attribute write, the hydration mismatch warnings. None of that exists in
 * any published artifact: tsup defines `__FORMA_DEV_BUILD__` as `false` and
 * esbuild folds those branches away. Defining it here does the same thing, so
 * the numbers describe dist rather than a debug build.
 *
 * Set FORMA_BENCH_DEV=1 to measure the dev-mode cost instead.
 */
const devBuild = process.env.FORMA_BENCH_DEV === '1';

export default defineConfig({
  define: {
    __FORMA_DEV_BUILD__: String(devBuild),
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    // Benchmarks measure wall-clock. Parallel files would measure contention.
    // `fileParallelism: false` already forces maxWorkers to 1; it is stated
    // explicitly so the intent survives a future default change.
    fileParallelism: false,
    maxWorkers: 1,
    benchmark: {
      include: ['bench/**/*.bench.ts'],
      // Raw samples are what make median/p95/spread computable; vitest drops
      // them by default and reports a mean, which a single GC pause ruins.
      includeSamples: true,
      // 'default' prints the live table; the custom reporter is the only way to
      // get raw samples out — vitest's own JSON reporter hardcodes `samples: []`.
      reporters: ['default', new BenchSamplesReporter()],
    },
  },
  esbuild: {
    jsx: 'transform',
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
  },
  resolve: {
    alias: [
      { find: /^forma\/(.*)$/, replacement: `${srcDirWithSlash}$1` },
      { find: 'forma', replacement: srcDir },
    ],
  },
});
