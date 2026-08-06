# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

A hardening release. A five-lens audit of 1.5.0 (docs-vs-behaviour, security,
reactive-core correctness, packaging, downstream contract) produced 38 confirmed
findings; this entry is the result of fixing them. The theme is that several
things the documentation promised were not true of the shipped code — most
importantly the headline CSP promise — so behaviour was changed to match the
promise rather than the other way round.

**If you are upgrading, read "Changed — breaking" first.** The suite went from
1007 tests to 1699 — but the number that moved is the one under "Test suite —
measured, not assumed": the share of injected defects the suite actually
detects.

### Changed — breaking

- **The regex expression parser and the `new Function()` fallback are gone.**
  Every build now evaluates `data-*` expressions with an allowlist AST
  interpreter (`src/expr/`): lexer, precedence-climbing parser, validator,
  tree-walking interpreter. **No shipped artifact contains `eval`,
  `new Function` or `with()`.** `setUnsafeEval()`, `isUnsafeEvalAllowed()`,
  `setUnsafeEvalMode()`, `getUnsafeEvalMode()`, `data-forma-unsafe-eval` and
  `__FORMA_RUNTIME_CONFIG.allowUnsafeEval` are **removed** — there is no
  fallback left for them to control. Code calling them must delete the call.
- **The grammar got bigger, not smaller.** Newly supported, with no
  `'unsafe-eval'`: arrow-function callbacks in `map` / `filter` / `find` /
  `findIndex` / `some` / `every` / `flatMap` / `reduce` / `sort` (the flagship
  README example runs again), object literals, `typeof`, unary `-`,
  general computed member access (`obj[k]`, `items[i + 1]`, `a.b[0].c`),
  member and computed assignment (`item.done = !item.done`, `obj.n += 1`),
  handler statements that are a bare method call (`$el.classList.toggle('x')`,
  `$refs.myInput.focus()`, `$dispatch('selected', {id})`), and the frozen
  namespaces `JSON`, `Object`, `Array`, `Date.now`, `Number`, `String`,
  `Boolean`, `parseInt`, `parseFloat` alongside `Math`.
- **Two silent wrong answers are now correct.** Unary `!` had the LOWEST
  precedence in the regex cascade, so `!a || b` computed `!(a || b)` and
  rendered the wrong value with no diagnostic. The ternary matcher was
  string-blind, so `{ok ? 'https://a' : 'https://b'}` — the commonest
  `data-bind:href` idiom — was rejected because of the `//` inside a string.
- **Three silent `undefined`s are now either working or reported.**
  `{q = $event.target.value}` parsed, emitted no diagnostic and wrote
  `undefined`; it now works. `{JSON.stringify(o)}` and `{Object.keys(o)}`
  parsed and returned `undefined`; they now work. `{items.push(x)}`,
  `{document.title}` and every other denial now report with a stable code
  (`FORMA_E_METHOD_DENIED`, `FORMA_E_UNRESOLVED`, …) and a column, and the
  binding leaves the DOM untouched instead of writing an empty string.
- **An unknown assignment target in a handler is an error, not a no-op.**
  `{coutn = 1}` used to run `scope.setters[name]?.(val)` and do nothing at all;
  it now reports `FORMA_E_ASSIGN_DENIED`.
- **Identifiers that are not declared state are errors.** The regex parser read
  an unknown name as `undefined`. `{missing ?? 'x'}` now requires `missing` to
  be a declared key (a key holding `null`/`undefined` is fine — the error is for
  names that do not exist at all).
- **A `formajs:diagnostic` event now fires once per distinct expression**
  rather than once per occurrence; the running total stays available through
  `getDiagnostics()`. A 1,000-row list sharing one denied expression used to
  dispatch 1,000 events.
- **`h()` now drops props whose name starts with `on` in ANY casing.** Detection
  was a case-sensitive two-character test, so `ONCLICK` / `Onerror` / `ONLOAD`
  skipped `addEventListener` and fell through to `setAttribute`, writing a real
  inline handler that the browser executes (SSR dropped these case-insensitively,
  so spreading server-supplied props produced clean HTML and an executing handler
  on the client). Apps that relied on writing an `ONCLICK` *attribute* break.
- **`h()` and hydration now drop dangerous-scheme URL attributes**, matching what
  the SSR renderer has always dropped: `javascript:`, `vbscript:` and
  `data:text/html` on `href`, `src`, `action`, `formaction`, `xlink:href`,
  `poster`, `background` and `data`. Previously the SSR-blocked payload was
  *re-added* on the client at hydration. A reactive URL binding whose value turns
  dangerous now **removes** the attribute rather than leaving the last accepted
  value.
- **`createStore` refuses `__proto__` / `constructor` / `prototype` writes**
  through both `setState` and the proxy's `set` trap. Previously a `__proto__`
  key — which `JSON.parse` creates as a real own property — replaced the store's
  prototype, letting untrusted JSON forge fields the app never defined.
- **Removed `renderToStringWithHydration`** from `@getforma/core/ssr`. It emitted
  a second, undocumented marker dialect that no client code could enter (adoption
  is driven per-island by `hydrateIsland` from a `data-forma-island` shell), and
  its docstring promised hydration it could not deliver.
- **Removed the `./runtime/global` and `./runtime-csp/global` exports subpaths.**
  The files still ship and still load by URL; they were never resolvable as
  modules, because an IIFE that assigns `var FormaRuntime = …` defines nothing
  when imported.
- **Deleted `dist/formajs.global.js`** (461 KB with its map). An undocumented
  orphan: no README row, no exports subpath, no `sideEffects` entry. Use
  `dist/forma.esm.js` to load the core from a CDN.
- **`engines.node` raised from `>=18` to `>=20.19.0`**, which is what the dev
  toolchain (vite) already required and what CI actually exercises.
- **Show adoption no longer re-inserts the server's DOM after a toggle.** When
  both branches render the same tag, adoption cannot tell which one the server
  produced; the adopted nodes are now dropped on the first swap away and the
  branch is rebuilt from its factory on return. Node identity across a full
  toggle round-trip is gone — that is the price of never guessing.
