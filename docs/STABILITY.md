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
| Islands (`activateIslands`, disposal, triggers) | **Stable** | 198 tests across 12 dedicated files † |
| `createHistory` (undo/redo) | **Stable** | Takes a `[get, set]` tuple; returns a controls object, not a tuple |
| `createReducer` | **Stable** | |
| `createResource` / `createSuspense` | **Stable** | Abortable; the Suspense boundary is captured at resource creation |
| `createPortal`, `svg()`, `template()` | **Stable** | |
| `data-fetch`, `data-transition:*`, `data-ref` | **Stable** | |
| SSR (`renderToString`, `renderToStream`) | **Beta** | Functional; the API may still evolve |
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

## About the numbers on this page

There is exactly one, and a test recomputes it from disk on every run: if
someone adds or deletes an island test, the build fails until this table
agrees. That is the only kind of number worth putting in a document — every
other row here is a statement about *behaviour*, which is what a stability
table is for.

If you need current measurements rather than status, they are in
[`PERFORMANCE.md`](PERFORMANCE.md), each with the run-to-run noise floor next
to it.
