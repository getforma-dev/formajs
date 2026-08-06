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

Gzipped sizes, measured by `npm run check:size` on the 1.5.0 build on 2026-08-06 (that script walks the real ESM import graph, so shared chunks are weighed, and CI fails the build if any entry exceeds its limit):

| Artifact | Gzipped | CI limit |
|---|---|---|
| `@getforma/core` entry + every chunk it imports | 24.8 KB (25,429 B) | 30,000 B |
| CDN HTML runtime (`formajs-runtime.global.js`) | 31.3 KB (32,015 B) | 34,000 B |
| CDN HTML runtime, hardened (`formajs-runtime-hardened.global.js`) | 30.3 KB (31,017 B) | 33,000 B |
| CDN browser ESM (`forma.esm.js`, inlines alien-signals) | 23.6 KB (24,198 B) | 29,000 B |

The core figure is **untree-shaken** — it is everything `dist/index.js` pulls in. A bundler that drops what your app does not import ships less. The gzipped figures are a measurement and rot; the CI limits are not, because a test reads them back out of the gate script.

Verified by `src/__tests__/docs-truth.test.ts` > "the size table quotes the limits the CI gate actually enforces"

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

Verified by `src/__tests__/readme-examples.test.ts` > "the intro counter works without eval"

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