- **Adopted list rows re-run `renderFn` once at hydration** (in hydration mode:
  descriptors only, no DOM), which is what makes `onClick` and reactive props
  work on server-rendered rows. A `renderFn` with side effects therefore runs
  once on the server and once at adoption.
- **`MarkerMap.show` lost its `cachedContent` field** (public type change): it
  was always `null` and never read.

### Added

- **A hot-path benchmark suite** — `bench/*.bench.ts`, run with `npm run bench`
  (`bench:doc` regenerates the table, `bench:compare` diffs against the committed
  `docs/performance-baseline.json`). It covers signal-write → effect-flush,
  `h()` attribute writes split by which guards they pay for, `createList` render
  and keyed reconciliation, SSR adoption, island activation through both props
  channels, `renderToString`, and the CSP-safe interpreter against the
  `new Function` path it replaced. Every row reports median, p95 and run-to-run
  spread, so a later comparison can tell a regression from noise. Results,
  method, and a per-guard A/B against the pre-hardening tree are in
  [docs/PERFORMANCE.md](docs/PERFORMANCE.md).
- **Two regressions the hardening introduced are now measured and documented**
  rather than suspected: routing every list-row removal through
  `deactivateIslandsIn` costs ~15 µs per removed row (a `querySelectorAll` per
  row, +206% on a 1000-row teardown), and `handleGenericAttr` running the URL
  scheme check *before* its identity cache costs +50 ns on every no-op reactive
  URL write. Both have named fixes in the doc that keep the safety.
- **`sanitizePropsDeep(props)`** (root entry): strips `__proto__` /
  `constructor` / `prototype` at every depth, iteratively and cycle-safe. Island
  props remain **shallow-sanitized by default** — call this yourself before
  handing props to anything that deep-merges them. RPC arguments are already
  sanitized recursively without an opt-in; the two were previously documented as
  equivalent and are not.
- **`isUnsafeEvalAllowed()`** (`@getforma/core/runtime`): the live answer to
  whether the Function-constructor fallback can run.
- **`data-forma-expr-error="unsupported"`**: client-only DOM marker on an element
  whose expression could not be compiled, mirroring the existing
  `data-forma-handler-error`. Not part of the hydration wire contract; the Rust
  walker does not read it.
- **`activateIslands(registry, root?)`**: optional root, so a Shadow DOM subtree
  can be activated without touching the rest of the document.
- **`dist/forma.esm.js`**: a self-contained browser ESM bundle (alien-signals
  inlined, no code-split chunks), which is what makes the documented
  `<script type="module">` CDN recipe work. The old recipe pointed at
  `dist/index.js`, which imports the bare specifier `"alien-signals"` — a browser
  can resolve neither that nor the chunks. **Do not mix it with the npm entry in
  one app**; it carries its own copy of the core.
- **`@getforma/core/wasm`** is now built, typed and exported. `renderLocal` /
  `renderIsland` were announced as available "via direct import from the
  `@getforma/core/wasm` path" in 0.7.1 but had no build entry, no dist output and
  no exports key from 0.7.1 through 1.5.0, so the import always failed.
- **Duplicate-instance detection**: loading two copies of the core in one process
  (mixing `import`/`require`, or the browser bundle alongside the npm entry) now
  warns once. Signals, the owner tree and both registries are per-copy, so this
  used to present as "my signal updates nothing".
- `$event` and `event` now resolve in the CSP-safe handler parser, so
  `q = $event.target.value` and `if (event.key === 'Enter') { … }` compile with
  no eval. The former used to compile into an assignment of `undefined` with no
  diagnostic at all — silent data loss.
- `scripts/verify-dist.mjs` runs as the last step of `npm run build` and asserts
  properties of the real artifacts: exports targets exist, `require` conditions
  are `.cjs`, the browser bundle is self-contained, Node entries keep deps
  external, `__DEV__` is a literal, the hardened builds contain no
  `new Function`, and each file has at most one sourcemap footer.

### Test suite — measured, not assumed

The suite was mutation-probed one surgical break at a time against a corpus of
93 real defect shapes, now committed at `probes/corpus.json`. It detected
**64%** of them overall, **72%** on security-relevant code and **33%** on
`src/ssr/render.ts` — the one component whose output goes straight into a
browser. Re-run against the same corpus after the work below: **100%**,
**100%**, **100%** (three probes are marked equivalent-by-construction and
excluded, each with its proof written into the corpus entry; counting them as
survivors it is 90/93). Four of the defects the work found were live.

- **A shared renderer contract** (`src/__tests__/renderer-contract.test.ts`).
  FormaJS writes attributes through six independent sinks — SSR
  `renderToString`, `h()` static, `h()` reactive, hydration adoption, the
  `data-bind:` binder, and `$el.setAttribute()` in the CSP-safe grammar — and
  each guarantee used to be asserted thoroughly on exactly one of them. That
  habit produced 7 of the 25 code defects in `docs/HARDENING-AUDIT.md`. Dangerous
  URLs (8 vectors x all 8 `URL_ATTRS`), safe-URL negative space, event-handler
  names, attribute-name breakout, boolean-attribute semantics and text escaping
  are now asserted once, parameterised over every sink, with a completeness test
  that fails when a new attribute-writing module appears and does not join the
  table.
- **The mutation-probe corpus is committed** (`probes/corpus.json`,
  `node scripts/run-probes.mjs`). Anchors are re-checked on every PR; the full
  run is nightly with a detection floor. Every probe written during a future bug
  investigation goes in it.
- **The testing policy is written down and enforced.** CONTRIBUTING.md gains the
  eight rules and the reviewer's checklist; `src/__tests__/test-policy.test.ts`
  fails the build on a test with no `expect()`, a test file that touches no
  production code, `it.skip` / a self-skipping `existsSync` guard, a test whose
  only assertions are presence checks, a file that is 90% one identical
  assertion, and `vi.mock` of a first-party module without `importOriginal`.

### Fixed — security

