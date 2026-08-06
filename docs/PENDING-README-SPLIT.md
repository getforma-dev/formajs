# PENDING — the README split, prepared but not applied

**Status: not applied.** `README.md` in this repo is still the 1,167-line
monolith. The pages it should delegate to already exist in `docs/`; this file
is the instruction list for the last step, written while `src/` and the tests
were frozen for parallel work. Delete this file once the split lands.

**Why the split.** The README is the entire narrative documentation set in one
file. Nobody re-reads it to check a sentence, which is a large part of why so
many of its claims rotted unnoticed — this week's audit found a version pin
five minors stale, a CDN artifact that no longer existed, a subpath documented
with an API shape it never had, and a coverage figure that was simply wrong.
Shorter documents get re-read; re-read documents get corrected.

**What has already been done** (all additive, all in `docs/`):

| New page | Replaces README section(s) |
|---|---|
| [`API.md`](API.md) | *The `h()` Function*, *Core API* (signals → portals), *Rest of the export surface*, *Escape hatches* |
| [`HTML-RUNTIME.md`](HTML-RUNTIME.md) | *3. HTML Runtime (no build step)*, *The expression grammar is a real constraint*, *Full directive reference* |
| [`ISLANDS.md`](ISLANDS.md) | *Islands Architecture*, *SSR with Server Data*, *Hydration Triggers*, *Scoping to a subtree, and disposal* |
| [`CDN-AND-EXPORTS.md`](CDN-AND-EXPORTS.md) | *CDN Builds*, *All builds*, *Subpath Exports* |
| [`COMPARISONS.md`](COMPARISONS.md) | *Coming from React?*, *How Is This Different from Solid?* |
| [`STABILITY.md`](STABILITY.md) | *Stability* |
| [`design/CSP-SAFE-EXPRESSION-GRAMMAR.md`](design/CSP-SAFE-EXPRESSION-GRAMMAR.md) | new — the in-progress grammar work, marked as not shipped |
| [`TEST-SUITE-AUDIT.md`](TEST-SUITE-AUDIT.md) | new — the mutation-probe audit and its remediation plan |
| [`README.md`](README.md) | new — the docs index |

Every `Verified by` citation was carried across **verbatim**, and the HTML
runtime showcase block in `HTML-RUNTIME.md` is byte-identical to the README
block that `src/__tests__/readme-examples.test.ts` mirrors (diffed, 2026-08-05).

---

## Step 1 — replace `README.md` with the text in the appendix below

It keeps: the badges, the size table, the intro example, install, the three
entry points in brief, why-FormaJS with its benchmark citations, the CSP
promise, the stack orientation block, and a documentation index. It drops
everything now in `docs/`.

## Step 2 — `src/__tests__/docs-truth.test.ts` must move with it

**This is not optional.** Eight assertions in that file read `README.md`
directly; four of them fail the moment the sections move. Apply these edits in
the same commit.

Add the new pages next to the existing reads at the top of the file:

```ts
const API_DOC = read('docs/API.md');
const RUNTIME_DOC = read('docs/HTML-RUNTIME.md');
const ISLANDS_DOC = read('docs/ISLANDS.md');
const CDN_DOC = read('docs/CDN-AND-EXPORTS.md');
const STABILITY_DOC = read('docs/STABILITY.md');
const COMPARISONS_DOC = read('docs/COMPARISONS.md');
```

| Test | What breaks | The edit |
|---|---|---|
| "the All builds table lists exactly the CDN artifacts the build emits" | slices `README` between `'### All builds'` and `'## Subpath Exports'`; neither string will exist | slice `CDN_DOC` between `'## Every CDN artifact'` and `'## Subpath exports'` (both exist verbatim in the new page; note the lower-case `exports`) |
| "does not point the browser ESM recipe at the code-split npm entry" | asserts `README` contains `'/dist/forma.esm.js'` | assert it of `CDN_DOC`; keep the negative `not.toMatch(/@getforma\/core@[\d.]+\/dist\/index\.js/)` and run it over `README` **and** `CDN_DOC` |
| "documents every symbol the root entry exports" | greps `README` for every export name; the export tables are now in `API.md` | build the haystack as `[README, API_DOC, RUNTIME_DOC, ISLANDS_DOC, CDN_DOC].join('\n')` and keep the rest of the test as-is |
| "names the unsanitized HTML sinks reachable from the core entry" | expects `README` to contain `dangerouslySetInnerHTML`, `setHTMLUnsafe`, `srcdoc` | expect it of `API_DOC` (leave the `SECURITY` half untouched) |
| "the island coverage figure matches the island test files" | regexes the Stability row out of `README` | run the same regex over `STABILITY_DOC`. The new page carries the row in the format the regex needs. **Recompute the number when you apply this** — it was 198 across 12 files on 2026-08-05, and the test is what keeps it honest |
| "every documented CDN pin is the current package version" | passes either way (`README` keeps concrete pins), but the new pages carry pins too | scan `[README, RUNTIME_DOC, CDN_DOC].join('\n')` so a version bump cannot leave a stale pin in `docs/` |
| "mentions no artifact the build no longer produces" | passes | add `CDN_DOC` and `RUNTIME_DOC` to the loop |
| "the size table quotes the limits the CI gate actually enforces" | passes — the size table stays in the README | no change |
| "every citation names a test file that exists and a test that is in it" | passes, but stops covering the moved citations | add all six new pages to the `DOCS` map. This is the single most valuable edit in this list: without it, every citation in `docs/` is unchecked, which is the exact failure mode this restructure exists to fix |
| "every benchmark citation names a benchmark the suite actually ran" | asserts `checked > 4`; the README's five `Benchmarked by:` lines are the only ones outside `CONTRIBUTING.md` | the appendix README **keeps all five citations** (the raw numbers are dropped, the citations are not), so this passes unchanged. If you drop a bullet, move its citation into `docs/PERFORMANCE.md` first |

