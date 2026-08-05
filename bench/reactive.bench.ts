/**
 * Signal write → effect flush.
 *
 * The thesis under test is "fine-grained surgical updates": a write should cost
 * work proportional to what actually depends on it, and nothing else. These
 * benchmarks price the four shapes that show up in real trees — a deep derived
 * chain, a wide fan-out, a burst of writes with and without `batch()`, and a
 * write that changes nothing.
 *
 * The hardening lane changed `internalEffect` (src/reactive/effect.ts): every
 * run after the first is now wrapped in try/catch behind a `firstRun` flag, so
 * one broken DOM binding can no longer abort the flush for every other island
 * subscribed to the same signal. `internalEffect` drives EVERY DOM binding in
 * the library, so that wrapper sits on the hottest path there is. The
 * "alien-signals rawEffect (pre-hardening shape)" pairs below are the
 * counterfactual: identical work, identical fan-out, no isolation.
 */

import { bench, describe } from 'vitest';
import { effect as rawEffect } from 'alien-signals';
import {
  createSignal,
  createEffect,
  createComputed,
  internalEffect,
  batch,
  createRoot,
} from 'forma/reactive';
import { MICRO } from './_support';

// ---------------------------------------------------------------------------
// Deep chains — signal → computed × depth → effect
// ---------------------------------------------------------------------------

function deepChain(depth: number): (n: number) => void {
  const [source, setSource] = createSignal(0);
  let node: () => number = source;
  for (let i = 0; i < depth; i++) {
    const prev = node;
    node = createComputed(() => prev() + 1);
  }
  let observed = 0;
  const tail = node;
  createEffect(() => { observed = tail(); });
  return (n: number) => { setSource(n); if (observed === -1) throw new Error('unreachable'); };
}

describe('signal write → effect flush: deep chain', () => {
  const WRITES = 500;
  for (const depth of [1, 10, 50]) {
    const write = createRoot(() => deepChain(depth));
    let n = 0;
    bench(
      `computed depth ${depth}: write → re-derive → effect (×${WRITES})`,
      () => { for (let i = 0; i < WRITES; i++) write(++n); },
      MICRO,
    );
  }
});

// ---------------------------------------------------------------------------
// Wide fan-out — one signal → N independent effects
// ---------------------------------------------------------------------------

function fanOut(width: number): (n: number) => void {
  const [source, setSource] = createSignal(0);
  let sink = 0;
  for (let i = 0; i < width; i++) {
    createEffect(() => { sink += source(); });
  }
  return (n: number) => { setSource(n); if (sink === -1) throw new Error('unreachable'); };
}

describe('signal write → effect flush: wide fan-out', () => {
  // Repeat counts chosen so every case does comparable wall-clock work per
  // sample: 10 effects × 500 writes ≈ 1000 effects × 5 writes ≈ 5000 re-runs.
  for (const [width, writes] of [[10, 500], [100, 50], [1000, 5]] as const) {
    const write = createRoot(() => fanOut(width));
    let n = 0;
    bench(
      `${width} effects on one signal: write (×${writes})`,
      () => { for (let i = 0; i < writes; i++) write(++n); },
      MICRO,
    );
  }
});

// ---------------------------------------------------------------------------
// Batched vs unbatched — the same writes, two ways
// ---------------------------------------------------------------------------

function independentSignals(count: number): Array<(n: number) => void> {
  const setters: Array<(n: number) => void> = [];
  let sink = 0;
  for (let i = 0; i < count; i++) {
    const [get, set] = createSignal(0);
    createEffect(() => { sink += get(); });
    setters.push(set);
  }
  if (sink === -1) throw new Error('unreachable');
  return setters;
}

describe('signal write → effect flush: batching', () => {
  const SIGNALS = 100;
  const ROUNDS = 30;

  const unbatched = createRoot(() => independentSignals(SIGNALS));
  let a = 0;
  bench(`${SIGNALS} signals, one write each, unbatched (×${ROUNDS})`, () => {
    for (let r = 0; r < ROUNDS; r++) {
      a++;
      for (let i = 0; i < SIGNALS; i++) unbatched[i]!(a + i);
    }
  }, MICRO);

  const batched = createRoot(() => independentSignals(SIGNALS));
  let b = 0;
  bench(`${SIGNALS} signals, one write each, batched (×${ROUNDS})`, () => {
    for (let r = 0; r < ROUNDS; r++) {
      b++;
      batch(() => {
        for (let i = 0; i < SIGNALS; i++) batched[i]!(b + i);
      });
    }
  }, MICRO);

  // One signal written 100 times: batching should collapse this to a single
  // flush, so this pair is where `batch()` has the most to prove.
  const hot = createRoot(() => {
    const [get, set] = createSignal(0);
    let sink = 0;
    createEffect(() => { sink += get(); });
    return { set, live: () => sink !== -1 };
  });

  let c = 0;
  bench(`one signal, ${SIGNALS} writes, unbatched (×${ROUNDS})`, () => {
    for (let r = 0; r < ROUNDS; r++) {
      c++;
      for (let i = 0; i < SIGNALS; i++) hot.set(c * SIGNALS + i);
    }
    if (!hot.live()) throw new Error('unreachable');
  }, MICRO);

  let d = 0;
  bench(`one signal, ${SIGNALS} writes, batched (×${ROUNDS})`, () => {
    for (let r = 0; r < ROUNDS; r++) {
      d++;
      batch(() => {
        for (let i = 0; i < SIGNALS; i++) hot.set(d * SIGNALS + i);
      });
    }
    if (!hot.live()) throw new Error('unreachable');
  }, MICRO);
});

