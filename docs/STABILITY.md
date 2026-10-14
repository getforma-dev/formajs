# Stability

What you can build on, what is still moving, and what is known to be broken.

**Stable** means the API and its observable behaviour are not expected to
change, and a change would be a breaking release with a migration note in
`CHANGELOG.md`. **Beta** means it works and is tested, but the shape may still
move. **Experimental** means do not build on it yet.

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
| SSR (`renderToString`, `renderToStream`) | **Beta** | Functional; the API may still evolve |
| SSR form controls | **Known gap** | `renderToString` writes a `textarea`'s and a `select`'s `value` as a `value` attribute, which the HTML parser ignores, where forma-ir 0.2.1 writes the textarea's text and `selected` on the option. Until `./ssr` is removed in 3.0.0, see [below](#ssr-form-controls). |
| Streaming SSR under strict CSP | **Known gap** | Suspense swap scripts carry no `nonce`, so a strict `script-src 'nonce-…'` blocks them and out-of-order content never swaps in. Use non-streaming SSR under strict CSP; do not add `'unsafe-inline'`. See [`../CSP.md`](../CSP.md). |
| TC39 Signals compat (`State`, `Computed`) | **Beta** | Tracks an evolving TC39 proposal |
| WASM render (`@getforma/core/wasm`) | **Experimental** | Needs `window.__FORMA_WASM__`; first shipped in the next release ‡ |

† The island figure counts the test cases in `activate`, `activate-isolation`,
`activate-reactivate`, `activate-triggers`, `activate-visible`,
`activate-visible-leak`, `deactivate`, `hydrate`, `hydrate-cleanup`,
`list-hydration`, `multi-island-integration` and
`shared-signals-across-islands` under `src/dom/__tests__/`.

Verified by `src/__tests__/docs-truth.test.ts` > "the island coverage figure matches the island test files"

‡ `./wasm` is an `exports` subpath in `package.json` today, but that is a
working-tree fact, not a published one: the subpath had no build entry, no dist
output and no `exports` key in any release from 0.7.1 through 1.5.0, so
`import "@getforma/core/wasm"` always failed. It first resolves in whatever
release cuts the current `## [Unreleased]` CHANGELOG entry. The row says "the
next release" rather than a number because the number is not decided, and a
guessed version in a stability table is how the previous claim ("unreachable
before 1.6.0") stopped being checkable.

## SSR form controls

`renderToString` (`@getforma/core/ssr`) writes a `textarea`'s and a
`select`'s `value` prop as a `value` attribute, static or reactive. The HTML
parser ignores that attribute on both, so the page as served shows an empty
textarea and a select on its first option, before activation and with
JavaScript off. forma-ir 0.2.1, the Rust walker, writes the textarea's value as
its text and the select's as `selected` on the matching option, so the two
server renderers disagree here. Adoption writes the client's values into both
controls, so an activated page is right. `./ssr` keeps this behaviour until it
is removed in 3.0.0; to serve these controls right without JavaScript, write
the textarea's text as its child and mark the option `selected` yourself.

Verified by `src/ssr/__tests__/render-form-controls.test.ts` > "writes a textarea's and a select's value prop as a value attribute, static or reactive"
Verified by `src/ssr/__tests__/render-form-controls.test.ts` > "the parsed page shows an empty textarea and the first option until adoption writes the values"

## About the numbers on this page

There is exactly one, and a test recomputes it from disk on every run: if
someone adds or deletes an island test, the build fails until this table
agrees. That is the only kind of number worth putting in a document — every
other row here is a statement about *behaviour*, which is what a stability
table is for.

If you need current measurements rather than status, they are in
[`PERFORMANCE.md`](PERFORMANCE.md), each with the run-to-run noise floor next
to it.