## Step 3 — two comments that name the README

- `src/__tests__/readme-examples.test.ts` header says its samples are "copied
  verbatim from README.md". After the split the showcase markup, the grammar
  examples and the directive table live in `docs/HTML-RUNTIME.md`; the
  `createHistory` sample lives in `docs/API.md`. Update the header comment and
  the `// README.md "…"` section banners to name the new files. **No assertion
  changes** — the markup is inlined in the test, not extracted from the file.
- `CONTRIBUTING.md` points contributors at README sections. Re-point it at
  `docs/README.md`, and add the stack-wide
  [testing policy](https://github.com/getforma-dev/forma/blob/main/docs/TESTING.md)
  and the `Verified by:` contract while you are there — this repo is where the
  convention is used most heavily and its own CONTRIBUTING does not yet state
  it.

## Step 4 — verify

```bash
npm run typecheck
npx vitest run src/__tests__/docs-truth.test.ts   # the whole point of steps 2–3
npm test
```

Then read the new README top to bottom once. If it takes more than three
minutes, it is still too long.

---

## Other pending documentation changes (same freeze, same reason)

1. **`docs/HARDENING-AUDIT.md` → `docs/archive/`** once its ledger is closed.
   It is a completed point-in-time audit sitting next to the reference docs.
   `docs-truth.test.ts` resolves the citations inside it by path, so the move
   and the test edit are one change. See [`archive/README.md`](archive/README.md).
2. **`CSP.md`'s version-history table** ends with a `> 1.5.0` row describing the
   fixed behaviour, while `package.json` is at 1.5.0 — i.e. it documents an
   unreleased build. True today, wrong the moment a release is cut without
   touching it.
3. **The Stability row for `@getforma/core/wasm`** in the current README says
   "unreachable before 1.6.0", but `./wasm` is already an `exports` subpath in
   `package.json`. Either the claim means something narrower (nothing shipped
   sets `window.__FORMA_WASM__`) or it is stale. `docs/STABILITY.md`
   deliberately states only the part that is verifiable — the missing global —
   and the owner should decide what the version claim was meant to say.
4. **`CSP.md` and `README.md` will both need a pass when the CSP grammar work
   lands** (see the design record). `docs/HTML-RUNTIME.md` carries a status
   banner pointing at it so the two cannot silently disagree in the meantime.

---

# Appendix — the proposed `README.md`, in full

Copy everything between the markers verbatim.

<!-- ================= BEGIN README.md ================= -->

```markdown
# FormaJS

[![CI](https://github.com/getforma-dev/formajs/actions/workflows/ci.yml/badge.svg)](https://github.com/getforma-dev/formajs/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@getforma/core)](https://www.npmjs.com/package/@getforma/core)
[![Socket Badge](https://socket.dev/api/badge/npm/package/@getforma/core)](https://socket.dev/npm/package/@getforma/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Reactive DOM library with fine-grained signals. No virtual DOM — signals update only the DOM nodes that changed. Components run once.

> **Where this sits.** One product, four repos:
>
> ```
> TS/JSX → @getforma/compiler → FMIR (binary) → forma-ir walker → HTML → @getforma/core adopts it
>          forma-tools                          forma                    THIS REPO
> ```
>
> **You are here:** the client runtime — signals, `h()`, islands, hydration, and the zero-build HTML runtime. It works entirely on its own; the rest of the stack is opt-in. New to the stack? Read **[the stack architecture](https://github.com/getforma-dev/forma/blob/main/docs/ARCHITECTURE.md)** first. Neighbours: [forma-tools](https://github.com/getforma-dev/forma-tools) (compiler + build) · [forma](https://github.com/getforma-dev/forma) (Rust parser, walker, server) · [create-forma-app](https://github.com/getforma-dev/create-forma-app) (scaffolder).

```tsx
import { createSignal, h, mount } from "@getforma/core";

const [count, setCount] = createSignal(0);

function Counter() {
  return (
    <button onClick={() => setCount((c) => c + 1)}>
      {() => `Clicked ${count()} times`}
    </button>
  );
}

mount(() => <Counter />, "#app");
```

No re-renders. No dependency arrays. No `useMemo`. The button text updates because it reads `count()` inside a reactive function — nothing else in the tree is touched.

Verified by `src/__tests__/readme-examples.test.ts` > "the intro counter works without eval"

---

## Install

```bash
npm install @getforma/core
```

Or use a CDN — no build step, no bundler:

```html
<!-- jsDelivr (recommended) -->
<script src="https://cdn.jsdelivr.net/npm/@getforma/core@latest/dist/formajs-runtime.global.js"></script>

<!-- unpkg -->
<script src="https://unpkg.com/@getforma/core/dist/formajs-runtime.global.js"></script>
```

> **Production:** Pin the version (e.g., `@getforma/core@1.5.0`) instead of `@latest`.

Any bundler works — Vite, esbuild, tsup, webpack, Rollup. FormaJS ships standard ESM and CJS via `package.json` exports. No plugins, no special config. For JSX, set `jsx: "react"`, `jsxFactory: "h"`, `jsxFragmentFactory: "Fragment"`.

Gzipped sizes, measured by `npm run check:size` on the 1.5.0 build (that script walks the real ESM import graph, so shared chunks are weighed, and CI fails the build if any entry exceeds its limit):

| Artifact | Gzipped | CI limit |
|---|---|---|
| `@getforma/core` entry + every chunk it imports | 24.8 KB (25,394 B) | 30,000 B |
| CDN HTML runtime (`formajs-runtime.global.js`) | 31.0 KB (31,763 B) | 34,000 B |
| CDN HTML runtime, hardened (`formajs-runtime-hardened.global.js`) | 30.0 KB (30,764 B) | 33,000 B |
| CDN browser ESM (`forma.esm.js`, inlines alien-signals) | 23.6 KB (24,171 B) | 29,000 B |

The core figure is **untree-shaken** — it is everything `dist/index.js` pulls in. A bundler that drops what your app does not import ships less.

---

## Three ways to use it

All three share the same signal graph and reactive engine. Pick one, or mix them.

| | What it looks like | Needs |
|---|---|---|
| **JSX** | `<button onClick={…}>{() => count()}</button>` | a bundler with a JSX transform |
| **Hyperscript** | `h("button", { onClick: fn }, () => count())` | a bundler |
| **HTML runtime** | `<button data-on:click="{count++}">` | one `<script>` tag, nothing else |

JSX compiles to `h()` — same function, no JSX-specific runtime. The HTML runtime reads `data-*` attributes out of the page and wires them to the same signals.

```html
<script src="https://cdn.jsdelivr.net/npm/@getforma/core@1.5.0/dist/formajs-runtime.global.js"></script>

<div data-forma-state='{ "count": 0 }'>
  <p data-text="{count}"></p>
  <button data-on:click="{count++}">+1</button>
  <button data-on:click="{count = 0}">Reset</button>
</div>
```

That is a working reactive counter: no JavaScript file, no build step. → [docs/HTML-RUNTIME.md](docs/HTML-RUNTIME.md) for every directive and the expression grammar.

---

## Why FormaJS

**Components run once.** No virtual DOM, no diffing, no reconciliation overhead. `h('div')` returns an actual `HTMLDivElement`. When a signal changes, only the specific text node or attribute that reads it updates — not the component, not the tree.

**Fine-grained reactivity.** Powered by [alien-signals](https://github.com/johnsoncodehk/signals) 3.x. The signal graph tracks dependencies automatically. No dependency arrays, no stale closures, no `useCallback` / `useMemo` ceremony.

**Three entry points, one engine.** Start with a CDN script tag, graduate to a full build pipeline without rewriting.

**Islands over SPAs.** `activateIslands()` hydrates independent regions of server-rendered HTML — error isolation per island, deferred triggers (`visible`, `idle`, `interaction`), and disposal for module swaps. → [docs/ISLANDS.md](docs/ISLANDS.md)

**CSP-safe.** The HTML runtime evaluates expressions with an allowlist AST interpreter. **Zero `eval()`, zero `new Function()`, zero `with()` in every shipped artifact** — there is no opt-in fallback to leave switched on by mistake, because the fallback was deleted. Asserted by `scripts/verify-dist.mjs`, which greps the built files as the last step of `npm run build`, and by a Playwright spec that serves the flagship fixture under a real CSP header.

Verified by `src/__tests__/runtime-csp-default.test.ts` > "no build can reach new Function, with any configuration"
Verified by `src/__tests__/build-artifacts.test.ts` > "no build emits new Function or a with() scope wrapper"

**What FormaJS is not:** a framework with opinions about routing, data fetching or state management. It is a reactive DOM library. You bring the architecture.

### Measured, not asserted

`npm run bench` runs the hot-path suite in `bench/`. The numbers — each with the run-to-run noise floor next to it, so a later comparison can tell a regression from a bad afternoon — live in [docs/PERFORMANCE.md](docs/PERFORMANCE.md). They are happy-dom figures: good for comparing FormaJS against FormaJS, not against a browser.

- **A write that changes nothing does nothing.** An equal-value write never reaches an effect, and costs orders of magnitude less than one that does.
  Benchmarked by: bench/reactive.bench.ts > "write a CHANGING value, effect runs (×500)"
- **`batch()` collapses repeated writes to one flush.** It does nothing for writes to 100 *different* signals, which is the correct result.
  Benchmarked by: bench/reactive.bench.ts > "one signal, 100 writes, batched (×30)"
- **A keyed list update that changes no keys and no order takes the reconciler's fast path**, and costs a fraction of the same rows reordered.
  Benchmarked by: bench/list.bench.ts > "same keys, same order — reconciler fast path"
- **Hydration beats client rendering.** Adopting server-rendered keyed rows costs less than building the same list client-side, with the HTML parse subtracted from both sides.
  Benchmarked by: bench/hydrate.bench.ts > "1000 rows: parse + adopt by data-forma-key"
- **The CSP-safe interpreter is faster than the `eval` path it replaced** — and it needs no `unsafe-eval` in your CSP.
  Benchmarked by: bench/expression.bench.ts > "8 count-dependent expressions: write → evaluate → text (×20)"

---

## Documentation

| Document | What it answers |
|---|---|
| [docs/API.md](docs/API.md) | `h()`, signals, control flow, stores, components, async, portals — and the four unsanitized escape hatches |
| [docs/HTML-RUNTIME.md](docs/HTML-RUNTIME.md) | Every `data-*` directive, and the CSP-safe expression grammar with its limits |
| [docs/ISLANDS.md](docs/ISLANDS.md) | Hydrating server-rendered HTML, seeding signals from server data, keyed list adoption |
| [docs/CDN-AND-EXPORTS.md](docs/CDN-AND-EXPORTS.md) | Which CDN build to load, and what each subpath export contains |
| [docs/COMPARISONS.md](docs/COMPARISONS.md) | Coming from React, and how this differs from Solid |
| [docs/STABILITY.md](docs/STABILITY.md) | What is stable, what is beta, and the one known gap |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md) | Benchmarked hot paths, with noise floors |
| [SECURITY.md](SECURITY.md) · [CSP.md](CSP.md) | Threat model; running under a strict Content-Security-Policy |
| [docs/README.md](docs/README.md) | The full documentation index, including design records |

Examples: [`examples/`](./examples) — counter, counter-jsx, csp, todo, data-table.

---

## Part of the Forma Stack

### Frontend (TypeScript)

| Package | Description |
|---|---|
| [@getforma/core](https://www.npmjs.com/package/@getforma/core) | **This library** — reactive DOM, signals, islands, SSR hydration |
| [@getforma/compiler](https://www.npmjs.com/package/@getforma/compiler) | Vite plugin — h() optimization, server function transforms, FMIR emission |
| [@getforma/build](https://www.npmjs.com/package/@getforma/build) | Production pipeline — esbuild bundling, content hashing, compression, manifest |

### Backend (Rust)

| Package | Description |
|---|---|
| [forma-ir](https://crates.io/crates/forma-ir) | FMIR binary format — parser, walker, WASM exports |
| [forma-server](https://crates.io/crates/forma-server) | Axum middleware — SSR page rendering, asset serving, CSP headers |

### Full Framework

| Package | Description |
|---|---|
| [@getforma/create-app](https://github.com/getforma-dev/create-forma-app) | `npx @getforma/create-app` — scaffolds a Rust server + TypeScript frontend project |

---

## License

MIT
```

<!-- ================= END README.md ================= -->

## Notes on choices made in that draft

- **The size table stays in the README**, because `docs-truth.test.ts` pins its
  three CI limits against `scripts/check-size.mjs` and because size is the
  first thing a reader wants from a library like this.
- **The benchmark bullets keep their citations but lose their raw numbers.**
  The numbers were re-measured this week and live in `docs/PERFORMANCE.md` with
  their noise floors; a second copy in the README would be the next number to
  rot. The citations stay because a test resolves them.
- **`Verified by` lines carried across unchanged** — every one of them was
  already resolving in `docs-truth.test.ts` before the move.
- **Nothing was rewritten for style.** Prose that moved, moved verbatim, so a
  reviewer can diff the split rather than re-read it.
