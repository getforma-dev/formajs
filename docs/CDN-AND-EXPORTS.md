# CDN builds and subpath exports

Which file to load, and what each entry point contains.

> Every `@getforma/core@2.0.3` below is a real pin against the current release.
> Pin a version in production rather than `@latest`; a CDN URL is a
> dependency, and `@latest` is an unpinned one.

---

## Script tag — IIFE, auto-initializes

```html
<!-- jsDelivr (recommended) -->
<script src="https://cdn.jsdelivr.net/npm/@getforma/core@2.0.3/dist/formajs-runtime.global.js"></script>

<!-- unpkg -->
<script src="https://unpkg.com/@getforma/core@2.0.3/dist/formajs-runtime.global.js"></script>
```

This is the HTML runtime: it scans the document for `data-*` directives and
wires them up. See [HTML-RUNTIME.md](HTML-RUNTIME.md).

## ESM import — modern browsers, no bundler

Use `dist/forma.esm.js`. It is the only ESM artifact a browser can load
directly: it is built as a single file with `alien-signals` inlined, so there
are no bare specifiers and no code-split chunks for the browser to resolve.
(`dist/index.js` is the npm entry — it code-splits and imports
`"alien-signals"`, which a browser cannot resolve.)

```html
<script type="module">
  import { createSignal, h, mount } from "https://cdn.jsdelivr.net/npm/@getforma/core@2.0.3/dist/forma.esm.js";

  const [count, setCount] = createSignal(0);
  mount(() => h("button", { onClick: () => setCount((c) => c + 1) }, () => `${count()}`), "#app");
</script>
```

unpkg equivalent: `https://unpkg.com/@getforma/core@2.0.3/dist/forma.esm.js`

> **Do not mix `forma.esm.js` with the npm entry in one app.** It carries its
> own private copy of the reactive core, so signals, the owner tree and the
> island registry would be duplicated. The library detects this and warns:
> *"Duplicate @getforma/core instance detected"*.

## Every CDN artifact

| Build | Filename |
|---|---|
| HTML runtime, standard (recommended) | `formajs-runtime.global.js` |
| HTML runtime, hardened — same runtime, tree-shaken, no code splitting | `formajs-runtime-hardened.global.js` |
| HTML runtime, standard (short alias) | `forma-runtime.js` |
| HTML runtime, hardened (short alias) | `forma-runtime-csp.js` |
| Browser ESM — `h()` / signals / islands, no bundler | `forma.esm.js` |

Available from `unpkg.com/@getforma/core@VERSION/dist/` and
`cdn.jsdelivr.net/npm/@getforma/core@VERSION/dist/`. These five are reached by
URL only — none of them is behind an `exports` subpath, because the IIFE
bundles are classic scripts that must not go through a module resolver.