- **`$el.setAttribute()` in the expression grammar was unguarded.** It was the
  only attribute sink in the repo with no safety check at all, so a CSP-safe
  `data-on:click` handler could write the `javascript:` href that `data-bind:href`
  refuses twenty lines away in the same file — and, because the name and the
  value both come from expressions that can read state, both halves were
  attacker-reachable. `setAttribute` and `toggleAttribute` now apply the same
  `isSafeAttrName` + `isUnsafeAttrWrite` predicate as every other sink and raise
  `FORMA_E_METHOD_DENIED` instead.
- **A non-function `on*` prop is dropped instead of registered.**
  `h('button', {onclick: 'alert(1)'})` — the inline-handler shape the SSR
  renderer refuses — used to reach `addEventListener` with a string. The string
  never ran; instead the first real click threw `listener.call is not a function`
  inside dispatch and took every other listener on that element down with it. An
  object with a `handleEvent` method is still accepted, because that is a real
  `EventListener`.

### Fixed — hydration and reactivity

- **`data-bind:` writes a bare attribute for `true`.** It wrote `String(true)`,
  producing `disabled="true"` where `h()`, hydration adoption, the SSR renderer
  and the Rust walker all produce a bare `disabled`. An SSR page and its bound
  self disagreed byte-for-byte on every boolean attribute.



- **SSR tag names are validated.** A `VNode.tag` is interpolated into markup with
  no escaping, so an attacker-controlled tag could inject an attribute
  (`div onload=x`) or close the tag. All three VNode branches (`render.ts` and
  both of `stream.ts`) now drop unsafe tags.
- **`data:image/svg+xml` now has a context rule** instead of being blanket-allowed:
  permitted for image-context sinks (`<img src>`, `<image href>`, `<video
  poster>`/`src`, `<audio src>`, `<source src>`, the legacy `background`
  attribute) where the browser decodes it in image mode, blocked for document
  sinks (`<iframe src>`, `<object data>`, `<a href>`, `<use href>`) where an
  `onload=` inside it fires, and blocked when the sink is unknown.
- **`srcdoc`** is recognised as a raw-HTML sink (attribute escaping does not
  neutralize it, because the browser entity-decodes and then parses the value as
  a document). Still emitted — a sandboxed `<iframe srcdoc>` is legitimate — with
  a dev-mode warning.
- **RPC argument sanitization no longer recurses.** `deepStripForbidden` walked
  fully attacker-controlled JSON recursively, before any authorization guard and
  outside `handleRPC`'s try/catch: a ~120 KB deeply nested body overflowed the
  stack, the `RangeError` escaped into `createRPCMiddleware`'s un-caught `await`,
  and Node's default `--unhandled-rejections=throw` killed the process.
  Remote, unauthenticated process kill. The walk is now iterative and
  `createRPCMiddleware` has an error barrier that answers 500.
- **A malformed `__forma_islands` block no longer stops every island on the
  page.** The shared props block was parsed with a bare `JSON.parse` before the
  island loop and outside any try/catch, so one truncated block — or an empty one,
  since `JSON.parse('')` throws — meant zero islands hydrated, including islands
  with inline props or no props. It now degrades to "no shared props". Only a
  real `<script id="__forma_islands">` is accepted; `getElementById` alone matched
  any element with that id, so a user-controlled node earlier in the document
  could supply every island's props.
- **A blocked expression no longer aborts runtime initialization.** The
  blocklist path threw instead of degrading to the existing noop, and the
  throw propagated out of `initRuntime`, so a single offending expression left
  every directive on the page unbound.

### Fixed — hydration and reactivity

- **Hydrated list rows dispose their effects.** Rows created after SSR adoption
  were rendered bare — no `createRoot`, no stored dispose — so their bindings
  stayed subscribed forever: not on row removal, not on island dispose. They now
  match the CSR path.
- **A failed island disposes what it built.** `__formaDispose` was assigned only
  *after* `hydrateIsland` returned, so a component that threw left every effect
  created before the throw live and unreclaimable, still reacting to signal
  writes inside an island marked `status="error"`.
- **Removing a list row tears down islands inside it.** An island's root is
  created with `createUnownedRoot`, so it deliberately does not die with the
  row's root — leaving its effects (and its `IntersectionObserver` / interaction
  listeners, if it had not hydrated yet) running against detached DOM.
- **One broken binding no longer freezes unrelated islands.** A throw inside
  alien-signals' flush aborted the flush, skipping every remaining queued
  binding, and surfaced at the unrelated setter's call site. Re-run errors now
  route to `reportError`/`onError` and the flush continues; the *first* run still
  propagates to its caller, so island activation can mark the island failed.
- **Reactive `className` / `htmlFor` / `tabIndex` survive adoption.** The
  hydration path wrote reactive attribute bindings using the raw prop key with no
  `PROP_TO_ATTR` mapping, producing a useless `classname="…"` attribute — the
  same component rendered correctly server-side and in CSR, then silently lost
  its class binding after hydration.
- **A show whose branch is directly a list is adopted.** `createShow(cond, () =>
  createList(…))` with no wrapper element left the SSR rows in place with no
  reconcile effect bound.
- **`unmount()` after the CSR fallback removes the right element.** When
  `hydrateIsland` replaces an empty SSR shell with the component's own root,
  clearing the detached original left the replacement in the document.
- Also fixed in adoption: `ref` props, event-handler attributes, island-shell
  skipping, digit-anchored marker parsing, duplicate-key ghost rows, and
  adopted-row rebinding.

### Fixed — packaging and build

- **`__DEV__` is a genuine build-time constant.** It is a module *export*, so
  esbuild's `define` never substituted it: no dev path was eliminated and the
  shipped bundles computed it at runtime from `process.env.NODE_ENV` — meaning
  every dev `console.warn`/`console.error` shipped and fired in any Node/SSR or
  bundler context where `NODE_ENV` was unset. The replaceable flag now has its
  own free-identifier name and the `NODE_ENV` fallback is gone from every shipped
  byte. `reportError`'s console fallback no longer re-reads the environment per
  error.
- **Syntax minification is on for all outputs**, which is what actually makes the
  build-time flags fold. Without it, `new Function(` was still present in
  `dist/runtime-hardened.js`, `.cjs` and `formajs-runtime-hardened.global.js`,
  contradicting every docstring that said otherwise. Identifiers and line
  structure are preserved, so nothing is obfuscated. This changes every shipped
  byte.
