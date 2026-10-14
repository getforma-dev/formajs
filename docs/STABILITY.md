# Stability

What you can build on, what is still moving, and what is known to be broken.

**Stable** means the API and its observable behaviour are not expected to
change, and a change would be a breaking release with a migration note in
`CHANGELOG.md`. **Beta** means it works and is tested, but the shape may still
move. **Experimental** means do not build on it yet. **Deprecated** means it
still works as documented, logs a coded warning in a development build, and is
removed in the major its row names; see [Deprecated entry points](#deprecated-entry-points).

| Feature | Status | Notes |
|---|---|---|
| Signals (`createSignal`, `createEffect`, `createComputed`, `batch`) | **Stable** | Core primitive. Custom `equals` supported. |
| Reactive introspection (`isSignal`, `isComputed`, `trigger`, `getBatchDepth`) | **Stable** | alien-signals 3.x type guards |
| `h()` / JSX rendering | **Stable** | Function components supported |
| `mount()`, `createShow`, `createSwitch`, `createList` | **Stable** | |
| HTML runtime (`data-*` directives) | **Stable** | CSP-safe expression parser; the grammar is a documented subset — see [HTML-RUNTIME.md](HTML-RUNTIME.md) |
| CSP-hardened runtime | **Stable** | No `new Function` in the artifact — asserted by `scripts/verify-dist.mjs` as the last step of `npm run build` |
| `createStore` (deep reactivity) | **Stable** | Membership changes (`Object.keys`, spread, `for…in`) are not reactive by design |
| Components (`defineComponent`, lifecycle) | **Stable** | |
| Context (`createContext`, `provide`, `inject`) | **Stable** | |
| Islands (`activateIslands`, disposal, triggers) | **Stable** | 199 tests across 12 dedicated files † |
| `createHistory` (undo/redo) | **Stable** | Takes a `[get, set]` tuple; returns a controls object, not a tuple |
| `createReducer` | **Stable** | |
| `createResource` / `createSuspense` | **Stable** | Abortable; the Suspense boundary is captured at resource creation |
| `createPortal`, `svg()`, `template()` | **Stable** | |
| `data-fetch`, `data-transition:*`, `data-ref` | **Stable** | |
| Server functions (`@getforma/core/server`: `"use server"` RPC, `createAction`, the revalidation helpers) | **Deprecated** | Removed in 3.0.0. Serve the call from a route in the application's Rust server. Logs `FORMA_W_DEPRECATED_SERVER`. |
| SSR (`@getforma/core/ssr`: `renderToString`, `renderToStream`) | **Deprecated** | Removed in 3.0.0. Render on the server with the Rust walker (forma-server). The two differ on form controls: `renderToString` writes a `textarea`'s and a `select`'s `value` as a `value` attribute, which the HTML parser ignores, where the walker writes the textarea's text and `selected` on the matching option. Logs `FORMA_W_DEPRECATED_SSR`. |
| Streaming SSR under strict CSP | **Known gap** | Suspense swap scripts carry no `nonce`, so a strict `script-src 'nonce-…'` blocks them and out-of-order content never swaps in. Use non-streaming SSR under strict CSP; do not add `'unsafe-inline'`. See [`../CSP.md`](../CSP.md). |
| TC39 Signals compat (`State`, `Computed`) | **Beta** | Tracks an evolving TC39 proposal |
| WASM render (`@getforma/core/wasm`) | **Deprecated** | Removed in 3.0.0. Re-render an island in the browser with core's `h()`, as islands already do. Needs `window.__FORMA_WASM__`; first shipped in 2.0.0 ‡. Logs `FORMA_W_DEPRECATED_WASM`. |

† The island figure counts the test cases in `activate`, `activate-isolation`,
`activate-reactivate`, `activate-triggers`, `activate-visible`,
`activate-visible-leak`, `deactivate`, `hydrate`, `hydrate-cleanup`,
`list-hydration`, `multi-island-integration` and
`shared-signals-across-islands` under `src/dom/__tests__/`.

Verified by `src/__tests__/docs-truth.test.ts` > "the island coverage figure matches the island test files"

‡ `./wasm` first resolved in 2.0.0. The subpath had no build entry, no dist
output and no `exports` key in any release from 0.7.1 through 1.5.0, so
`import "@getforma/core/wasm"` failed until then.

## Deprecated entry points

`@getforma/core/server`, `@getforma/core/ssr` and `@getforma/core/wasm` keep
working through 2.x and are removed in 3.0.0.

| Entry | Code | Instead |
|---|---|---|
| `@getforma/core/server` | `FORMA_W_DEPRECATED_SERVER` | A route in the application's Rust server, called with `fetch` |
| `@getforma/core/ssr` | `FORMA_W_DEPRECATED_SSR` | The Rust walker: forma-server renders the page |
| `@getforma/core/wasm` | `FORMA_W_DEPRECATED_WASM` | Core's `h()`, which islands already re-render with |

The first time one of them is loaded in a development build, it logs its code
once, as `[forma] FORMA_W_DEPRECATED_SSR: …`, with what replaces it. A
development build means here what it means for every dev-only diagnostic in
core (`__DEV__`): core compiled from its source with `NODE_ENV` other than
`production`. The files under `dist/` that npm installs are production builds.
They log nothing, their JavaScript is byte for byte what it was before the
deprecation, and `scripts/verify-dist.mjs` fails a build that leaks a code into
one. What an installed package shows instead is in its type declarations: every
function these entries export is marked `@deprecated`, which editors strike
through.

Verified by `src/__tests__/deprecated-entries.test.ts` > "$subpath logs its deprecation once in development, with its code"
Verified by `src/__tests__/deprecated-entries.test.ts` > "a production build of each deprecated entry carries no warning"

## About the numbers on this page

There is exactly one, and a test recomputes it from disk on every run: if
someone adds or deletes an island test, the build fails until this table
agrees. That is the only kind of number worth putting in a document — every
other row here is a statement about *behaviour*, which is what a stability
table is for.

If you need current measurements rather than status, they are in
[`PERFORMANCE.md`](PERFORMANCE.md), each with the run-to-run noise floor next
to it.
