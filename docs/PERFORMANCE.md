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
out to cost a great deal. **Both are fixed**, with the safety property intact in
each case; the measurements that found them and the measurements that closed
them are in [What the hardening cost](#what-the-hardening-cost).

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

The two regressions that were worth fixing have a **The fix** subsection with its
own numbers. Those come from `npm run bench:compare` (5 runs) against the
committed baseline — the hardened tree, measured on the same machine — so the
before/after is produced by the same instrument that found the problem. Their
"before" column is that baseline, not the `git archive` A/B above, which is why
it does not match the A/B table row for row.

### 1. List row removal — 4 µs → 23 µs per removed row — **FIXED**

`removeRow` → `deactivateIslandsIn` (`src/dom/list.ts`) ran
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

But the price was being paid by every list on every page, and almost none of them
contain an island. It was **not worth it as written**, and it did not have to be:
the same guarantee is available for an integer compare.

#### The fix

`activateIslands` and `hydrateIslandRoot` (`src/dom/activate.ts`) now maintain a
count of scheduled-or-active islands, and `deactivateIslandsIn` returns
immediately when it is zero. An island cannot acquire anything worth tearing down
— a deferred trigger's observer, idle timer or interaction listeners, or a
hydrated reactive root — without going through one of those two paths, so a zero
count is *proof* that no row can contain one, not a heuristic. Nothing about the
guarantee is weakened; a page with no islands stops paying entirely.

The count is per-element and marker-guarded (`__formaTracked`), which is what
keeps it honest in both directions: a count that drifts **up** silently restores
the scan cost, and a count that drifts **down** silently restores the leak. Every
teardown path decrements — `deactivateIsland`, `deactivateAllIslands`, disposal
of a row containing one, and the failed-hydration path — and re-activating an
island cannot double-count it.

Verified by: `src/dom/__tests__/list-disposal.test.ts` > "does not scan a removed row when no island has ever been activated"
Verified by: `src/dom/__tests__/list-disposal.test.ts` > "scans every removed row while an island is live"
Verified by: `src/dom/__tests__/list-disposal.test.ts` > "still deactivates a live island after a different island was deactivated"
Verified by: `src/dom/__tests__/list-disposal.test.ts` > "still deactivates a live island after the same island was deactivated twice"
Verified by: `src/dom/__tests__/list-disposal.test.ts` > "stops scanning after an island whose hydrate function threw"
Verified by: `src/dom/__tests__/list-disposal.test.ts` > "moves the count to the element that replaced an empty island shell"

Measured with `npm run bench:compare` (5 runs) against the committed baseline,
i.e. the same instrument and the same machine that found the regression:

| benchmark | hardened (baseline) | fixed | change |
| --- | ---: | ---: | ---: |
| 1000 plain rows: build + reconcileList removes all | 22.368 ms | 7.249 ms | **−67.6%** |
| 1000 6-node rows: build + reconcileList removes all | 63.630 ms | 45.665 ms | **−28.2%** |
| append 100 + trim back to 1000 (round trip) | 2.558 ms | 963.4 µs | **−62.3%** |
| prepend 100 + trim back to 1000 (round trip) | 2.575 ms | 996.5 µs | **−61.3%** |
| remove first 100 + restore (round trip) | 2.543 ms | 955.4 µs | **−62.4%** |
| 1000 rows → [] → 1000 rows (drain + refill) | 28.579 ms | 10.906 ms | **−61.8%** |
| 1000 plain rows: build only *(control)* | 7.140 ms | 7.101 ms | −0.5% |
| 1000 plain rows: build + removeChild by hand *(control)* | 7.187 ms | 7.292 ms | +1.5% |
| 1000 6-node rows: build only *(control)* | 41.150 ms | 41.691 ms | +1.3% |
| 1000 6-node rows: build + removeChild by hand *(control)* | 45.405 ms | 45.685 ms | +0.6% |

Every control stayed put, which is what makes this attribution as airtight as the
original one. Subtracting the build-only control again, per removed row:

| row shape | pre-hardening | hardened | fixed | raw `removeChild` floor, same run |
| --- | ---: | ---: | ---: | ---: |
| 6-node row | 4.0 µs | 22.8 µs | **4.0 µs** | 4.0 µs |
| flat `<li>` | <0.4 µs | 15.3 µs | **0.15 µs** | 0.19 µs |

Removal is back on the floor: `reconcileList` removing 1000 six-node rows now
costs 45.665 ms against 45.685 ms for the same removals done by hand with
`parent.removeChild`, a 0.04% difference against a 3.2% noise floor. The guard's
residual cost is one integer compare per removed row and is not resolvable.

### 2. The URL guard runs before the identity cache — +50 ns on every no-op reactive URL write — **FIXED**

`handleGenericAttr` (`src/dom/element.ts`) checked `isDangerousUrl` *before* it
checked whether the value it was about to write is the one already there.
`isDangerousUrl` allocates (`String.replace` over the whole value) and runs two
regexes, so a `href` binding whose value never changes paid full price on every
flush and then wrote nothing.

| benchmark | before | after | change |
| --- | ---: | ---: | ---: |
| href bound to an unchanging URL: write → cache hit (×500) | 13.6 µs | 38.7 µs | **+185%** |

Per write: **27 ns → 77 ns**.

**Is it worth the safety it buys?** The safety is worth having and this cost is
not needed to get it.

#### The fix

The `cache[key] === strVal` check now runs ahead of the guard. That is safe by
construction rather than a trade: an identical string on the same element was
already accepted by the same guard on the write that populated the cache.

Every path that can populate or invalidate that cache entry was checked, because
one unguarded writer would turn the identity check into a bypass:

- **The reject path stores `null`, never the refused string** (`cache[key] = null;
  el.removeAttribute(key)`). A refused value therefore cannot leave an entry that
  a later identical payload would match. This is the one that would have made the
  reordering unsafe, and it is now pinned by a test.
- **No other handler writes this key.** `applyProp` routes `class`/`className` to
  `handleClass` (caches under `class`), `style` to `handleStyle` (`style`),
  `dangerouslySetInnerHTML` to `handleInnerHTML` (`innerHTML`), every
  `BOOLEAN_ATTRS` name to `handleBooleanAttr` (caches a boolean under its own
  name), and `xlink:*` to `handleXLink` (which does not use the cache at all).
  `BOOLEAN_ATTRS` and `URL_ATTRS` are disjoint, so none of those keys is
  URL-bearing and none of them reaches `handleGenericAttr`.
- **The cache object is per element and never reused.** `h()` allocates a fresh
  `Object.create(null)` the first time an element gets a dynamic prop; nothing
  clears or transplants one.
- **Hydration adoption does not touch it.** `applyDynamicProps`
  (`src/dom/hydrate.ts`) runs `isUnsafeAttrWrite` on every run and writes no cache
  entry, so it cannot seed one the guard has not seen.
- **`el.localName`, the guard's other input, cannot change** for the life of the
  element, so a cache hit really is the same (element, attribute, value) triple.

Verified by: `src/dom/__tests__/element-url-safety.test.ts` > "a refused URL leaves no cache entry that would let the same string through unchecked"
Verified by: `src/dom/__tests__/element-url-safety.test.ts` > "runs the URL guard once per distinct value, not once per flush"

| benchmark | hardened (baseline) | fixed | change |
| --- | ---: | ---: | ---: |
| href bound to an unchanging URL: write → cache hit (×500) | 37.9 µs | 13.9 µs | **−63.3%** |
| 3 reactive attrs incl. href: signal write → attr writes (×500) *(changing values)* | 1.780 ms | 1.751 ms | −1.6% |
| isDangerousUrl on a benign https URL (×20000) *(control)* | 1.026 ms | 1.034 ms | +0.8% |

Per write: **76 ns → 28 ns**, against 27 ns on the pre-hardening tree — the whole
regression is gone and the guard itself is untouched (a write whose value *does*
change still pays for it, and did not move).

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

## `createList` initial render: where the superlinearity comes from

The benchmark lane flagged this separately from the hardening, because it is on
both trees: `createList`'s initial render is superlinear where the hand-built
floor is linear. `h()` + `appendChild` over the same rows is *exactly* 10× for
10× the rows; `createList` goes from 1.2× that floor at 1000 rows to 2.6× at
10 000. The named suspects were the per-row root, the per-row index signal and
the cache rebuild.

**None of them. Nothing in the list code is superlinear — the environment is.**
Three floors were added to `bench/list.bench.ts` to split the gap; all four rows
below come from one 5-run pass — the same tight capture as the before/after
tables above, not the noisier one in [Baseline](#baseline) — so they are
comparable with each other and not with that table. Parenthesised figures are
that row's run-to-run spread.

| | 1000 rows | 10 000 rows | ×10 rows costs |
| --- | ---: | ---: | ---: |
| `h()` + `appendChild` by hand *(floor)* | 7.306 ms *(9.7%)* | 69.676 ms *(20.1%)* | **9.5×** — linear |
| `h()` + `insertBefore` an end marker by hand | 7.615 ms *(6.6%)* | 93.640 ms *(4.7%)* | **12.3×** |
| per-row root + index signal + cache, **no DOM** | 211.9 µs *(8.0%)* | 3.264 ms *(35.0%)* | 15.4× |
| `createList` → mount → first reconcile | 8.947 ms *(1.8%)* | 179.156 ms *(2.0%)* | **20.0×** |

At 10 000 rows `createList` is 109.5 ms above the `appendChild` floor. Inserting
before a marker instead of appending accounts for **24.0 ms** of that (22%), and
the per-row reactive bookkeeping — the thing that was suspected — accounts for
**3.3 ms** (3%), which is 0.33 µs per row against a 179 ms render. It is not the
answer.

The answer is that `createList` delimits its range with comment markers instead
of a wrapper `<div>` (so a list can live inside `<table>`/`<ul>`/`<select>`), and
that shape is quadratic *in happy-dom*:

- **`insertBefore(row, endMarker)`** runs `nodeArray.includes(referenceNode)` and
  then `nodeArray.indexOf(referenceNode)` — two full scans of the parent's child
  array, per inserted row (`happy-dom/lib/nodes/node/Node.js`). That is the 24 ms.
- **`container.appendChild(fragment)`**, which mounts the finished list, drains
  the fragment with `while (childNodes.length) this.appendChild(childNodes[0])`,
  and each of those moves calls `removeChild`, which does `splice(index, 1)` on
  the source's `nodeArray` *and* on its `elementArray` — shifting every remaining
  node, n times. By subtraction that is most of the remaining ~82 ms; the fourth
  floor below, which includes the fragment mount, is what confirms the total.

A browser does both in O(1): a real DOM keeps sibling pointers rather than an
array, and moving a `DocumentFragment` is one splice.

The decisive check is the fourth floor: a **hand-rolled list, everything but the
reconciler** — the marker pair in a fragment, one child root and one index signal
per row, `insertBefore` before the end marker, the fragment mounted, the cache
rebuilt and re-indexed, the root disposed. It contains no `reconcileList` and no
keyed bookkeeping at all, and it lands *on* `createList`: 219.7 ms against
186.6 ms in one 5-run pass and 229.4 ms against 232.9 ms in another, with both
rows' spreads between 20% and 53% in those runs. Level, within a noise floor that
wide. **The reconciler adds nothing measurable to a first render** — every loop on
that path is a single pass (two Map builds, one array fill, one disposal sweep),
which reading the code also says.

So the row is a measurement artifact of happy-dom, not a defect, and the earlier
note in this document — "something in the per-row bookkeeping … is not scaling
with the reconciler" — was wrong. What would be worth measuring is the same
sweep in a real browser, where both quadratic terms disappear; until someone does
that, the 10 000-row number here says more about happy-dom than about Forma.

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
case costs 97 µs. Removing rows is now back on the raw `removeChild` floor: 1000
six-node rows leave in 45.7 ms against 45.7 ms by hand. Initial render: 100 rows
497 µs, 1000 rows 8.78 ms, 10 000 rows 177 ms — and that last step is superlinear
against the `h()` + `appendChild` floor, which is exactly linear. That is
happy-dom's array-backed child lists, not Forma's per-row bookkeeping, and the
floors that prove it are in
[`createList` initial render](#createlist-initial-render-where-the-superlinearity-comes-from).

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

**Read this table's spread column before reading anything else in it.** This
capture is noticeably noisier than the one it replaced: the median spread across
all 101 rows is **14%** (40 rows above 20%), against 6% for the capture used for
the before/after tables above, which ran earlier in the same session on the same
machine. Three consecutive 5-run captures got 28%, 15% and 14% — the machine got
worse and stayed worse — so this is machine state, not the code. Nothing was
cherry-picked *within* a capture; the tightest of the three whole captures was
kept. Rows whose spread is above ~20% here are worth re-measuring before they are
believed, and `npm run bench:compare` against this baseline will be
correspondingly less sensitive, because its verdict floor is the larger of the
two spreads.

<!-- BENCH:START -->
_5 runs × 60–600 samples · node v20.16.0 · win32 x64 · fix/ksx-dogfood-findings@686a5dc + uncommitted changes · generated 2026-08-06 by `npm run bench:doc`_

#### bench/element.bench.ts — attribute-safety guards in isolation

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| isEventHandlerAttr on a non-event name (×20000) | 235.4 µs | 367.4 µs | 12 ns | 2.4% |
| isUrlAttr on a non-URL name (×20000) | 243.7 µs | 313.1 µs | 12 ns | 12.4% |
| isDangerousUrl on a benign https URL (×20000) | 1.036 ms | 1.168 ms | 52 ns | 3.1% |
| isDangerousUrl on an obfuscated javascript: URL (×20000) | 2.234 ms | 3.104 ms | 112 ns | 4.8% |
| isUnsafeAttrWrite on &lt;a href&gt; with a benign URL (×20000) | 1.404 ms | 2.928 ms | 70 ns | 15.6% |

#### bench/element.bench.ts — h(): reactive attribute updates

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| 3 reactive attrs incl. href: signal write → attr writes (×500) | 1.823 ms | 8.270 ms | 3.65 µs | 103.1% |
| 3 reactive attrs, none URL-bearing (control): write (×500) | 1.292 ms | 6.628 ms | 2.58 µs | 167.4% |
| href bound to an unchanging URL: write → cache hit (×500) | 13.8 µs | 34.7 µs | 28 ns | 105.2% |

#### bench/element.bench.ts — h(): realistic component subtree

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| card subtree: 6 elements, 11 attrs, 1 href, 2 handlers (×200) | 12.300 ms | 21.723 ms | 61.50 µs | 25.5% |

#### bench/element.bench.ts — h(): static attribute writes

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| h('div') with 4 static non-URL attrs (×500) | 2.191 ms | 9.234 ms | 4.38 µs | 147.6% |
| document.createElement + 4 setAttribute, no library (×500) | 2.109 ms | 9.519 ms | 4.22 µs | 124.2% |
| h('div') with no props (×500) | 750.9 µs | 5.513 ms | 1.50 µs | 103.0% |

#### bench/element.bench.ts — h(): URL-bearing static attribute writes

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| h('a') with href + 3 static non-URL attrs (×500) | 2.757 ms | 11.169 ms | 5.51 µs | 119.7% |
| h('a') with the same 4 attrs, none URL-bearing (control) (×500) | 2.202 ms | 9.974 ms | 4.40 µs | 140.3% |
| h('img') with src + srcset + alt (×500) | 2.641 ms | 11.569 ms | 5.28 µs | 84.5% |

#### bench/expression.bench.ts — expression compile

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| new Function compile, unique expressions (×200) | 80.7 µs | 102.6 µs | 404 ns | 7.2% |
| CSP parser: mount unique arithmetic expressions (×40) | 591.8 µs | 3.329 ms | 14.80 µs | 14.1% |
| CSP parser: mount bare identifiers, plumbing control (×40) | 344.7 µs | 2.785 ms | 8.62 µs | 13.1% |
| CSP parser: mount every supported grammar shape (×16) | 222.3 µs | 682.7 µs | 13.89 µs | 14.0% |

#### bench/expression.bench.ts — expression evaluate: CSP-safe interpreter (shipped)

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| 8 count-dependent expressions: write → evaluate → text (×20) | 48.7 µs | 58.0 µs | 2.43 µs | 9.3% |
| 8 × bare identifier, plumbing control: write → text (×20) | 39.3 µs | 44.4 µs | 1.97 µs | 4.4% |

#### bench/expression.bench.ts — expression evaluate: new Function path (reconstructed)

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| 8 count-dependent expressions via new Function: write → evaluate → text (×20) | 85.2 µs | 182.1 µs | 4.26 µs | 6.7% |
| 8 × bare identifier via new Function, plumbing control (×20) | 66.1 µs | 74.1 µs | 3.31 µs | 4.3% |
| 8 count-dependent expressions as hand-written closures, floor (×20) | 22.9 µs | 31.3 µs | 1.14 µs | 6.7% |

#### bench/hydrate.bench.ts — hydration: adopt an SSR keyed list

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| 100 rows: parse markup only (control) | 571.9 µs | 2.776 ms | — | 135.5% |
| 100 rows: parse + adopt by data-forma-key | 792.0 µs | 2.555 ms | — | 126.1% |
| 100 rows: client-side createList, no SSR markup (comparison) | 653.5 µs | 1.981 ms | — | 119.1% |
| 1000 rows: parse markup only (control) | 6.160 ms | 14.951 ms | — | 64.8% |
| 1000 rows: parse + adopt by data-forma-key | 9.186 ms | 22.487 ms | — | 97.3% |
| 1000 rows: client-side createList, no SSR markup (comparison) | 7.576 ms | 14.401 ms | — | 8.2% |

#### bench/hydrate.bench.ts — hydration: adopt an SSR page

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| 5 sections × 4 slots (20 bindings): parse markup only (control) | 366.0 µs | 2.350 ms | — | 6.4% |
| 5 sections × 4 slots (20 bindings): parse + hydrateIsland (adopt) | 398.0 µs | 2.367 ms | — | 4.0% |
| 5 sections × 4 slots (20 bindings): client-side render, no SSR markup (comparison) | 318.9 µs | 556.2 µs | — | 9.8% |
| 20 sections × 5 slots (100 bindings): parse markup only (control) | 1.527 ms | 3.367 ms | — | 18.1% |
| 20 sections × 5 slots (100 bindings): parse + hydrateIsland (adopt) | 1.755 ms | 3.787 ms | — | 19.7% |
| 20 sections × 5 slots (100 bindings): client-side render, no SSR markup (comparison) | 1.501 ms | 3.519 ms | — | 48.9% |
| 60 sections × 8 slots (480 bindings): parse markup only (control) | 6.733 ms | 15.078 ms | — | 106.0% |
| 60 sections × 8 slots (480 bindings): parse + hydrateIsland (adopt) | 11.367 ms | 24.538 ms | — | 72.9% |
| 60 sections × 8 slots (480 bindings): client-side render, no SSR markup (comparison) | 7.136 ms | 14.703 ms | — | 14.4% |

#### bench/islands.bench.ts — island activation: inline vs shared props

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| 10 islands, inline props: parse markup only (control) | 367.3 µs | 2.695 ms | — | 7.9% |
| 10 islands, inline props: parse + activateIslands | 529.5 µs | 2.699 ms | — | 6.7% |
| 10 islands, shared props: parse markup only (control) | 310.9 µs | 1.907 ms | — | 17.1% |
| 10 islands, shared props: parse + activateIslands | 476.0 µs | 2.490 ms | — | 9.6% |
| 100 islands, inline props: parse markup only (control) | 3.597 ms | 7.147 ms | — | 18.6% |
| 100 islands, inline props: parse + activateIslands | 6.727 ms | 12.747 ms | — | 3.5% |
| 100 islands, shared props: parse markup only (control) | 3.194 ms | 7.047 ms | — | 12.4% |
| 100 islands, shared props: parse + activateIslands | 8.035 ms | 13.276 ms | — | 22.3% |

#### bench/islands.bench.ts — island teardown

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| 100 islands: activate + deactivateAllIslands (round trip) | 6.920 ms | 15.009 ms | — | 11.7% |
| 100 islands: activate only (control) | 7.525 ms | 14.526 ms | — | 52.6% |

#### bench/list.bench.ts — createList: full teardown

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| 1000 rows → [] → 1000 rows (drain + refill round trip) | 12.124 ms | 21.739 ms | — | 7.5% |

#### bench/list.bench.ts — createList: initial render

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| 100 rows: createList → mount → first reconcile | 501.9 µs | 2.614 ms | — | 5.0% |
| 1000 rows: createList → mount → first reconcile | 8.941 ms | 16.811 ms | — | 5.7% |
| 10000 rows: createList → mount → first reconcile | 208.903 ms | 393.945 ms | — | 19.3% |
| 1000 rows: h() + appendChild by hand, no list (floor) | 7.977 ms | 14.786 ms | — | 12.3% |
| 10000 rows: h() + appendChild by hand, no list (floor) | 85.383 ms | 128.936 ms | — | 10.0% |
| 1000 rows: h() + insertBefore an end marker by hand, no list (floor) | 8.524 ms | 16.671 ms | — | 21.9% |
| 10000 rows: h() + insertBefore an end marker by hand, no list (floor) | 111.363 ms | 173.315 ms | — | 33.0% |
| 1000 rows: per-row root + index signal + cache, no DOM (floor) | 216.2 µs | 620.9 µs | — | 5.7% |
| 10000 rows: per-row root + index signal + cache, no DOM (floor) | 3.498 ms | 7.383 ms | — | 14.1% |
| 1000 rows: hand-rolled list, everything but the reconciler (floor) | 9.839 ms | 17.255 ms | — | 10.9% |
| 10000 rows: hand-rolled list, everything but the reconciler (floor) | 225.003 ms | 428.870 ms | — | 24.6% |

#### bench/list.bench.ts — createList: keyed reconciliation on 100 rows (small-list path)

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| shuffle 20 rows (one full reorder) | 14.3 µs | 45.8 µs | — | 89.0% |
| shuffle 100 rows (one full reorder) | 83.3 µs | 212.0 µs | — | 70.7% |

#### bench/list.bench.ts — createList: keyed reconciliation on 1000 rows

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| append 100 + trim back to 1000 (round trip) | 1.064 ms | 4.168 ms | — | 83.7% |
| prepend 100 + trim back to 1000 (round trip) | 1.071 ms | 4.034 ms | — | 73.7% |
| remove first 100 + restore (round trip) | 1.013 ms | 3.550 ms | — | 29.0% |
| shuffle 1000 rows (one full reorder) | 2.659 ms | 5.780 ms | — | 6.5% |
| same keys, same order — reconciler fast path | 98.5 µs | 361.4 µs | — | 9.4% |

#### bench/list.bench.ts — reconcileList: row removal

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| 1000 plain rows: build only (control) | 7.973 ms | 15.602 ms | — | 18.1% |
| 1000 plain rows: build + reconcileList removes all | 8.392 ms | 16.107 ms | — | 17.7% |
| 1000 plain rows: build + removeChild by hand (pre-hardening cost) | 8.241 ms | 15.603 ms | — | 6.8% |
| 1000 6-node rows: build only (control) | 48.433 ms | 75.181 ms | — | 5.0% |
| 1000 6-node rows: build + reconcileList removes all | 51.601 ms | 82.450 ms | — | 13.2% |
| 1000 6-node rows: build + removeChild by hand (pre-hardening cost) | 52.454 ms | 79.395 ms | — | 1.8% |

#### bench/reactive.bench.ts — effect creation

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| createEffect + dispose (×500) | 124.0 µs | 600.4 µs | 248 ns | 63.8% |
| internalEffect + dispose, the DOM-binding path (×500) | 65.9 µs | 268.4 µs | 132 ns | 175.9% |

#### bench/reactive.bench.ts — internalEffect: flush-isolation overhead

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| 1 internalEffect binding(s), as shipped: write (×5000) | 142.5 µs | 175.7 µs | 28 ns | 9.6% |
| 1 rawEffect binding(s), pre-hardening shape: write (×5000) | 154.3 µs | 171.4 µs | 31 ns | 6.1% |
| 100 internalEffect binding(s), as shipped: write (×50) | 109.0 µs | 226.1 µs | 2.18 µs | 3.7% |
| 100 rawEffect binding(s), pre-hardening shape: write (×50) | 97.4 µs | 210.2 µs | 1.95 µs | 14.4% |

#### bench/reactive.bench.ts — signal write → effect flush: batching

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| 100 signals, one write each, unbatched (×30) | 272.5 µs | 620.6 µs | 9.08 µs | 11.2% |
| 100 signals, one write each, batched (×30) | 263.1 µs | 355.5 µs | 8.77 µs | 10.1% |
| one signal, 100 writes, unbatched (×30) | 234.6 µs | 288.8 µs | 7.82 µs | 8.9% |
| one signal, 100 writes, batched (×30) | 16.0 µs | 22.2 µs | 533 ns | 31.8% |

#### bench/reactive.bench.ts — signal write → effect flush: deep chain

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| computed depth 1: write → re-derive → effect (×500) | 46.3 µs | 51.7 µs | 93 ns | 8.5% |
| computed depth 10: write → re-derive → effect (×500) | 138.5 µs | 258.6 µs | 277 ns | 6.1% |
| computed depth 50: write → re-derive → effect (×500) | 559.1 µs | 615.0 µs | 1.12 µs | 5.6% |

#### bench/reactive.bench.ts — signal write → effect flush: equal-value no-op

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| write the SAME value, no effect runs (×20000) | 62.0 µs | 71.7 µs | 3 ns | 156.3% |
| write a CHANGING value, effect runs (×500) | 37.0 µs | 75.7 µs | 74 ns | 7.5% |
| write suppressed by a custom equals (×20000) | 36.1 µs | 38.9 µs | 2 ns | 5.7% |

#### bench/reactive.bench.ts — signal write → effect flush: wide fan-out

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| 10 effects on one signal: write (×500) | 360.6 µs | 725.3 µs | 721 ns | 10.9% |
| 100 effects on one signal: write (×50) | 384.0 µs | 457.4 µs | 7.68 µs | 11.4% |
| 1000 effects on one signal: write (×5) | 416.2 µs | 603.0 µs | 83.24 µs | 8.3% |

#### bench/ssr.bench.ts — renderToString: reactive props and children

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| 500 list items, plain values | 391.6 µs | 910.8 µs | — | 56.4% |
| 500 list items, every prop and child a getter | 409.1 µs | 1.177 ms | — | 58.4% |

#### bench/ssr.bench.ts — renderToString: tree size sweep

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| 10 cards (~3 KB of HTML) | 46.1 µs | 81.3 µs | — | 58.5% |
| 100 cards (~31 KB of HTML) | 458.1 µs | 961.0 µs | — | 59.0% |
| 1000 cards (~316 KB of HTML) | 6.028 ms | 9.253 ms | — | 53.0% |
| 5000 cards (~1597 KB of HTML) | 32.220 ms | 68.418 ms | — | 49.9% |

#### bench/ssr.bench.ts — renderToString: URL-attribute guard cost

| benchmark | median | p95 | per op | run-to-run spread |
| --- | ---: | ---: | ---: | ---: |
| 1000 cards, one href each | 5.810 ms | 9.523 ms | — | 49.0% |
| 1000 cards, same attrs, none URL-bearing (control) | 5.707 ms | 10.186 ms | — | 51.9% |

<!-- BENCH:END -->