All five are production builds, and none has a development twin: a page that
loads core from a CDN gets none of core's development warnings. The
[development build](#development-build) is reached through the npm package.

Verified by `src/__tests__/docs-truth.test.ts` > "the All builds table lists exactly the CDN artifacts the build emits"
Verified by `src/__tests__/build-config.test.ts` > "builds a self-contained browser ESM bundle for the CDN recipe"

---

## Subpath exports

The main entry point (`@getforma/core`) has **zero network code** — no fetch,
no WebSocket, no `process.env`. Network-capable modules are separate imports,
so a bundler never pulls them into an app that does not ask for them.

| Import | Description |
|---|---|
| `@getforma/core` | Signals, `h()`, mount, lists, stores, components, islands, events, DOM utils |
| `@getforma/core/http` | `createFetch`, `fetchJSON`, `createSSE`, `createWebSocket` |
| `@getforma/core/storage` | `createLocalStorage`, `createSessionStorage`, `createIndexedDB` |
| `@getforma/core/server` | **Deprecated**, removed in 3.0.0 ([STABILITY.md](STABILITY.md#deprecated-entry-points)). `createAction`, `$$serverFunction`, `handleRPC`, `createRPCMiddleware`, `setRPCGuard` |
| `@getforma/core/runtime` | HTML runtime — `initRuntime()`, `mount()`, `unmount()`, `reconcile()`, `getDiagnostics()` |
| `@getforma/core/runtime-hardened` | The same runtime, bundled without code splitting (alias: `@getforma/core/runtime-csp`) |
| `@getforma/core/ssr` | **Deprecated**, removed in 3.0.0 ([STABILITY.md](STABILITY.md#deprecated-entry-points)). Server-side rendering in Node — `renderToString()`, `renderToStream()`, `sh()`, `shSuspense()`, `ssrSignal()`, `getSwapScript()` |
| `@getforma/core/wasm` | **Deprecated**, removed in 3.0.0 ([STABILITY.md](STABILITY.md#deprecated-entry-points)). `renderLocal()`, `renderIsland()` — render via the Rust FMIR walker compiled to WASM |
| `@getforma/core/tc39` | TC39-shaped `State` and `Computed` classes |

```ts
// Core — zero network code
import { createSignal, h, mount, createStore } from "@getforma/core";

// HTTP — only when needed
import { createFetch, createSSE } from "@getforma/core/http";

// Storage — only when needed
import { createLocalStorage } from "@getforma/core/storage";
```

`@getforma/core/tc39` exports the two classes **directly**. There is no
`Signal` namespace object, so import them by name:

```ts
import { State, Computed } from "@getforma/core/tc39";

const count = new State(0);
const doubled = new Computed(() => count.get() * 2);
count.set(5);
doubled.get(); // 10
```

Verified by `src/__tests__/docs-truth.test.ts` > "the tc39 subpath exports State and Computed, not a Signal namespace"

---

## Development build

Every subpath above has a development twin. Each `import` and `require`
branch reads:

```json
"import": {
  "types": "./dist/index.d.ts",
  "development": "./dist/dev/index.js",
  "default": "./dist/index.js"
}
```

The file under `dist/dev/` is built from the same sources with the same
options as its production twin, except that `__DEV__` is `true`, so it keeps
the warnings a production build drops: hydration mismatches, props the
renderer drops, raw-HTML sinks, the `FORMA_W_DEPRECATED_` codes
([STABILITY.md](STABILITY.md#development-builds)). The type declarations are
shared, so TypeScript sees one package either way.

| Resolver | Selects the development build |
|---|---|
| Vite's dev server | Yes, by itself: its default conditions include `development` unless the mode is `production` |
| webpack 5 with `mode: 'development'` | Yes, by itself |
| esbuild | Only with `conditions: ['development', 'module']`. Listing any condition drops esbuild's automatic `module`, so list it too |
| `@getforma/build` | In watch mode |
| Node (tests, scripts, server rendering) | Only with `node --conditions=development` (or the same in `NODE_OPTIONS`) |

A resolver that does not ask for the condition resolves exactly the files it
resolved before the development build existed, and those files are byte for
byte what they were.

**One build per process.** Core keeps its reactive state in module scope, so
the two builds in one process are two unrelated copies of it. A resolver
applies one set of conditions to every specifier, and a development file
imports only development files, so one resolver always loads one build. Two
resolvers in one process can still disagree: a development server that
bundles your code with the condition but lets Node load an external
dependency without it. Give both the same conditions (for Node,
`NODE_OPTIONS=--conditions=development`); if they differ, core logs
*"Duplicate @getforma/core instance detected"*.

The development build is slower where `__DEV__` checks something on every
call, such as `createList`'s duplicate-key check
([PERFORMANCE.md](PERFORMANCE.md)). It adds the JavaScript of every subpath a
second time to the package, without source maps: the files keep their
identifiers and one statement a line, so they read as they are.

Verified by `src/__tests__/development-build.test.ts` > "every subpath resolves to production files without the condition and to their development twins with it"
Verified by `src/__tests__/development-build.test.ts` > "a process resolving with the development condition loads one copy of core, and it is the development build"
Verified by `src/__tests__/development-build.test.ts` > "a process that loads both builds is told so by the duplicate-instance warning"

---

## Which one should I use?

| Situation | Load |
|---|---|
| A single HTML file, no build step | `formajs-runtime.global.js` |
| The same, preferring a slightly smaller, tree-shaken bundle | `formajs-runtime-hardened.global.js` |
| A page with a `<script type="module">` and no bundler | `forma.esm.js` |
| An app with a bundler | `npm install @getforma/core`, import from the package |
| Server-rendered pages hydrating islands | the npm package, plus [ISLANDS.md](ISLANDS.md) |
