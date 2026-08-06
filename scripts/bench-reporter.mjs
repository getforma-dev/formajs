/**
 * Custom `vitest bench` reporter that keeps the per-iteration samples.
 *
 * vitest's built-in benchmark JSON reporter hardcodes `samples: []` when it
 * serialises (`createBenchmarkJsonReport`), and tinybench's result object
 * carries p75/p99/p995/p999 but no p95. Neither gives us what a regression gate
 * needs, so this reporter reads `task.result.benchmark.samples` — populated
 * because vitest.bench.config.ts sets `benchmark.includeSamples` — and writes
 * the percentiles itself.
 *
 * Output file is chosen by the FORMA_BENCH_OUT environment variable;
 * scripts/bench.mjs sets it once per repetition.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** Percentile of an ASCENDING-sorted array, by nearest-rank. */
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(sorted.length * p);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

function median(sorted) {
  if (sorted.length === 0) return 0;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Depth-first walk of a vitest task tree, yielding benchmark leaves. */
function* benchmarks(task, trail) {
  const name = task.name ? [...trail, task.name] : trail;
  const result = task.meta?.benchmark ? task.result?.benchmark : undefined;
  if (result) {
    yield { path: name, result };
    return;
  }
  for (const child of task.tasks ?? []) yield* benchmarks(child, name);
}

export default class BenchSamplesReporter {
  onInit(ctx) {
    this.ctx = ctx;
  }

  onTestRunEnd(testModules) {
    const target = process.env.FORMA_BENCH_OUT;
    if (!target) return;

    const entries = [];
    for (const mod of testModules) {
      const file = mod.task?.file ?? mod.task ?? mod;
      const filepath = (file.filepath ?? mod.moduleId ?? '').replace(/\\/g, '/');
      const short = filepath.slice(filepath.lastIndexOf('/bench/') + 1) || filepath;
      for (const { path, result } of benchmarks(file, [])) {
        // `samples` arrives already sorted ascending (tinybench sorts before it
        // derives its own percentiles); sort defensively anyway — a reporter
        // that silently reported percentiles off an unsorted array would be the
        // exact class of quiet wrongness this suite exists to catch.
        const samples = [...(result.samples ?? [])].sort((x, y) => x - y);
        entries.push({
          file: short,
          group: path.slice(0, -1).join(' > '),
          name: path[path.length - 1],
          sampleCount: samples.length || result.sampleCount || 0,
          // All timings in milliseconds, as tinybench reports them.
          min: samples.length ? samples[0] : result.min,
          median: samples.length ? median(samples) : result.median,
          p95: samples.length ? percentile(samples, 0.95) : result.p99,
          p99: samples.length ? percentile(samples, 0.99) : result.p99,
          max: samples.length ? samples[samples.length - 1] : result.max,
          mean: result.mean,
          rme: result.rme,
          hasSamples: samples.length > 0,
        });
      }
    }

    const out = resolve(target);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ entries }, null, 2), 'utf8');
  }
}
