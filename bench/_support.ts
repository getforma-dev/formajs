/**
 * Shared fixtures and measurement policy for the hot-path benchmark suite.
 *
 * Two constraints shape everything in this directory:
 *
 * 1. `vitest bench` builds its tinybench Task with no per-iteration hooks
 *    (see vitest's runBenchmarkSuite: `new Task(bench, name, fn)` — no
 *    FnOptions), so there is no un-measured `beforeEach`. Every stateful
 *    benchmark is therefore written as a CYCLE: the state at the end of an
 *    iteration equals the state at the start, so iteration N costs the same as
 *    iteration 1. Where a cycle necessarily measures two directions at once
 *    (append + trim), the benchmark name says both, and a companion
 *    "…(control)" benchmark measures the half we want to subtract.
 *
 * 2. Nothing here may leave garbage in `document`. A benchmark that appends to
 *    document.body accumulates thousands of detached-but-referenced subtrees
 *    over a run and measures its own leak. Fixtures build into a DETACHED
 *    container wherever the API under test allows it, and the few that cannot
 *    (the directive runtime scans `document`) clean up inside the cycle.
 */

// ---------------------------------------------------------------------------
// Measurement policy
// ---------------------------------------------------------------------------

/**
 * The subset of tinybench's `Options` these presets set. Declared structurally
 * rather than imported: tinybench reaches this repo only as a transitive
 * dependency of vitest, and a benchmark suite should not be the thing that
 * pins its version.
 */
export interface BenchPreset {
  time: number;
  iterations: number;
  warmupTime: number;
  warmupIterations: number;
}

/**
 * tinybench samples until BOTH `time` ms have elapsed and `iterations` samples
 * exist. Setting `time: 0` therefore makes the sample count EXACT rather than a
 * function of how fast the machine is — which is what makes p95 and the
 * run-to-run spread comparable across runs and across machines. (Verified
 * against the installed tinybench: `while (totalTime < time || samples.length <
 * iterations)`.)
 *
 * The other half of the policy is on the benchmark side: every `bench()` body
 * is sized to run for roughly 0.1–5 ms, by repeating sub-microsecond operations
 * a fixed number of times. Timing a 60 ns operation one call at a time measures
 * `performance.now()`; timing 1000 of them measures the operation. Benchmarks
 * that do this name the repeat count as `(×N)` — scripts/bench.mjs parses that
 * suffix to derive a per-operation column.
 */

/** Sub-microsecond operations: guards, single attribute writes, one flush. */
export const MICRO: BenchPreset = {
  time: 0,
  iterations: 600,
  warmupTime: 0,
  warmupIterations: 150,
};

/** Millisecond-scale operations: a few hundred DOM nodes, one reconciliation. */
export const MACRO: BenchPreset = {
  time: 0,
  iterations: 200,
  warmupTime: 0,
  warmupIterations: 30,
};

/** Tens-of-milliseconds operations: 10k-row renders, whole-page adoption. */
export const HEAVY: BenchPreset = {
  time: 0,
  iterations: 60,
  warmupTime: 0,
  warmupIterations: 8,
};

// ---------------------------------------------------------------------------
// Data fixtures
// ---------------------------------------------------------------------------

export interface Row {
  id: number;
  label: string;
  done: boolean;
}

/** `n` rows with stable ids starting at `from` — the keyed-list workload. */
export function makeRows(n: number, from = 0): Row[] {
  const rows = new Array<Row>(n);
  for (let i = 0; i < n; i++) {
    const id = from + i;
    rows[i] = { id, label: `row ${id}`, done: (id & 3) === 0 };
  }
  return rows;
}

/**
 * A deterministic permutation of `n` indices with a long orbit.
 *
 * Applying it repeatedly to the same array keeps producing a genuinely
 * scrambled order (so every step is a full worst-case reconciliation) while
 * staying reproducible run to run — a `Math.random()` shuffle would make the
 * run-to-run spread column measure the RNG instead of the code.
 */
export function permutation(n: number): number[] {
  const out = new Array<number>(n);
  // A stride coprime with n visits every index exactly once.
  let stride = Math.max(2, Math.floor(n * 0.618));
  while (gcd(stride, n) !== 1) stride++;
  for (let i = 0; i < n; i++) out[i] = (i * stride) % n;
  return out;
}

function gcd(a: number, b: number): number {
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

/** Reorder `items` by `perm` (`out[i] = items[perm[i]]`). */
export function applyPermutation<T>(items: T[], perm: number[]): T[] {
  const out = new Array<T>(items.length);
  for (let i = 0; i < items.length; i++) out[i] = items[perm[i]!]!;
  return out;
}

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

/**
 * A detached container. Detached is deliberate: `createList`, `h()` and
 * `adoptNode` all work against any parent node, and keeping the fixture out of
 * `document` means an iteration that forgets to clean up cannot slow every
 * later iteration down (or change what `document.querySelectorAll` sees).
 */
export function detachedContainer(html?: string): HTMLElement {
  const el = document.createElement('div');
  if (html !== undefined) el.innerHTML = html;
  return el;
}

/** Attach to `document.body`; the caller must remove it inside the same cycle. */
export function attachedContainer(html?: string): HTMLElement {
  const el = detachedContainer(html);
  document.body.appendChild(el);
  return el;
}