- **The build is reproducible.** `dist` is cleaned once up front instead of from
  inside parallel tsup configs, where the clean raced the other configs and
  deleted declaration files another config had already written. Two consecutive
  builds now produce 87 byte-identical files.
- **The size gate measures what the README claims.** It gzipped `dist/index.js`
  alone, a re-export shim, so moving code into a shared chunk — or growing one —
  was free. It now walks the real ESM import graph.
- **Types resolve everywhere.** `publint` reports "All good!" and
  `@arethetypeswrong/cli` reports 44 green cells / 0 problems, including node10
  resolution, which previously failed on all 8 subpaths.
- Every emitted file carried **two** `sourceMappingURL` footers (Rollup emits
  one, tsup appends another); they are collapsed to one and asserted.

### Performance

The hardening above was benchmarked after the fact (`npm run bench`,
`docs/PERFORMANCE.md`). Two of its changes cost a great deal; both are fixed with
the safety property intact, and the rest were measured and kept.

- **Removing a list row no longer scans the row for islands.** `reconcileList`
  ran `querySelectorAll('[data-forma-island]')` over **every** departing row,
  which cost ~19 µs per removed six-node row — paid by every list on every page,
  and almost none contain an island. `activateIslands` / `hydrateIslandRoot` now
  count scheduled-or-active islands and the scan is skipped when the count is
  zero; since an island cannot acquire anything to tear down without going
  through one of those paths, the guarantee is unchanged. Removing 1000 six-node
  rows went from 63.6 ms back to 45.7 ms, against 45.7 ms for the same removals
  done by hand with `removeChild` — i.e. back on the floor. Round trips over a
  1000-row list (append/prepend/remove + undo) are **~2.6× faster**.
- **A reactive URL attribute whose value has not changed no longer re-runs the
  scheme guard.** `handleGenericAttr` checked `isDangerousUrl` — an allocating
  `String.replace` plus two regexes — *before* the identity cache, so an
  unchanging `href` paid full price on every flush and then wrote nothing. The
  cache check moved ahead of the guard, which is safe because the reject path
  stores `null` rather than the refused string, so a refused value can never
  produce a cache hit. 76 ns → 28 ns per no-op write; a write whose value *does*
  change still pays for the guard and did not move.

`docs/PERFORMANCE.md` also now resolves the separate finding that `createList`'s
initial render is superlinear where the hand-built floor is linear: it is not the
per-row root, index signal or cache rebuild (3% of the gap), but happy-dom's
array-backed child lists, which make `insertBefore` before a marker and mounting
a `DocumentFragment` quadratic. Both are O(1) in a browser. Three new floors in
`bench/list.bench.ts` carry the evidence.

### Documentation

Every claim in `README.md`, `SECURITY.md` and `CSP.md` was re-checked against the
code, and the ones that assert a security or behavioural property now cite the
test that proves them.

- The flagship "single HTML file" showcase used arrow functions in
  `data-computed` and `data-list`, which the CSP-safe parser rejects — the
  example presented as proof of the zero-build CSP-safe story disproved it. It is
  replaced with markup that a test mounts against the *hardened* build.
- The `createHistory` snippet could not run: it showed a tuple return taking a
  plain initial value, while the real signature takes a `[get, set]` tuple and
  returns a `HistoryControls` object (`TypeError: source is not iterable`).
- `SECURITY.md` called the `with()` + `Proxy` wrapper a sandbox. It is not: the
  `has` trap returns `key in scope.getters`, so any undeclared identifier reports
  `false` and `with()` falls through to the real globals — `document`, `fetch`,
  `localStorage` are all reachable. Only the blocklisted names are stopped.
- The `$el` / `$refs` / `$dispatch` examples in the directive table are handlers
  whose whole body is a method call, which the CSP-safe grammar does not accept;
  they are now marked as needing the opt-in.
- Corrected: every CDN pin (was `1.0.7`), the alien-signals repository link, the
  size figures (the runtime is 25.6 KB gzipped, not "~24 KB"; the core entry is
  24.7 KB untree-shaken, not "~8 KB"), the island coverage figure, the
  `@getforma/core/tc39` shape (it exports `State` and `Computed` — there is no
  `Signal` namespace), and the Supported Versions table (it listed only `1.0.x`
  while 1.5.0 was on npm).
- Added: an *Escape hatches — the trust boundary* section naming the four
  unsanitized HTML sinks (`dangerouslySetInnerHTML`, `setHTMLUnsafe`,
  `reconcile`, `srcdoc`), which appeared in no document while `CSP.md` answered
  "innerHTML — FormaJS uses it? No"; sections for `createResource`,
  `createSuspense`, `svg()` and `createPortal`; a table covering the rest of the
  export surface; and a *Known gaps* section in `SECURITY.md`.
- `src/__tests__/docs-truth.test.ts` now checks the mechanically checkable
  claims — version pins, artifact names, export coverage, the tc39 shape, the
  coverage figure, the size limits — so this class of drift fails CI instead of
  waiting for an audit.

### Note on 1.1.0

`getOwner`, `runWithOwner`, `getSignalName`, `value`, `Owner` and
`ResourceFetcherInfo` are listed as "Added" under 1.1.0, but were not re-exported
from the package root until commit `bf35b21` on this branch. Until then they were
reachable only by deep import.

## [1.5.0] - 2026-07-08

Storage / component / wasm robustness. Stacks on 1.4.0.

### Fixed
- **IndexedDB durability**: writes now resolve on transaction commit
  (`tx.oncomplete`), not request success, so a write whose transaction aborts
  (e.g. `QuotaExceededError` at commit) is reported as a failure, not success.
- **IndexedDB connections**: wire `onversionchange`/`onclose` (close + evict) so
  a version bump from another tab/store is not blocked forever; a blocked bump
  settles instead of leaking; a broken/store-less connection is evicted so the
  next call reopens. Concurrent creation of multiple object stores on one
  database is serialized so no store is lost or wedged.
- **`createLocalStorage`/`createSessionStorage`**: `remove()` degrades gracefully
  when storage access throws, matching `get`/`set`.