// ---------------------------------------------------------------------------
// Equal-value no-op — the write that must cost nothing downstream
// ---------------------------------------------------------------------------

describe('signal write → effect flush: equal-value no-op', () => {
  const WRITES = 20_000;

  // The written value comes out of an array rather than being a literal: a
  // literal 42 in the loop body lets the optimiser hoist the whole call, and the
  // benchmark then measures nothing at all (its run-to-run spread was 276%).
  const SAME_VALUES = new Array<number>(1024).fill(42);

  const noop = createRoot(() => {
    const [get, set] = createSignal(42);
    let runs = 0;
    createEffect(() => { get(); runs++; });
    return { set, runs: () => runs };
  });
  bench(`write the SAME value, no effect runs (×${WRITES})`, () => {
    for (let i = 0; i < WRITES; i++) noop.set(SAME_VALUES[i & 1023]!);
  }, MICRO);

  // Reference point: the identical loop with a value that does change, so the
  // saving from the identity check is readable rather than asserted. Fewer
  // repeats because each one actually schedules and drains a flush.
  const CHANGING = 500;
  const changing = createRoot(() => {
    const [get, set] = createSignal(0);
    createEffect(() => { get(); });
    return set;
  });
  let n = 0;
  bench(`write a CHANGING value, effect runs (×${CHANGING})`, () => {
    for (let i = 0; i < CHANGING; i++) changing(++n);
  }, MICRO);

  // A custom `equals` takes the slow path in applySignalSet: it reads the
  // previous value untracked before deciding. This prices that extra read.
  const withEquals = createRoot(() => {
    const [get, set] = createSignal({ x: 0 }, { equals: (a, b) => a.x === b.x });
    createEffect(() => { get(); });
    return set;
  });
  const SAME_OBJECTS = new Array<{ x: number }>(1024).fill({ x: 7 });
  bench(`write suppressed by a custom equals (×${WRITES})`, () => {
    for (let i = 0; i < WRITES; i++) withEquals(SAME_OBJECTS[i & 1023]!);
  }, MICRO);
});

// ---------------------------------------------------------------------------
// internalEffect: what the flush-isolation wrapper costs
// ---------------------------------------------------------------------------

/**
 * `internalEffect` is the effect every DOM binding uses. The hardening lane
 * added a `firstRun` flag plus a try/catch around every later run so a throwing
 * binding cannot abort the flush for unrelated islands. These pairs isolate the
 * cost of that wrapper: same signal, same body, same fan-out — the only
 * difference is the isolation.
 */
describe('internalEffect: flush-isolation overhead', () => {
  for (const [width, writes] of [[1, 5000], [100, 50]] as const) {
    const hardened = createRoot(() => {
      const [get, set] = createSignal(0);
      let sink = 0;
      for (let i = 0; i < width; i++) internalEffect(() => { sink += get(); });
      return { set, live: () => sink !== -1 };
    });
    let n = 0;
    bench(
      `${width} internalEffect binding(s), as shipped: write (×${writes})`,
      () => {
        for (let i = 0; i < writes; i++) hardened.set(++n);
        if (!hardened.live()) throw new Error('unreachable');
      },
      MICRO,
    );

    const bare = createRoot(() => {
      const [get, set] = createSignal(0);
      let sink = 0;
      for (let i = 0; i < width; i++) rawEffect(() => { sink += get(); });
      return { set, live: () => sink !== -1 };
    });
    let m = 0;
    bench(
      `${width} rawEffect binding(s), pre-hardening shape: write (×${writes})`,
      () => {
        for (let i = 0; i < writes; i++) bare.set(++m);
        if (!bare.live()) throw new Error('unreachable');
      },
      MICRO,
    );
  }
});

// ---------------------------------------------------------------------------
// Effect creation
// ---------------------------------------------------------------------------

describe('effect creation', () => {
  const [get] = createSignal(1);
  const EFFECTS = 500;

  bench(`createEffect + dispose (×${EFFECTS})`, () => {
    createRoot((dispose) => {
      for (let i = 0; i < EFFECTS; i++) createEffect(() => { get(); });
      dispose();
    });
  }, MICRO);

  bench(`internalEffect + dispose, the DOM-binding path (×${EFFECTS})`, () => {
    createRoot((dispose) => {
      for (let i = 0; i < EFFECTS; i++) internalEffect(() => { get(); });
      dispose();
    });
  }, MICRO);
});
