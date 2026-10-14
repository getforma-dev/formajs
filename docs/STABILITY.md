# Stability

What you can build on, what is still moving, and what is known to be broken.

**Stable** means the API and its observable behaviour are not expected to
change, and a change would be a breaking release with a migration note in
`CHANGELOG.md`. **Beta** means it works and is tested, but the shape may still
move. **Experimental** means do not build on it yet. **Deprecated** means it
still works as documented and is removed in the major its row names; a
[development build](#development-builds) logs a coded warning, and an installed
package shows it as `@deprecated` in its types. See
[Deprecated entry points](#deprecated-entry-points).

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
| `trustedHtml()`, the raw-HTML entry every raw sink takes | **Stable** | A plain string at a raw sink, and `h('script')`, are deprecated forms: see [Deprecated forms](#deprecated-forms). |
| `data-fetch`, `data-transition:*`, `data-ref` | **Stable** | |
| Tiered mount (`mountMarkup(root, markup, { tier, grants, config })`) | **Beta** | New in 2.1.0: binds only under the root it is handed, with `fetch`, `dom` and `navigate` grants and a coded diagnostic per denial; see [HTML-RUNTIME.md](HTML-RUNTIME.md#mounting-markup-you-did-not-write-tiers-and-grants). Leaving out `grants` gives every grant until 3.0.0, which gives none and pins the signature (FORMA-108). |
| Preview frame runtime (`dist/formajs-frame.global.js`) | **Beta** | New in 2.1.0: the runtime a server writes inline into the opaque-origin preview frame; renders the module its host sends in tier `'unreviewed'`. Its message protocol (`module` in; `ready`, `resize`, `error` out) may still move before 3.0.0. |
| `reconcile()` from `@getforma/core/runtime`, and the runtime's auto-mount of `data-forma-state` on load and through a `body` observer | **Deprecated** | Removed in 3.0.0: they bind with every power, wherever markup lands. Mount with `mountMarkup()` and a tier. `reconcile()` logs `FORMA_W_DEPRECATED_RECONCILE`; the auto-mount logs nothing in 2.x. A page turns all of them off now with `data-forma-mount="manual"` on a `<script>` element. |
| Server functions (`@getforma/core/server`: `"use server"` RPC, `createAction`, the revalidation helpers) | **Deprecated** | Removed in 3.0.0. Serve the call from a route in the application's Rust server. Logs `FORMA_W_DEPRECATED_SERVER`. |
| SSR (`@getforma/core/ssr`: `renderToString`, `renderToStream`) | **Deprecated** | Removed in 3.0.0. Render on the server with the Rust walker (forma-server); its form controls differ from the walker's, see [SSR form controls](#ssr-form-controls). Logs `FORMA_W_DEPRECATED_SSR`. |
| Streaming SSR under strict CSP | **Known gap** | Suspense swap scripts carry no `nonce`, so a strict `script-src 'nonce-…'` blocks them and out-of-order content never swaps in. Use non-streaming SSR under strict CSP; do not add `'unsafe-inline'`. See [`../CSP.md`](../CSP.md). |
| TC39 Signals compat (`State`, `Computed`) | **Beta** | Tracks an evolving TC39 proposal |
| Development build (the `development` export condition) | **Beta** | Each subpath's `development` condition selects a twin under `dist/dev/` that keeps the `__DEV__` warnings; the CDN bundles have none. What the warnings say may change in any release. See [Development builds](#development-builds). |
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

`@getforma/core/server`, `@getforma/core/ssr`, `@getforma/core/wasm` and the
runtime's `reconcile()` keep working through 2.x and are removed in 3.0.0.

| Entry | Code | Instead |
|---|---|---|
| `@getforma/core/server` | `FORMA_W_DEPRECATED_SERVER` | A route in the application's Rust server, called with `fetch` |
| `@getforma/core/ssr` | `FORMA_W_DEPRECATED_SSR` | The Rust walker: forma-server renders the page |
| `@getforma/core/wasm` | `FORMA_W_DEPRECATED_WASM` | Core's `h()`, which islands already re-render with |
| `reconcile()` from `@getforma/core/runtime` | `FORMA_W_DEPRECATED_RECONCILE` | `mountMarkup(root, markup, { tier, grants })` |

The first time one of them is loaded in a [development build](#development-builds)
(for `reconcile()`, the first time it is called), it logs its code once, as `[forma] FORMA_W_DEPRECATED_SSR: …`, with what
replaces it. A production build logs nothing: its JavaScript is byte for byte
what it was before the deprecation, and `scripts/verify-dist.mjs` fails a build
that leaks a code into one. An installed package also shows the deprecation in
its type declarations, development or production: every function these entries
export is marked `@deprecated`, which editors strike through. The `FORMA_W_`
codes are listed here and nowhere else.

Verified by `src/__tests__/deprecated-entries.test.ts` > "$subpath logs its deprecation once in development, with its code"
Verified by `src/__tests__/deprecated-entries.test.ts` > "a production build of each deprecated entry carries no warning"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "reconcile behaves as at 2.0.x and warns once in development"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "a production build carries neither the grant report nor reconcile's warning"

## Development builds

Every dev-only diagnostic in core sits behind `__DEV__`: the deprecations
above, hydration mismatches, props the renderer drops, raw-HTML sinks, a
signal's debug name. `__DEV__` is true in a development build, which is one of:

- **The installed package, resolved with the `development` export
  condition.** Each subpath's `import` and `require` branch has a
  `development` key that selects a twin of its file under `dist/dev/`, built
  from the same sources with `__DEV__` folded to `true`; the type declarations
  are shared. Vite's dev server, webpack in development mode, Vitest and
  Bun's bundler set the condition themselves (Bun's even in a minified build,
  unless given `--production` or `NODE_ENV=production`, and Vitest in every
  test run unless told otherwise); esbuild, Rollup and Node set it only when
  told to (`conditions: ['development', 'module']`, `exportConditions`,
  `node --conditions=development`); `@getforma/build` sets it in watch mode.
  See [CDN-AND-EXPORTS.md](CDN-AND-EXPORTS.md#development-build), which has
  every resolver checked and how to keep a Vitest suite on production.
- **Core compiled from its source**: in Node with `NODE_ENV` other than
  `production`; in a browser bundle of the source, which has no `process`, only
  with the global `__FORMA_DEV__` set.

Everything else is a production build and logs none of it: the installed
package resolved without the condition (the files under `dist/` but
`dist/dev/`), and every CDN bundle. **The CDN bundles have no development
build**: `formajs-runtime.global.js`, its hardened and short-named copies, and
`forma.esm.js` exist in their production form only, so a page that loads core
from a CDN gets none of these warnings. To see them, install the package and
build with a bundler in development.

Verified by `src/__tests__/development-build.test.ts` > "every subpath resolves to production files without the condition and to their development twins with it"
Verified by `src/__tests__/development-build.test.ts` > "a process resolving with the development condition loads one copy of core, and it is the development build"
Verified by `src/__tests__/development-build.test.ts` > "a process resolving without the condition loads one copy of core, and it is the production build"

## Deprecated forms

Two forms keep working through 2.x and are refused in 3.0.0 (DR-19): a plain
string given to a raw sink, where `trustedHtml(markup)` is the typed form, and
`h('script')`. In a [development build](#development-builds) each logs its
code once, as `[forma] FORMA_W_RAW_SRCDOC: …`:

| Form | Code | Instead |
|---|---|---|
| A string as `dangerouslySetInnerHTML`'s `__html` | `FORMA_W_RAW_INNER_HTML` | `{ __html: trustedHtml(markup) }` |
| A string to `setHTMLUnsafe()` | `FORMA_W_RAW_SET_HTML` | `setHTMLUnsafe(el, trustedHtml(markup))` |
| A string to `template()` or `templateMany()` | `FORMA_W_RAW_TEMPLATE` | `template(trustedHtml(markup))` |
| A string to the runtime's `reconcile()` | `FORMA_W_RAW_RECONCILE` | `reconcile(container, trustedHtml(markup))` |
| A string as a `srcdoc` value | `FORMA_W_RAW_SRCDOC` | `srcdoc: trustedHtml(markup)` |
| `h('script')` | `FORMA_W_SCRIPT_ELEMENT` | A script in the page, or a module the build bundles |
| `data-bind:srcdoc`, or `{item…}` in a list row's `srcdoc`, in the HTML runtime | `FORMA_W_RAW_RUNTIME_SRCDOC` | The frame built with `h()` and `trustedHtml(markup)` |

Each raw sink logs for any value that is not `trustedHtml()`, a look-alike
object or a `String` object as much as a string. Under a page policy that
requires Trusted Types, as forma-server 0.2.2's Report-Only header does, such a
value at a raw sink is also reported by the browser, and refused where the
policy is enforced; a `trustedHtml()` value is not
([`../CSP.md`](../CSP.md#trusted-types)). A page that refuses one of core's two
policy names (its `trusted-types` directive does not list it, or another script
created it first) makes core write markup as strings, which it then refuses; a
development build logs `FORMA_W_TT_POLICY_REFUSED` once for each name.

Children given beside `dangerouslySetInnerHTML` (a function, or a value that is
not `null`, `undefined` or `false`) log `FORMA_W_INNER_HTML_CHILDREN` once in a
development build, from h() or from adoption: h() renders the markup and then
the children until the markup next changes, `./ssr` renders only the markup,
the compiler's walker only the children, and adoption keeps the markup and
binds none of the children. Give the element one or the other.

Verified by `src/dom/__tests__/trusted-html.test.ts` > "a string to each raw sink still renders, and warns once with the sink's code in development"
Verified by `src/dom/__tests__/trusted-html.test.ts` > "h('script') warns once in development and still builds the element"
Verified by `src/dom/__tests__/trusted-html-build.test.ts` > "a production build carries none of the raw-HTML warnings, in any artifact"
Verified by `src/dom/__tests__/trusted-html.test.ts` > "a refused policy name warns once in development, and the sinks then write strings the page refuses"
Verified by `src/dom/__tests__/adopt-inner-html.test.ts` > "children beside the prop warn once in development, in h() and in adoption, and a falsy prop does not"
Verified by `src/__tests__/runtime-srcdoc.test.ts` > "a list row's srcdoc writes its string and warns once with the runtime code"

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
