# Performance

The product thesis is fine-grained surgical updates and small fast bundles. The
bundle half is gated in CI by `scripts/check-size.mjs`. This document is the
other half: a re-runnable benchmark suite over the hot paths, and the numbers it
produced against the hardened tree.

It exists because the August 2026 hardening pass put a scheme check and an
event-handler filter on every generic attribute write, changed effect-flush
error isolation, added disposal work to hydrated list rows, hardened marker
parsing, and made the CSP-safe interpreter the default expression engine — and
nobody had measured whether any of it cost anything. Two of those changes turned
out to cost a great deal. See [What the hardening cost](#what-the-hardening-cost).

## Running it

```bash
npm run bench                 # 3 runs, table on stdout
npm run bench -- --runs 7     # tighter noise floor
npm run bench -- --file list  # just bench/list.bench.ts
npm run bench:doc             # 5 runs; rewrites the table in this file
npm run bench:compare         # 5 runs vs the committed docs/performance-baseline.json
```

The suite is `vitest bench` (tinybench underneath) over `bench/*.bench.ts`,
driven by `scripts/bench.mjs`, which runs the whole suite several times in
separate processes and aggregates. `docs/performance-baseline.json` is the
committed machine-readable copy of the table below; `npm run bench:compare`
diffs against it.

**It is deliberately not a CI gate.** Shared runners have a noise floor far
wider than most of the regressions worth catching — several rows here move 50%
between runs on a quiet desktop — so a threshold loose enough not to flake would
be loose enough to miss everything. It is a tool you point at a change you
suspect, on one machine, before and after. The committed baseline is what makes
"before" available without re-running the old code.

## How to read the numbers

| column | meaning |
| --- | --- |
| **median** | median of each run's median. One bad run cannot move it. |
| **p95** | the worst p95 across runs — the tail a user actually feels. |
| **per op** | median ÷ the `(×N)` repeat count in the benchmark's name, where it has one. |
| **run-to-run spread** | `(max run median − min run median) ÷ min`. **This is the noise floor.** |

**A difference is only real when it exceeds the spread.** Some rows here have a
spread of 2% and some have a spread of 50%; a 10% change means opposite things
in those two rows. The allocation-heavy `h()` benchmarks (500 fresh elements per
iteration) are the noisy ones — garbage collection lands wherever it lands — so
the per-call cost of the attribute guards is taken from the microbenchmarks that
call them directly, not from those rows.

`p95` is several times the median for the allocation-heavy benchmarks, for the
same reason. That is a real property of the workload, not a measurement artifact.

## What this environment is, and is not

- **happy-dom, not a browser.** Every DOM figure is a happy-dom figure. Use them
  as *relative* signals — the JavaScript Forma runs before it touches the DOM is
  the same either way — never as absolute ones. In particular happy-dom parses
  HTML in JavaScript, so "parse the SSR markup" costs roughly what "build the
  tree with `h()`" costs, which is nothing like a browser, where parsing is
  native. Wherever adoption is compared against client-side rendering below, the
  parse is subtracted for exactly that reason.
- **Dev diagnostics are OFF.** `vitest.bench.config.ts` defines
  `__FORMA_DEV_BUILD__` to `false`, so `__DEV__` folds away exactly as it does in
  `npm run build` output. Without it the suite measures a debug build, and the
  difference is not small: `createList` walks every item into a duplicate-key
  `Set` on every reconcile under `__DEV__`, which took the 1000-row same-keys
  fast path from 97 µs to 126 µs — **30%** — on the same tree with only that flag
  changed. Set `FORMA_BENCH_DEV=1` to measure the debug build deliberately.
- **One worker, no file parallelism.** Benchmarks that share a CPU measure
  contention.
- **Fixed sample counts.** Every preset sets tinybench's `time: 0`, so the sample
  count is exact rather than a function of how fast the machine is. That is what
  makes p95 and spread comparable across runs and machines.
- **Fixtures are asserted before they are timed.** Several `describe` bodies
  prove the thing under test actually happened — that adoption reused the SSR
  node rather than replacing it, that island props arrived through both
  channels, that every expression in the engine comparison re-runs and
  re-renders on a write. Four bugs in this suite's own history each made a
  subject look *faster* than its own control: a reactive binding that never read
  its signal, islands activating with `null` props, expressions that did not
  depend on the signal being written, and expressions whose value never changed
  so the text sink skipped the write. The assertions are what stop the fifth.

## What the hardening cost

Method: `git archive` of the pre-hardening commit (`17f8783`) and of the
hardening commit (`8dc2c1e`) into two snapshots, the identical benchmark suite
copied into both, dev diagnostics off in both, three runs each. Nothing in the
working tree was touched. A row counts as a regression only when the change
exceeds the larger of the two trees' spreads.

### 1. List row removal — 4 µs → 23 µs per removed row

`removeRow` → `deactivateIslandsIn` (`src/dom/list.ts`) now runs
`row.querySelectorAll('[data-forma-island]')` on **every departing row**, plus an
`instanceof` and a `hasAttribute`. That is a full subtree scan per removal, in
the one place the reconciler previously did a single `parent.removeChild`.

| benchmark | before | after | change |
| --- | ---: | ---: | ---: |
| 1000 plain rows: build + reconcileList removes all | 7.343 ms | 22.467 ms | **+206%** |
| 1000 6-node rows: build + reconcileList removes all | 44.902 ms | 64.485 ms | **+43.6%** |
| append 100 + trim back to 1000 (round trip) | 943.6 µs | 2.560 ms | **+171%** |
| prepend 100 + trim back to 1000 (round trip) | 997.2 µs | 2.582 ms | **+159%** |
| remove first 100 + restore (round trip) | 936.8 µs | 2.548 ms | **+172%** |
| 1000 rows → [] → 1000 rows (drain + refill) | 10.700 ms | 28.583 ms | **+167%** |
| 1000 plain rows: build + removeChild by hand *(control)* | 7.545 ms | 7.346 ms | −2.6% |

Isolating the removal by subtracting the build-only control: a six-node row went
from **4.0 µs to 22.8 µs** — the guard adds ~18.8 µs per removed row and scales
with the row's *subtree*, not with the row count. A flat `<li>` went from under
0.4 µs (too cheap to resolve against the build cost, so treat it as an upper
bound) to **15.3 µs**, which is at least a 38× increase and probably nearer 100×.
The by-hand control moving −2.6% is what makes the attribution airtight: removal
itself did not get slower, the scan is new work.

**Is it worth the safety it buys?** The safety is real — an island inside a
removed row previously kept its effects, its IntersectionObserver and its
interaction listeners alive against detached DOM for the lifetime of the page.

Verified by: `src/dom/__tests__/list-disposal.test.ts` > "deactivates an island inside a removed row"

But the price is being paid by every list on every page, and
almost none of them contain an island. **Not worth it as written.** The same
guarantee is available for an integer compare: have `activateIslands` /
`hydrateIslandRoot` maintain a count of scheduled-or-active islands and have
`deactivateIslandsIn` return immediately when it is zero. An island cannot exist
without having gone through one of those two paths, so nothing is weakened, and
a page with no islands stops paying entirely.

### 2. The URL guard runs before the identity cache — +50 ns on every no-op reactive URL write

`handleGenericAttr` (`src/dom/element.ts`) checks `isDangerousUrl` *before* it
checks whether the value it is about to write is the one already there.
`isDangerousUrl` allocates (`String.replace` over the whole value) and runs two
regexes, so a `href` binding whose value never changes pays full price on every
flush and then writes nothing.

| benchmark | before | after | change |
| --- | ---: | ---: | ---: |
| href bound to an unchanging URL: write → cache hit (×500) | 13.6 µs | 38.7 µs | **+185%** |

Per write: **27 ns → 77 ns**.

**Is it worth the safety it buys?** The safety is worth having and this cost is
not needed to get it. Moving the `cache[key] === strVal` check ahead of the guard
is safe by construction: an identical string on the same element was already
accepted by the same guard on the write that populated the cache. That is a pure
win, not a trade.

### 3. `isDangerousUrl` itself — +7 ns per call

| benchmark | before | after | change |
| --- | ---: | ---: | ---: |
| isDangerousUrl on a benign https URL (×20 000) | 45 ns/call | 52 ns/call | **+15.3%** |

The added `data:image/svg+xml` test is what distinguishes an image sink from a
document sink, so `<img src="data:image/svg+xml,…">` still renders while
`<iframe src=…>` does not. **Worth it** — 7 ns against a class of SVG-smuggling
XSS, on the only attributes that can carry one. For reference, the two name
predicates are ~12 ns each (`isEventHandlerAttr`, `isUrlAttr`), and
`handleGenericAttr` already hoists the name lookup out of the reactive closure so
it is paid once per binding rather than once per run.

### 4. SSR `renderToString` — +3.6% to +6.4%

| benchmark | before | after | change |
| --- | ---: | ---: | ---: |
| 10 cards (~3 KB) | 43.4 µs | 45.6 µs | +5.1% |
| 100 cards (~31 KB) | 419.2 µs | 443.0 µs | +5.7% |
| 1000 cards (~316 KB) | 5.434 ms | 5.718 ms | +5.2% |
| 5000 cards (~1.6 MB) | 29.451 ms | 31.332 ms | +6.4% |
| 1000 cards, none URL-bearing *(control)* | 5.312 ms | 5.503 ms | +3.6% |

`renderAttr` now runs `isEventHandlerAttr` + `isSafeAttrName` on every attribute
and `isDangerousUrl` on URL ones. The cost is flat in tree size (no algorithmic
change) and it is a per-request cost. **Worth it** — this is the boundary where
attacker-controlled prop names and values become markup, and 5% of render time is
the cheapest possible place to stop them.

### 5. Hydration adoption — +7% to +8%

| benchmark | before | after | change |
| --- | ---: | ---: | ---: |
| 100 rows: parse + adopt by data-forma-key | 730.2 µs | 781.4 µs | +7.0% |
| 1000 rows: parse + adopt by data-forma-key | 8.548 ms | 9.239 ms | +8.1% |
| 100 rows: parse markup only *(control)* | 555.7 µs | 567.2 µs | +2.1% |

Subtracting the parse, adoption of 1000 keyed rows went from 2.585 ms to
3.107 ms — **+0.5 µs per row**. The suspects are the stricter `markerIndex`
(every character after the kind must now be a decimal digit) and
`isUnsafeAttrWrite` on adopted reactive props. **Worth it**: the marker parser is
what stops an authored `<!--f:side note-->` from being read as a show marker and
desyncing the adoption cursor for the rest of its parent, and the attribute guard
is what stops hydration re-adding on the client exactly what the server refused
to emit. Page adoption (non-list) did not move outside its noise floor at any of
the three sizes measured.

### 6. Effect-flush isolation — ~1.3 ns per binding re-run

`internalEffect` wraps every run after the first in try/catch behind a `firstRun`
flag, so a throwing binding can no longer abort the flush for every other island
subscribed to the same signal. Measured against `alien-signals`' raw `effect` in
the same run: the wrapper costs **+3.3% before, +9.1% after** on a 100-binding
flush, i.e. ~20.0 ns → ~21.9 ns per binding re-run. The tree-to-tree delta on
that benchmark (+6.4%) is inside its 7.6% noise floor, so ~1.3 ns/re-run is the
honest figure and it comes from the within-run pairing, not the A/B.

**Worth it.** One broken binding silently freezing every island on the page is a
failure mode no application can debug; two nanoseconds is not a price.

### 7. The CSP-safe expression engine — no regression, and faster than what it replaced

Making the CSP-safe parser the default engine cost nothing measurable: expression
evaluation moved +1.3% against a 3.9% noise floor, and compilation moved −3.3%.

More usefully, the interpreter is **faster to evaluate than the `new Function`
fallback it replaced**, and slower to compile:

| | CSP-safe interpreter | `new Function` + `with` + Proxy |
| --- | ---: | ---: |
| compile, per expression | 6.20 µs | 0.39 µs |
| evaluate, per expression | **53 ns** | **126 ns** |

The eval-path evaluator is reconstructed verbatim from what `buildEvaluator`'s
fallback builds, because the shipped runtime no longer offers a way to reach it.
Both sides are measured as *subject minus an identical-plumbing control*, so the
effect machinery and the text sink cancel out. The interpreter wins on evaluation
because the eval path pays a Proxy `has`/`get` trap for every identifier the
`with` block touches; it loses on compilation because a regex-driven recursive
descent is slower than V8's parser. Break-even is about **85 updates per
expression**, after which the CSP-safe path is strictly cheaper — and it is the
one that does not require `unsafe-eval` in the page's CSP.

## What the numbers say about the thesis

Figures in this section come from the table below (the hardened working tree,
5 runs), and every claim here is checked against that table's spread column
before it is made.

**Fine-grained updates really are fine-grained.** A write of an equal value
never leaves the setter and runs no effect: ~1 ns against **72 ns** for a write
that does change. That row's run-to-run spread is 143%, the worst in the suite,
so read it as "one to two orders of magnitude cheaper", not as a measurement — a
custom `equals` that suppresses the same write is stable at **1.8 ns**, and tells
the same story. On the list side, an update that changes no keys and no order
(the "one field changed" render) reconciles 1000 rows in **97 µs**, **27×**
cheaper than the same 1000 rows reordered.

**`batch()` earns its keep exactly where it should, and nowhere else.** 100
writes to ONE signal collapse from 237 µs to 19 µs — **12×**. 100 writes to 100
*different* signals do not move at all (282 µs vs 270 µs, against a 7% noise
floor), which is the correct result: there is one flush per signal either way.
`batch()` is a tool for repeated writes to the same signal, not a general speed
switch.

**Keyed reconciliation is cheap; building rows is what costs.** A full 1000-row
reorder costs **2.6 ms** — LIS-minimal moves, no diffing — while the unchanged
case costs 97 µs. Initial render: 100 rows 497 µs, 1000 rows 8.78 ms, 10 000 rows
177 ms. That last step is superlinear where it should not be: `h()` +
`appendChild` by hand over the same rows costs 7.25 ms and 68.9 ms, i.e. exactly
10× for 10× the rows, so `createList` goes from 1.2× the hand-built floor at 1000
rows to **2.6× at 10 000**. Something in the per-row bookkeeping (a root and an
index signal per row, plus the cache rebuild) is not scaling with the reconciler.
Worth a look; it is not caused by the hardening (the same ratio holds on the
pre-hardening tree).

**Adopting server-rendered DOM beats building it.** With the HTML parse
subtracted from both sides (see the happy-dom caveat above), adopting 1000 keyed
SSR rows costs **3.06 ms** against **7.23 ms** to build the same list client-side
— **2.4× cheaper**. For a non-list page with 480 reactive text bindings, adoption
costs **4.28 ms** against **7.07 ms** to render it client-side, **1.65×**. Both
understate the real gap: in a browser the parse the SSR path needs is native,
while the client-render path still has to build every node from JavaScript.

**Islands are cheap enough to have a lot of.** 100 islands activate in 6.6 ms
including adoption of every shell — about **66 µs per island**. The two props
channels do not separate cleanly: the shared `<script>` block is slightly cheaper
at 10 islands (472 µs vs 512 µs) and this run had it slightly dearer at 100
(7.68 ms vs 6.56 ms) while the A/B runs had them level, so pick the channel on
payload size, not on parse time.

**Server rendering is near-linear and fast.** 3 KB of HTML in 46 µs, 316 KB in
5.73 ms, 1.6 MB in 31.4 ms — 500× the tree for 680× the time. Resolving a getter
for every prop and every child costs nothing measurable (395 µs vs 400 µs, 3%
noise floor).

## Baseline

<!-- BENCH:START -->
_5 runs × 60–600 samples · node v20.16.0 · win32 x64 · fix/ksx-dogfood-findings@8dc2c1e + uncommitted changes · generated 2026-08-05 by `npm run bench:doc`_

#### bench/element.bench.ts — attribute-safety guards in isolation

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| isEventHandlerAttr on a non-event name (×20000) | 241.7 µs | 376.8 µs | 12 ns | 9.9% |
| isUrlAttr on a non-URL name (×20000) | 218.5 µs | 286.0 µs | 11 ns | 6.1% |
| isDangerousUrl on a benign https URL (×20000) | 1.026 ms | 1.112 ms | 51 ns | 3.4% |
| isDangerousUrl on an obfuscated javascript: URL (×20000) | 2.303 ms | 2.541 ms | 115 ns | 5.2% |
| isUnsafeAttrWrite on &lt;a href&gt; with a benign URL (×20000) | 1.372 ms | 1.628 ms | 69 ns | 8.6% |

#### bench/element.bench.ts — h(): reactive attribute updates

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| 3 reactive attrs incl. href: signal write → attr writes (×500) | 1.780 ms | 4.539 ms | 3.56 µs | 18.4% |
| 3 reactive attrs, none URL-bearing (control): write (×500) | 1.267 ms | 3.696 ms | 2.53 µs | 25.4% |
| href bound to an unchanging URL: write → cache hit (×500) | 37.9 µs | 41.3 µs | 76 ns | 5.1% |

#### bench/element.bench.ts — h(): realistic component subtree

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| card subtree: 6 elements, 11 attrs, 1 href, 2 handlers (×200) | 10.591 ms | 16.067 ms | 52.96 µs | 6.7% |

#### bench/element.bench.ts — h(): static attribute writes

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| h('div') with 4 static non-URL attrs (×500) | 2.089 ms | 6.699 ms | 4.18 µs | 60.3% |
| document.createElement + 4 setAttribute, no library (×500) | 2.004 ms | 6.598 ms | 4.01 µs | 47.1% |
| h('div') with no props (×500) | 737.5 µs | 4.117 ms | 1.48 µs | 15.3% |

#### bench/element.bench.ts — h(): URL-bearing static attribute writes

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| h('a') with href + 3 static non-URL attrs (×500) | 2.645 ms | 10.201 ms | 5.29 µs | 54.9% |
| h('a') with the same 4 attrs, none URL-bearing (control) (×500) | 2.093 ms | 7.716 ms | 4.19 µs | 62.5% |
| h('img') with src + srcset + alt (×500) | 2.549 ms | 7.031 ms | 5.10 µs | 34.2% |

#### bench/expression.bench.ts — expression compile

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| new Function compile, unique expressions (×200) | 78.5 µs | 95.7 µs | 393 ns | 2.3% |
| CSP parser: mount unique arithmetic expressions (×40) | 601.7 µs | 3.329 ms | 15.04 µs | 6.6% |
| CSP parser: mount bare identifiers, plumbing control (×40) | 331.2 µs | 2.395 ms | 8.28 µs | 1.6% |
| CSP parser: mount every supported grammar shape (×16) | 207.9 µs | 389.0 µs | 12.99 µs | 2.9% |

#### bench/expression.bench.ts — expression evaluate: CSP-safe interpreter (shipped)

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| 8 count-dependent expressions: write → evaluate → text (×20) | 46.5 µs | 59.5 µs | 2.33 µs | 7.0% |
| 8 × bare identifier, plumbing control: write → text (×20) | 39.3 µs | 44.0 µs | 1.97 µs | 3.9% |

#### bench/expression.bench.ts — expression evaluate: new Function path (reconstructed)

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| 8 count-dependent expressions via new Function: write → evaluate → text (×20) | 85.2 µs | 96.3 µs | 4.26 µs | 3.1% |
| 8 × bare identifier via new Function, plumbing control (×20) | 65.6 µs | 70.5 µs | 3.28 µs | 2.2% |
| 8 count-dependent expressions as hand-written closures, floor (×20) | 23.3 µs | 28.9 µs | 1.17 µs | 7.2% |

#### bench/hydrate.bench.ts — hydration: adopt an SSR keyed list

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| 100 rows: parse markup only (control) | 567.1 µs | 1.039 ms | — | 2.8% |
| 100 rows: parse + adopt by data-forma-key | 770.6 µs | 1.279 ms | — | 1.5% |
| 100 rows: client-side createList, no SSR markup (comparison) | 634.3 µs | 1.114 ms | — | 3.1% |
| 1000 rows: parse markup only (control) | 6.092 ms | 6.267 ms | — | 2.0% |
| 1000 rows: parse + adopt by data-forma-key | 9.150 ms | 9.759 ms | — | 2.9% |
| 1000 rows: client-side createList, no SSR markup (comparison) | 7.231 ms | 7.710 ms | — | 3.6% |

#### bench/hydrate.bench.ts — hydration: adopt an SSR page

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| 5 sections × 4 slots (20 bindings): parse markup only (control) | 349.4 µs | 2.139 ms | — | 4.6% |
| 5 sections × 4 slots (20 bindings): parse + hydrateIsland (adopt) | 394.0 µs | 2.346 ms | — | 9.2% |
| 5 sections × 4 slots (20 bindings): client-side render, no SSR markup (comparison) | 326.1 µs | 2.043 ms | — | 10.0% |
| 20 sections × 5 slots (100 bindings): parse markup only (control) | 1.474 ms | 4.543 ms | — | 9.3% |
| 20 sections × 5 slots (100 bindings): parse + hydrateIsland (adopt) | 1.701 ms | 2.220 ms | — | 3.6% |
| 20 sections × 5 slots (100 bindings): client-side render, no SSR markup (comparison) | 1.473 ms | 1.943 ms | — | 5.3% |
| 60 sections × 8 slots (480 bindings): parse markup only (control) | 6.636 ms | 7.044 ms | — | 3.7% |
| 60 sections × 8 slots (480 bindings): parse + hydrateIsland (adopt) | 10.911 ms | 17.164 ms | — | 2.8% |
| 60 sections × 8 slots (480 bindings): client-side render, no SSR markup (comparison) | 7.068 ms | 7.647 ms | — | 5.8% |

#### bench/islands.bench.ts — island activation: inline vs shared props

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| 10 islands, inline props: parse markup only (control) | 361.2 µs | 2.154 ms | — | 2.8% |
| 10 islands, inline props: parse + activateIslands | 512.2 µs | 2.476 ms | — | 2.3% |
| 10 islands, shared props: parse markup only (control) | 301.4 µs | 780.6 µs | — | 3.6% |
| 10 islands, shared props: parse + activateIslands | 471.9 µs | 2.183 ms | — | 3.1% |
| 100 islands, inline props: parse markup only (control) | 3.484 ms | 3.936 ms | — | 2.3% |
| 100 islands, inline props: parse + activateIslands | 6.560 ms | 10.877 ms | — | 2.6% |
| 100 islands, shared props: parse markup only (control) | 2.979 ms | 4.776 ms | — | 3.2% |
| 100 islands, shared props: parse + activateIslands | 7.679 ms | 9.094 ms | — | 0.6% |

#### bench/islands.bench.ts — island teardown

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| 100 islands: activate + deactivateAllIslands (round trip) | 7.673 ms | 9.484 ms | — | 22.8% |
| 100 islands: activate only (control) | 6.176 ms | 8.736 ms | — | 1.9% |

#### bench/list.bench.ts — createList: full teardown

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| 1000 rows → [] → 1000 rows (drain + refill round trip) | 28.579 ms | 33.339 ms | — | 1.2% |

#### bench/list.bench.ts — createList: initial render

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| 100 rows: createList → mount → first reconcile | 496.9 µs | 2.574 ms | — | 3.1% |
| 1000 rows: createList → mount → first reconcile | 8.779 ms | 13.775 ms | — | 1.4% |
| 10000 rows: createList → mount → first reconcile | 177.388 ms | 210.328 ms | — | 1.1% |
| 1000 rows: h() + appendChild by hand, no list (floor) | 7.254 ms | 12.769 ms | — | 2.3% |
| 10000 rows: h() + appendChild by hand, no list (floor) | 68.943 ms | 99.450 ms | — | 2.1% |

#### bench/list.bench.ts — createList: keyed reconciliation on 100 rows (small-list path)

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| shuffle 20 rows (one full reorder) | 13.7 µs | 19.5 µs | — | 3.0% |
| shuffle 100 rows (one full reorder) | 82.7 µs | 93.9 µs | — | 1.2% |

#### bench/list.bench.ts — createList: keyed reconciliation on 1000 rows

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| append 100 + trim back to 1000 (round trip) | 2.558 ms | 4.408 ms | — | 2.1% |
| prepend 100 + trim back to 1000 (round trip) | 2.575 ms | 4.474 ms | — | 1.7% |
| remove first 100 + restore (round trip) | 2.543 ms | 4.420 ms | — | 1.3% |
| shuffle 1000 rows (one full reorder) | 2.618 ms | 2.924 ms | — | 3.5% |
| same keys, same order — reconciler fast path | 97.0 µs | 201.4 µs | — | 11.7% |

#### bench/list.bench.ts — reconcileList: row removal

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| 1000 plain rows: build only (control) | 7.140 ms | 12.888 ms | — | 3.6% |
| 1000 plain rows: build + reconcileList removes all | 22.368 ms | 24.961 ms | — | 1.9% |
| 1000 plain rows: build + removeChild by hand (pre-hardening cost) | 7.187 ms | 13.138 ms | — | 2.3% |
| 1000 6-node rows: build only (control) | 41.150 ms | 56.952 ms | — | 1.2% |
| 1000 6-node rows: build + reconcileList removes all | 63.630 ms | 88.326 ms | — | 1.0% |
| 1000 6-node rows: build + removeChild by hand (pre-hardening cost) | 45.405 ms | 61.185 ms | — | 1.3% |

#### bench/reactive.bench.ts — effect creation

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| createEffect + dispose (×500) | 117.3 µs | 306.3 µs | 235 ns | 2.7% |
| internalEffect + dispose, the DOM-binding path (×500) | 61.6 µs | 263.5 µs | 123 ns | 4.3% |

#### bench/reactive.bench.ts — internalEffect: flush-isolation overhead

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| 1 internalEffect binding(s), as shipped: write (×5000) | 143.6 µs | 188.0 µs | 29 ns | 9.1% |
| 1 rawEffect binding(s), pre-hardening shape: write (×5000) | 156.3 µs | 252.6 µs | 31 ns | 7.5% |
| 100 internalEffect binding(s), as shipped: write (×50) | 121.5 µs | 133.1 µs | 2.43 µs | 15.3% |
| 100 rawEffect binding(s), pre-hardening shape: write (×50) | 103.5 µs | 114.6 µs | 2.07 µs | 6.0% |

#### bench/reactive.bench.ts — signal write → effect flush: batching

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| 100 signals, one write each, unbatched (×30) | 281.6 µs | 320.7 µs | 9.39 µs | 7.0% |
| 100 signals, one write each, batched (×30) | 270.0 µs | 286.8 µs | 9.00 µs | 7.2% |
| one signal, 100 writes, unbatched (×30) | 236.8 µs | 275.5 µs | 7.89 µs | 10.8% |
| one signal, 100 writes, batched (×30) | 19.4 µs | 20.8 µs | 647 ns | 21.1% |

#### bench/reactive.bench.ts — signal write → effect flush: deep chain

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| computed depth 1: write → re-derive → effect (×500) | 47.1 µs | 51.1 µs | 94 ns | 4.8% |
| computed depth 10: write → re-derive → effect (×500) | 138.6 µs | 153.8 µs | 277 ns | 7.3% |
| computed depth 50: write → re-derive → effect (×500) | 550.4 µs | 604.0 µs | 1.10 µs | 5.3% |

#### bench/reactive.bench.ts — signal write → effect flush: equal-value no-op

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| write the SAME value, no effect runs (×20000) | 24.7 µs | 69.3 µs | 1 ns | 142.9% |
| write a CHANGING value, effect runs (×500) | 36.2 µs | 41.9 µs | 72 ns | 10.1% |
| write suppressed by a custom equals (×20000) | 35.3 µs | 38.3 µs | 2 ns | 3.7% |

#### bench/reactive.bench.ts — signal write → effect flush: wide fan-out

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| 10 effects on one signal: write (×500) | 362.7 µs | 400.9 µs | 725 ns | 5.1% |
| 100 effects on one signal: write (×50) | 389.8 µs | 418.2 µs | 7.80 µs | 3.4% |
| 1000 effects on one signal: write (×5) | 404.2 µs | 484.7 µs | 80.85 µs | 5.7% |

#### bench/ssr.bench.ts — renderToString: reactive props and children

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| 500 list items, plain values | 395.3 µs | 617.7 µs | — | 2.8% |
| 500 list items, every prop and child a getter | 400.3 µs | 670.5 µs | — | 0.9% |

#### bench/ssr.bench.ts — renderToString: tree size sweep

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| 10 cards (~3 KB of HTML) | 46.0 µs | 53.6 µs | — | 0.7% |
| 100 cards (~31 KB of HTML) | 447.9 µs | 679.0 µs | — | 0.9% |
| 1000 cards (~316 KB of HTML) | 5.729 ms | 6.399 ms | — | 1.9% |
| 5000 cards (~1597 KB of HTML) | 31.425 ms | 37.261 ms | — | 1.7% |

#### bench/ssr.bench.ts — renderToString: URL-attribute guard cost

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| 1000 cards, one href each | 5.637 ms | 6.149 ms | — | 2.7% |
| 1000 cards, same attrs, none URL-bearing (control) | 5.604 ms | 6.095 ms | — | 2.6% |

<!-- BENCH:END -->