- **Component disposal**: a component that returns a `DocumentFragment` can now be
  disposed via any of its (now-detached) child nodes — the dispose handle was
  previously stranded on the emptied fragment and leaked.
- **Context**: values provided during a component's setup/mount are auto-removed
  on that component's dispose (by unique frame, so a sibling's value is never
  disturbed); a `setup()` that throws after `provide()` no longer leaks; the
  long-inaccurate "teardown pops automatically" docstring is now true.
- **WASM loader**: `getIR` checks `response.ok` (no longer caches a 404/500 error
  page as IR), and the wasm instantiate + IR fetch are memoized as in-flight
  promises (one per page) with retry-on-failure.
## [1.4.0] - 2026-07-08

Server / SSR robustness. Stacks on 1.3.0. Adds an RPC authorization hook.

### Added
- **RPC authorization guard** (`@getforma/core/server`): `setRPCGuard(fn)`
  (global) or the `authorize` option on `handleRPC`/`createRPCMiddleware`.
  `handleRPC` still performs no authentication by itself — this is the injection
  point. A guard that throws or rejects fails closed (403, no error leak).
- **`StreamOptions.suspenseTimeout`**: cap how long streaming SSR waits for each
  Suspense boundary; on timeout the fallback stays and the stream terminates
  instead of holding the connection open forever.

### Fixed
- **RPC arguments are sanitized**: deep-stripped of `__proto__`/`constructor`/
  `prototype` before the server function runs, so a deep-merging function cannot
  pollute `Object.prototype`. Safe on frozen/sealed arguments.
- **`createRPCMiddleware`** now enforces the `X-Forma-RPC: 1` header and a JSON
  content type (CSRF mitigation), resolves the endpoint path without the query
  string (a `?query` used to 404), and returns accurate status codes
  (400/403/404/415/500) instead of 500 for everything.
- **Streaming SSR** resolves a nested Suspense inside resolved content via its
  own swap (was emitted literally); a synchronous throw in a Suspense resolver no
  longer aborts the whole stream (the shell/fallback are preserved).
## [1.3.0] - 2026-07-08

DOM correctness. Stacks on 1.2.0. Adds the `svg()` helper and completes
`data-model`.

### Fixed
- **Reconciler cache is per-container.** A single reconciler instance shared one
  last-HTML cache, so reconciling a second container to the same HTML as the
  first was a no-op. Keyed per container.
- **Keyed lists no longer drop duplicate-keyed rows past 32 items.** The
  large-list diff path collapsed duplicate keys; it now consumes occurrences
  one-per-match like the small path.
- **`data-list {index}`** is the true loop index (was `indexOf`, wrong for
  duplicate/primitive items and O(n^2)).
- **Islands**: `activateIslands()` re-run no longer double-hydrates/double-binds;
  visible-trigger observers, idle timers, and interaction listeners are torn down
  by `deactivateIsland`/`deactivateAllIslands` (previously leaked and could
  zombie-hydrate); a disposed island cannot be resurrected by a stray callback.
- **Suspense** whose resolved content is a `DocumentFragment` no longer
  duplicates or loses content across re-suspend/re-resolve.
- **CSP expression parser** no longer mis-splits operators inside string literals
  (`{'a' + '-' + 'b'}`), and arithmetic/comparison are correctly left-associative
  (`10 - 3 - 2 === 5`, `12 % 5 % 3 === 2`).

### Added
- **`svg(build)`** context helper so nested `h()` calls create SVG-namespaced
  elements, including dual-use tags like `<a>`. Without it, dual-use tags default
  to HTML.
- **`data-model`** now supports radio groups, `<select multiple>`, an opt-in
  `data-model-indeterminate` companion, member-path targets (`{item.name}`), and
  guards numeric input against writing `NaN` (empty clears to `null`).

### Known limitations
- `svg()` resolves tags by explicit context (no parent-walk); `foreignObject`
  descendants stay SVG; MathML is unsupported.
- The reconciler/`parseHTML` `innerHTML` paths are a trust boundary — do not feed
  them attacker-controlled markup.
## [1.2.0] - 2026-07-08

State layer correctness. Stacks on 1.1.0. Several fixes change observable
behavior (they correct bugs), hence a minor bump.

### Fixed
- **Store array mutations are now reactive.** `push`/`pop`/`shift`/`unshift`/
  `splice`/`sort`/`reverse`/`fill`/`copyWithin`, `delete state.x`, and
  `arr.length = n` now notify subscribed effects (they previously deleted the
  path signals, orphaning subscribers). Effects reading an array itself, its
  `length`, or an index re-run correctly.
- **Store proxy identity**: an object aliased at two paths now gets a
  path-bound proxy (writes notify the correct path); the orphaning inline
  signal cache was removed; stale proxies are evicted on replace/delete.
- **Store**: re-assigning the identical object no longer orphans descendant
  subscribers; a stored function value (e.g. an array method read as a path) is
  no longer misread as a functional updater.
