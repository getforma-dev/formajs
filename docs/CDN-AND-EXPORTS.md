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

One more file sits beside them and is not a CDN script:
`formajs-frame.global.js`, the preview frame's runtime (FORMA-128). A server
writes it inline into the opaque-origin preview document, where it renders
the module its host sends in tier `'unreviewed'`; it never mounts the page on
load. An application's build that copies it as `forma-runtime.js` (FORMA-175)
copies this file, not the CDN alias above that shares that name and
auto-mounts. See [HTML-RUNTIME.md](HTML-RUNTIME.md#mounting-markup-you-did-not-write-tiers-and-grants).

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

Whether a resolver asks for the condition is its own convention, and two ask
by default where you might not expect it: **Vitest** and **Bun's bundler**.

| Resolver | Selects the development build |
|---|---|
| Vite, dev server (`vite`) | Yes, by itself |
| Vite, `vite build` | Only with `NODE_ENV=development`. Vite chooses by `NODE_ENV`, not by mode: `vite build --mode development` selects production |
| Vite, server-side rendering (`ssrLoadModule`; core externalized, the default) | Only with `ssr.resolve.externalConditions: ['development']` **and** Node run with `--conditions=development`. The first covers your code's imports of core, the second an external dependency's; with one alone they load different builds |
| Vitest | **Yes, by itself**, for your tests' imports and for external dependencies. See [Vitest](#vitest) |
| webpack 5 | With `mode: 'development'`; not with `'production'` or `'none'` |
| Rollup (`@rollup/plugin-node-resolve`) | Only with `exportConditions: ['development']` |
| esbuild | Only with `conditions: ['development', 'module']`. Listing any condition drops esbuild's automatic `module`, so list it too |
| Bun's bundler (`bun build`, `Bun.build`) | **Yes, by itself, also when minifying**, unless `bun build --production` or `NODE_ENV=production` (`Bun.build`: `NODE_ENV=production`, or `define: { 'process.env.NODE_ENV': '"production"' }`). Without one of these a production bundle ships `dist/dev/` |
| Bun's runtime (`bun run`) | Only with `--conditions=development` |
| Deno (`deno run`, `deno bundle`) | Only with `--conditions=development` |
| `@getforma/build` | In watch mode |
| Node (scripts, server rendering) | Only with `node --conditions=development` (or the same in `NODE_OPTIONS`) |

Checked with Vite 8.3.4, Vitest 4.1.10 and 5.0.4, webpack 5.111, Rollup 4.64
with node-resolve 16, esbuild 0.28, Bun 1.4.3, Deno 2.9 and Node 22; another
version may choose differently. A resolver that does not ask for the
condition resolves exactly the files it resolved before the development build
existed, and those files are byte for byte what they were.

### Vitest

Vitest asks for `development` unless `NODE_ENV` is `production`, and passes it
to Node for the dependencies it does not bundle. A test suite therefore loads
core's development build, and core's warnings (`[forma] …`) appear in its
output; a suite that fails on console output fails on them. To keep a suite on
the production build, run it with `NODE_ENV=production`, or remove the
condition in its config:

```js
// vitest.config.js: resolve without the `development` condition, for every package
const withoutDevelopmentCondition = {
  name: 'without-development-condition',
  configEnvironment(name, config) {
    if (config.resolve?.conditions) {
      config.resolve.conditions = config.resolve.conditions.filter(
        (c) => c !== 'development|production' && c !== 'development',
      );
    }
  },
};

export default { plugins: [withoutDevelopmentCondition] };
```

Setting `resolve.conditions` or `ssr.resolve.conditions` is not enough: Vitest
appends its own list, which carries the condition, to yours. (Checked with
Vitest 4.1.10 and 5.0.4, in the `node` and `happy-dom` environments.)

**One build per process.** Core keeps its reactive state in module scope, so
two copies in one process are two unrelated states. A resolver applies one set
of conditions to every specifier, and a development file imports only
development files, so one resolver always loads one build. Two resolvers in
one process can disagree, as in Vite's server-side rendering above with only
one of its two settings. Give both the same conditions. That removes mixed
builds, not every second copy: a bundler that inlines core while Node loads it
for an external dependency (Vite's `ssr.noExternal`, Vitest's
`server.deps.inline`) has loaded two copies since before this build existed,
and still does. Either way core logs *"Duplicate @getforma/core instance
detected"*.

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
