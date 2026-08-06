/**
 * `longestIncreasingSubsequence` is the whole reason keyed reconciliation moves
 * O(n − |LIS|) nodes instead of all of them, and its docstring asserts
 * "O(n log n) time, O(n) space". It had no test of its own: every existing list
 * test exercises it through reconcileList, where a wrong-but-plausible LIS just
 * looks like extra DOM moves and nothing fails.
 */
import { describe, expect, it } from 'vitest';
import { longestIncreasingSubsequence as lis } from '../list';

/** Textbook O(n²) DP — slow, obviously correct, used only as the oracle. */
function lisLengthByDp(arr: number[]): number {
  if (arr.length === 0) return 0;
  const best = new Array<number>(arr.length).fill(1);
  for (let i = 1; i < arr.length; i++) {
    for (let j = 0; j < i; j++) {
      if (arr[j]! < arr[i]! && best[j]! + 1 > best[i]!) best[i] = best[j]! + 1;
    }
  }
  return Math.max(...best);
}

/** Assert `indices` really is an increasing subsequence of `arr`. */
function expectValidSubsequence(arr: number[], indices: number[]): void {
  for (let i = 1; i < indices.length; i++) {
    expect(indices[i]!, `indices must ascend: ${indices}`).toBeGreaterThan(indices[i - 1]!);
    expect(arr[indices[i]!]!, `values must ascend: ${indices.map((k) => arr[k])}`)
      .toBeGreaterThan(arr[indices[i - 1]!]!);
  }
}

describe('longestIncreasingSubsequence', () => {
  it('returns an empty result for an empty input', () => {
    expect(lis([])).toEqual([]);
  });

  it('returns the single index for a one-element input', () => {
    expect(lis([7])).toEqual([0]);
  });

  it('returns every index for an already-increasing sequence', () => {
    expect(lis([0, 1, 2, 3, 4])).toEqual([0, 1, 2, 3, 4]);
  });

  it('returns exactly one index for a strictly decreasing sequence', () => {
    const result = lis([5, 4, 3, 2, 1]);
    expect(result).toHaveLength(1);
    expectValidSubsequence([5, 4, 3, 2, 1], result);
  });

  it('finds a known optimal subsequence', () => {
    const arr = [10, 9, 2, 5, 3, 7, 101, 18];
    const result = lis(arr);
    expect(result).toHaveLength(4); // 2, 3, 7, 18 / 2, 3, 7, 101
    expectValidSubsequence(arr, result);
  });

  it('handles the reconciler shapes: a single move, and a reversal', () => {
    // One item moved to the front — everything else should stay put.
    const moved = [4, 0, 1, 2, 3];
    expect(lis(moved)).toEqual([1, 2, 3, 4]);
    // Full reversal — nothing can stay, so any single index is optimal.
    expect(lis([3, 2, 1, 0])).toHaveLength(1);
  });

  it('agrees with a brute-force LIS on random inputs', () => {
    // Deterministic PRNG so a failure is reproducible.
    let seed = 0x2f6e2b1;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (let trial = 0; trial < 200; trial++) {
      const n = 1 + (rand() % 60);
      const arr = Array.from({ length: n }, () => rand() % 40);
      const result = lis(arr);
      expectValidSubsequence(arr, result);
      expect(result.length, `arr=${arr}`).toBe(lisLengthByDp(arr));
    }
  });

  it('runs in O(n log n), not O(n²)', () => {
    // 200k elements is ~3.5M comparisons for patience sorting and ~2e10 for the
    // quadratic DP above — minutes rather than milliseconds. The margin is four
    // orders of magnitude, so this gate is decisive without being timing-flaky.
    const n = 200_000;
    const arr = new Array<number>(n);
    let seed = 0x51f3a7;
    for (let i = 0; i < n; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      arr[i] = seed % n;
    }

    const started = performance.now();
    const result = lis(arr);
    const elapsed = performance.now() - started;

    expectValidSubsequence(arr, result);
    expect(result.length).toBeGreaterThan(100);
    expect(elapsed, `${n} elements took ${elapsed.toFixed(0)}ms`).toBeLessThan(2000);
  });
});