- **History** snapshots entries (in-place mutation can't corrupt past states),
  is batch-safe (an external set batched with `undo()` is recorded; a custom
  `equals` no longer leaks the ignore flag), clamps `maxLength >= 1`, and adds
  `destroy()`.
- **Persist**: cross-tab sync, versioned migration, an `onError` hook, and a
  disposer; JSON parsing stays prototype-pollution-safe.

### Known limitations
- Coarse array own-path reactivity: reading an array subscribes to its mutations
  (SolidJS-style), so unchanged-length mutations still re-run array-level effects
  (values are always correct).
- `createHistory` requires a signal with a stable value; a store-proxy slice that
  returns a fresh proxy per read is not supported.
- `Map`/`Set`/`Date` values and `Object.keys`/`for...in` remain non-reactive.
## [1.1.0] - 2026-07-08

Reactive-core correctness. Several fixes change observable behavior (they correct
long-standing bugs), hence a minor bump. Stacks on the 1.0.10 security release.

### Fixed
- **Effect cleanups are no longer dropped.** The `skipCleanupInfra` fast-path
  latched after a clean first run and then silently discarded — or cross-registered
  onto a sibling — any `onCleanup()`/returned cleanup registered on a later run.
- **An effect that writes a signal it depends on now re-runs** to observe the value
  (alien-signals swallowed the self-notify). Detection is precise: writes to signals
  the effect does not depend on do not cause a spurious re-run; genuine cycles are
  bounded and reported.
- **Nested effects are owned by their parent generation**, so their cleanups run when
  the parent re-runs and on disposal (previously leaked via alien's raw teardown).
  Teardown order is children-before-parents on both the re-run and dispose paths.
- **`createRoot` dispose() during setup** now defers teardown so work created after
  the call is also disposed (was a permanent leak).
- **Computed getters cache and rethrow errors** until a dependency changes (TC39/Solid),
  instead of returning a stale value; errors route through `onError`.
- **`createResource`**: a synchronously-thrown fetcher is captured (loading cleared,
  Suspense balanced); the `AbortSignal` is passed to the fetcher and aborted on
  refetch and on dispose; loading/error transitions are batched (no glitch frame).
- **`equals: () => false`** now force-notifies for identical references ("always
  notify"), not only suppresses.
- **`SignalOptions.name`** no longer breaks `isSignal()` (stored in a side table).

### Added
- `getOwner()` / `runWithOwner()` for owning work created outside the synchronous
  root scope; `getSignalName()`; `ResourceFetcherInfo`.
  **Correction:** these were reachable only by deep import until the root-barrel
  fix on the unreleased branch — see [Unreleased] > *Note on 1.1.0*.
- `onError()` supports multiple handlers and returns an unsubscribe function.

### Changed
- `__DEV__` defaults to production-safe (false) when the environment is
  indeterminate; opt into dev via a global `__FORMA_DEV__`.
## [1.0.10] - 2026-07-08

### Security
- **SSR `javascript:`/`vbscript:` URI filter no longer bypassable with control characters.** Browsers strip tabs/newlines/control chars from a URL scheme before interpreting it, so payloads like `java\tscript:alert(1)` executed despite the old contiguous-string check. Scheme detection now normalizes the value the same way the browser does before testing (`src/security/url-safety.ts`, used by `src/ssr/render.ts` and `src/ssr/stream.ts`).
- **`data-bind:*` and `data-list` row templates can no longer inject `javascript:` URLs or inline event handlers.** The `setAttribute` sinks now reject `on*` attribute names and dangerous URL schemes, in **both** the standard and hardened/CSP runtime builds (the sinks were identical in both; hardening previously only blocked `eval`).
- **SSR attribute-name handling hardened.** Event-handler filtering is now case-insensitive (`OnClick` was previously emitted), and malformed prop keys (e.g. containing whitespace/`=`) can no longer inject additional attributes. Renderer and streaming paths share one `renderAttr` helper so the rules cannot drift.

### Docs
- Corrected the inaccurate "~15 KB gzipped" size claim across `package.json`, `README.md`, and the runtime header: the core entry is ~8 KB gzipped and the full CDN runtime bundle is ~24 KB gzipped.
- `SECURITY.md` / `CSP.md` updated to match actual behavior.

### CI
- Bundle-size gate now enforces a limit on the CDN runtime bundle too (previously only `index.js` was gated; the larger runtime bundle was printed but never enforced). Limits: index ≤ 12 KB, runtime ≤ 28 KB gzipped.

### Chore
- Backfilled changelog entries for 1.0.2–1.0.9 (below).

## [1.0.9] - 2026-04-10

### Fixed
- Use `createUnownedRoot` in `mount`/`activateIslands`; auto-register `createRoot` with its parent plus disposal cleanup in primitives.

## [1.0.6] - 2026-03-31

### Fixed
- **CSP-safe style handling** — replaced `cssText` assignment with CSSOM parsing so inline styles work under a strict Content-Security-Policy.

### Docs
- Added the CSP guide (`CSP.md`) covering strict-CSP handling, common issues, and version history.

## [1.0.8] - 2026-03-27

### Fixed
- Default `elseFn` in `createShow` to prevent a crash when called with two arguments.

## [1.0.7] - 2026-03-17

### Fixed
- `createFetch` fire-and-forget `execute()` now `void`-prefixed.
- SVG `className` crash and array return from function children.
- `createFetch` uses `window.location.origin` as the default base URL.

### Changed
- CI Node matrix updated 18 → 20/22/24.

## [1.0.5] - 2026-03-16

### Fixed
- Export `template` and `templateMany` from the main barrel.
- SVG `className` crash and array return from function children; `createFetch` default base URL.

### Notes
- 1.0.2–1.0.4 were docs/packaging/CI iterations (npm keywords, issue templates, TypeDoc GitHub Pages deploy, trusted publishing (OIDC) migration) with no runtime code changes.

## [1.0.1] - 2026-03-16

### Fixed
- **IIFE global builds no longer minified** — Socket.dev flagged single-line minified files as "obfuscated code" (high severity false positive). IIFE builds are now unminified multi-line code. CDNs serve with gzip/brotli anyway so the wire size impact is negligible. Users who need minification use their own bundler.

## [1.0.0] - 2026-03-16

### BREAKING CHANGES
- **HTTP, storage, and server modules moved to subpath exports.** The main `@getforma/core` entry point no longer includes network-capable code. Import from the new subpaths:
  - `import { createFetch, createSSE, createWebSocket } from '@getforma/core/http'`
  - `import { createLocalStorage, createSessionStorage, createIndexedDB } from '@getforma/core/storage'`
  - `import { createAction, $$serverFunction, handleRPC } from '@getforma/core/server'`
- The main bundle (`dist/index.js`, `dist/index.cjs`) now has **zero `fetch`, zero `WebSocket`, zero `process.env`** — improving supply chain security scores.

### Why 1.0.0
- Subpath exports lock in the final API shape
- Security hardening complete (CSP bypass fixed, `$el` sandboxed, SSR injection fixed)
- alien-signals 3.x integrated with `SignalOptions.equals`, type guards, `trigger`
- 811 tests, full TypeDoc coverage, zero warnings
- Production-proven in GateWASM auth system

## [0.9.1] - 2026-03-15

### Changed
- **Hardened builds now have zero `new Function` in dist** — added compile-time `__EVAL_CAPABLE__` constant that esbuild constant-folds to `false` in hardened builds, enabling dead code elimination of all `new Function()` paths. Socket.dev/Snyk static analysis will no longer flag eval usage in hardened builds.
- **Exported 31 missing types** for TypeDoc — all parameter and return types of public functions are now properly exported (SignalGetter, SignalSetter, FetchOptions, SSEConnection, StoreSetter, etc.). `npm run docs` now generates with 0 warnings.

## [0.9.0] - 2026-03-15

### Added
- **`data-ref` directive and `$refs` magic** — register elements with `data-ref="name"` and access them from expressions via `$refs.name`. Refs are scoped to their `data-forma-state` parent. Supports reading properties (`$refs.input.value`), calling methods (`$refs.input.focus()`), and manipulating classes (`$refs.panel.classList.toggle('open')` via unsafe-eval path).
- **TypeDoc API reference generation** — `npm run docs` generates API documentation from JSDoc comments to `api-docs/`. Added `typedoc` dev dependency and `typedoc.json` config.

## [0.8.2] - 2026-03-15

### Docs
- Added jsDelivr CDN URLs alongside unpkg
- Added ESM import example for modern browsers (no bundler)
- Added version pinning guidance for production
- Updated runtime.ts header with all 6 design inspirations, complete file map, build output documentation, and monolith rationale

## [0.8.1] - 2026-03-15

### Added
- **Reactive introspection APIs** (from alien-signals 3.x):
  - `isSignal(fn)` — type guard: is this a signal getter?
  - `isComputed(fn)` — type guard: is this a computed value?
  - `isEffect(fn)` — type guard: is this a raw effect?
  - `isEffectScope(fn)` — type guard: is this an effect scope?
  - `getBatchDepth()` — returns current batch nesting depth (0 outside batch)
  - `trigger(fn)` — force a computed/effect to recompute even if dependencies unchanged
- **`createComputed` now receives previous value** — the getter function receives `(previousValue?: T)` for efficient diffing patterns without a separate signal
- **`createRoot` now uses alien-signals `effectScope`** — native graph-level effect tracking replaces the userland disposer array for reactive cleanup. Userland disposers (event listeners, timers) still use the array.

## [0.8.0] - 2026-03-15

### Changed
- **Upgraded alien-signals from 1.0.x to 3.1.2.** Replaced `pauseTracking`/`resumeTracking` with `getActiveSub`/`setActiveSub`. This brings the v2 Pending flag optimization (fewer intermediate recomputations) and aligns with Vue 3.6's reactivity engine.

### Added
- **`SignalOptions.equals` — custom equality for `createSignal`.** When provided, the setter reads the current value and only updates the signal if `equals(prev, next)` returns `false`. Works with both literal and functional setters. Previously declared in the type but never wired up — now fully functional.

```typescript
const [pos, setPos] = createSignal(
  { x: 0, y: 0 },
  { equals: (a, b) => a.x === b.x && a.y === b.y },
);
setPos({ x: 0, y: 0 }); // skipped — values are equal
setPos({ x: 1, y: 0 }); // applied — values differ
```

- TC39 compat `Signal.State` now passes `equals` through to `createSignal` natively instead of wrapping with its own setter logic.

## [0.7.1] - 2026-03-15

### Fixed
- **CSP parser operator precedence:** Arithmetic now correctly evaluates before comparison (`a + b > c` = `(a+b) > c`), and AND binds tighter than OR (`a || b && c` = `a || (b&&c)`). Previously produced silent wrong results for compound expressions.
- **Store `deepClone` circular reference guard:** `setState(prev => ...)` no longer stack-overflows on stores with circular references.

### Changed
- **Removed `SignalOptions.equals`:** Was declared in the type but never wired to alien-signals. Removed to prevent false API expectations. TC39 compat `Signal.State` retains its own local `equals` option.
- **Removed `renderLocal`/`renderIsland` from main exports:** These WASM-only functions throw without `window.__FORMA_WASM__` config. They remain available via direct import from `@getforma/core/wasm` path but no longer appear in the main barrel export.
- **Documented store `ownKeys` limitation:** `Object.keys()`, `for...in`, and spread are not reactive on store proxies.

## [0.7.0] - 2026-03-15

### Security
- **`$el` sandbox escape blocked:** `$el` is now wrapped in a safe Proxy that allowlists DOM properties (classList, dataset, style, value, focus, etc.) and blocks access to `ownerDocument`, `parentNode`, `innerHTML`, and any chain that reaches `window`/`document`. Applies to BOTH standard and hardened builds.
- **SSR swap script injection fixed:** `getSwapTag` now escapes `<` as `\u003c` and `>` as `\u003e` in JSON-serialized content, preventing `</script>` from breaking the inline script block during Suspense streaming.
- **Island props sanitized:** `loadIslandProps` now strips `__proto__`, `constructor`, and `prototype` keys from JSON-parsed props (inline and shared script block), matching the sanitization already done by `parseState`.
- **`escapeAttr` strengthened:** Now escapes `<`, `>`, and `'` in addition to `&` and `"`. Blocks `javascript:`, `vbscript:`, and `data:text/html` URIs in `href`, `src`, `action`, and `formaction` attributes across all SSR render paths.

## [0.6.1] - 2026-03-15

### Added
- **C1:** Tests for `suspense-context.ts` — 9 tests covering push/pop stack, LIFO ordering, empty stack safety
- **C2:** Tests for `rpc-client.ts` and `rpc-handler.ts` — 37 tests covering endpoint routing, FORBIDDEN_KEYS protection, error sanitization, fetch mocking, revalidation events
- **C7:** Tests for `reducer.ts` — 8 tests covering tuple return, reactivity, complex state, counter patterns

### Fixed
- Moved internal planning documents (hardening plan, Turbo Streams evaluation) out of public repo

## [0.6.0] - 2026-03-15

### Added
- **S6:** Real `idle` and `interaction` hydration triggers — `idle` defers via `requestIdleCallback` (with `setTimeout` fallback for Safari), `interaction` hydrates on first `pointerdown` or `focusin`. No more stubs.
- **S3:** Function components in `h()` — `h(Counter, {count: 5})` now calls the function with merged props and children. CSR-only (no hydration descriptors or SSR).
- **S7:** Turbo Streams design evaluation — documented that existing `createSSE` + `reconcile()` covers the use case without new abstractions.

### Fixed
- **C3:** Hydrated event listeners now use AbortController — `cleanup(el)` properly removes event listeners attached during island hydration, matching the pattern from `element.ts`.
- **C8:** Standardized HTTP module import paths — `forma/reactive/index.js` → `forma/reactive` in fetch, SSE, and WebSocket modules.

## [0.5.1] - 2026-03-15

### Changed
- **S1:** `createComputed` JSDoc clarified — documents that it is a lazy cached derivation (equivalent to `createMemo`), unlike SolidJS's eager `createComputed`
- **C4:** Removed `longestIncreasingSubsequence` from public API — internal algorithm no longer exported from `@getforma/core`
- **C5:** Removed deprecated `createValueSignal` — all internal usage migrated to `createSignal`. The `ValueSignalSetter` type is also removed.

### Added
- **S4:** `$el` and `$dispatch` magics in the HTML Runtime — `$el` resolves to the current element, `$dispatch(name, detail?)` fires a `CustomEvent` with `bubbles: true` and `composed: true` (crosses Shadow DOM boundaries)
- **H4:** `compiledTemplateCache` now capped at 2048 entries with FIFO eviction, matching `expressionCache` pattern

### Fixed
- **C6:** Component lifecycle errors (`onMount`, `onUnmount`, disposers) now reported via `reportError` instead of silently swallowed — surfaces through `onError()` handler with correct `source` field

## [0.5.0] - 2026-03-15

### Security
- **H2:** `findBlockedMethod` hardened against computed bracket access bypass — string concatenation inside brackets (e.g., `x['constr' + 'uctor']`) is now detected and blocked. Defense-in-depth proxy traps added to both expression and handler evaluation paths.
- **H1:** SSR streaming (`stream.ts`) now validates `dangerouslySetInnerHTML` shape — previously used a direct type assertion cast with no validation, risking runtime crashes or unexpected HTML in streamed SSR output.
- **H5:** Removed relaxed JSON parser from `parseState` — the `RE_UNQUOTED_KEYS` regex corrupted URLs and string values containing colons. `data-forma-state` now requires valid JSON (breaking change for unquoted-key users).

### Added
- `deactivateIsland(el)` — dispose a single island's reactive root and all effects
- `deactivateAllIslands(root?)` — dispose all active islands under a root element (for module swap cleanup in `<forma-stage>`)

### Fixed
- **H3:** Island memory leak — `__formaDispose` was stored on island elements but never called. Every module swap leaked a `createRoot` scope with all effects, listeners, and signal subscriptions.

## [0.4.0] - 2026-03-15

### Changed
- **BREAKING:** `IslandHydrateFn` signature changed from `(props) => unknown` to `(el, props) => unknown` — island callbacks now receive the root `HTMLElement` as the first argument for layout measurement, focus management, CSS class toggling, and third-party library integration

### Docs
- Added "Getting Started with a Bundler" section (Vite setup)
- Consolidated CDN URLs into a clear table with all filename variants
- Documented lifecycle semantics (`onMount` cleanup vs `onUnmount`)
- Added error handling section (`mount()` fail-fast, `onError()`, `createErrorBoundary`)
- Added Solid comparison table
- Added feature stability matrix
- Expanded ecosystem table with all Forma packages (Rust crates + npm)

## [0.3.0] - 2026-03-14

### Security
- SSR swap script injection: both args use `JSON.stringify` to prevent XSS
- Proto-pollution guard: `__proto__`, `constructor`, `prototype` stripped from `parseState()`
- Expanded unsafe method blocklist: `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__`, `eval`
- RPC handler no longer leaks internal error messages to clients (dev-only in development mode)

### Changed
- `EventBus` constraint changed from `Record<string, any>` to `Record<string, unknown>` (stricter public API)
- `ListDescriptor` fields changed from `any` to `unknown` (stricter hydration types)
- `$$serverFunction` generic changed from `any` to `unknown`
- `alien-signals` pinned to `~1.0.0` (uses internal APIs, minor bumps could break)
- `createEffect` removed from tsup `pure` list (has side effects — tree-shakers could silently drop user calls)
- `enableAutoRevalidation()` guarded against SSR (checks `typeof window`)

### Added
- `setHTMLUnsafe()` method (preferred name), `setHTML()` deprecated with JSDoc warning
- Storage `validate` type guard option for `createLocalStorage` and `createSessionStorage`
- `parse` option for `createWebSocket` and `createSSE` custom message deserialization
- `runtime-hardened.d.ts` auto-copied from `runtime.d.ts` in post-build
- GitHub Actions CI pipeline (Node 18/20/22 matrix, Playwright E2E, bundle size check)
- GitHub Actions release pipeline (automated npm publish on `v*` tags with provenance)

## [0.2.0] - 2026-03-13

### Added
- HTML Runtime: Alpine-like declarative API via `data-*` attributes with CSP-safe expression parser
- Runtime hardened mode: `new Function()` locked off for strict CSP environments
- Playwright E2E test suite (27 tests across 10 directive groups)
- CDN global builds: `formajs-runtime.global.js` and `formajs-runtime-hardened.global.js`

## [0.1.0] - 2026-03-13

### Added
- Reactive primitives: createSignal, createEffect, createComputed, createMemo, batch, untrack
- Real DOM: h(), mount(), fragment, createText — creates actual DOM elements, no virtual DOM
- Conditional rendering: createShow, createSwitch
- List rendering: createList with keyed reconciliation
- Islands architecture: activateIslands(), hydrateIsland()
- Component lifecycle: defineComponent, onMount, onUnmount, createContext, provide/inject
- State management: createStore, createHistory, persist
- DOM utilities: $, $$, addClass, removeClass, onResize, onIntersect
- Events: createBus, delegate, onKey
- HTTP: createFetch, fetchJSON, createSSE, createWebSocket
- Storage: createLocalStorage, createSessionStorage, createIndexedDB
- SSR runtime: server-side rendering support
- WASM loader: forma-wasm integration
- Runtime hardened mode: locked-off unsafe eval
