# FormaJS hardening audit - 2026-08-05

A five-lens audit (docs-vs-behavior, security, reactive-core correctness,
packaging/CI, downstream contract) of @getforma/core 1.5.0. Every finding below
was adversarially re-verified against the source before landing here; 54 raw
findings produced 38 confirmed, 1 confirmed-with-caveats, 15 recommendations,
and 0 that survived as false positives.

Every entry below is now closed. Each carries a **Fixed:** line saying what
actually changed and one or more `Verified by:` citations naming the test that
proves it — same convention as the source comments (CONTRIBUTING.md, "Comments
that assert must cite their proof"). Those citations are machine-checked: see
src/__tests__/docs-truth.test.ts > "every citation names a test file that exists
and a test that is in it".

Two entries record a deliberate residual rather than a clean close, and say so
in their own words: `dual-package-and-hardened-state-duplication` (the shipped
module topology still permits two copies — the fix is runtime detection, not
prevention) and `dev-flag-define-is-inert-in-dist` (guarded call sites that
cross a chunk boundary survive in the bundle; they cost bytes but cannot run).

Scope note: this ecosystem has no external users - ksx Studio is the only real
consumer. Breaking app-facing behaviour or public API is acceptable; the FMIR
binary layout and the hydration wire contract (`f:tN`/`f:sN`/`f:lN`/`f:iN`
markers, `data-forma-*` attributes, the `__forma_islands` protocol) are not,
because the Rust walker and ksx depend on them byte-for-byte.

## Confirmed findings

### Critical

#### `csp-safe-by-default-is-false-in-shipped-standard-build` - FIXED

*src/runtime.ts:350*

The headline CSP promise is false for the build every README/CDN snippet points at. The standard `formajs-runtime.global.js` / `dist/runtime.js` ships with the `new Function()` fallback ENABLED by default, and it is used silently for any expression the hand-written parser cannot handle. README.md:234 ("no `eval()`, no `new Function()` by default"), README.md:349, CSP.md:3 ("CSP-safe by default. No `unsafe-inline` or `unsafe-eval` required"), CSP.md:56 (table row `new Function(...)` → "FormaJS uses it? **No**") and SECURITY.md:27 ("`new Function` is present but only reached when `_allowUnsafeEval` is explicitly enabled") all state the opposite. Under the strict header CSP.md:87-95 recommends (`script-src 'nonce-…' 'self'`, no `unsafe-eval`), `new Function` throws EvalError, the catch at src/runtime.ts:2062 swallows it, and the expression silently evaluates to `undefined` — the page renders wrong with only a console message.

**Fixed (first pass):** `_allowUnsafeEval` started `false` in every build. The build define chose whether the fallback CAN be enabled (`mutable`) or is compiled out (`locked-off`), never whether it IS on, and an expression outside the CSP-safe grammar degraded to a diagnostic + `data-forma-expr-error` instead of silently evaluating to `undefined`. README/CSP.md/SECURITY.md rewritten to match.

**Fixed (finally):** turning the fallback off exposed the second half of the problem — the regex parser's grammar was too small to run the README's own flagship example, which rendered "Found undefined results" and an empty list. Both halves are now gone: the regex cascade and the `new Function` fallback were deleted and replaced by the allowlist AST interpreter in `src/expr/`, so there is no posture to configure and no fallback to leave on. See CHANGELOG > *Unreleased* and SECURITY.md > *Supply Chain Security Notes*.

Verified by: `src/__tests__/runtime-csp-default.test.ts` > "no build can reach new Function, with any configuration"
Verified by: `src/__tests__/readme-flagship.test.ts` > "binds every directive in the block with zero diagnostics"
Verified by: `src/__tests__/runtime-csp-default.test.ts` > "never constructs a function, not even one that would have succeeded"
Verified by: `src/__tests__/runtime-csp-default.test.ts` > "marks the element with data-forma-expr-error when an expression cannot be compiled"

#### `client-url-attr-xss-h` - FIXED

*src/dom/element.ts:422*

The client DOM path (`h()` and hydration) writes URL-bearing attributes (href/src/action/formaction/poster/xlink:href) with no dangerous-scheme check, while the SSR renderer drops them. Any Forma app that renders a URL from server/user data — the documented `h("img", { src: item.art })` / `h("a", { href: item.url })` pattern — is a stored-XSS sink on the client, and the SSR-blocked payload is *re-added* at hydration.

**Fixed:** `h()`'s static and reactive attribute paths, the xlink path and hydration adoption all route through `isUnsafeAttrWrite` — the same predicate the SSR renderer uses — so the client drops exactly what the server drops and cannot re-add a blocked payload at hydration.

Verified by: `src/dom/__tests__/element-url-safety.test.ts` > "drops exactly what the SSR renderer drops, so hydration cannot re-add it"
Verified by: `src/dom/__tests__/element-url-safety.test.ts` > "drops a javascript: href written through h()"
Verified by: `src/dom/__tests__/element-url-safety.test.ts` > "drops URL schemes obfuscated with control characters"

### Major

#### `readme-showcase-example-cannot-run-on-hardened-build` - FIXED

*README.md:206*

The README's flagship "what you get from a single HTML file with one script tag" example uses arrow functions inside `data-computed` and `data-list` (`items.filter(i => i.toLowerCase().includes(query.toLowerCase()))`). The CSP-safe parser explicitly rejects arrow functions, so this example does not work on the hardened build that README.md:237 tells strict-CSP users to switch to, and works on the standard build only via `new Function`. The example is presented as the proof of the zero-build, CSP-safe story it actually disproves.

**Fixed (first pass, superseded):** the showcase was rewritten to stay inside the regex parser's grammar, with the arrow-function version kept as a negative test.

**Fixed (finally):** rewriting the shop window to fit the engine was the wrong direction — the example *is* the product, and it was the only thing in the category that ran under a strict CSP. The engine was replaced instead: the allowlist AST interpreter supports arrow-function callbacks in higher-order method argument position, so the original example is back verbatim. It is now EXTRACTED FROM `README.md` AT TEST TIME rather than copied into a test file, so it cannot drift again, and a second copy runs in Playwright under a real `Content-Security-Policy: script-src 'self'` response header.

Verified by: `src/__tests__/readme-flagship.test.ts` > "extracts a block that still contains the arrow-function filter"
Verified by: `src/__tests__/readme-flagship.test.ts` > "typing in the data-model input filters the list and the count"
Verified by: `src/__tests__/readme-flagship.test.ts` > "binds every directive in the block with zero diagnostics"

#### `security-md-sandbox-claim-overstated` - FIXED

*SECURITY.md:27*

SECURITY.md states the unsafe-eval path "is sandboxed via a `with()` + `Proxy` wrapper that blocks access to `constructor`, `__proto__`, `eval`, `Function`, and other dangerous properties." The Proxy is not a sandbox: its `has` trap returns `key in scope.getters`, so any identifier that is NOT a declared state key reports `false` and `with()` falls through to the real global scope. Arbitrary globals (`document`, `fetch`, `localStorage`, `XMLHttpRequest`) are fully reachable from any expression; only the specific blocklisted names are stopped.

**Fixed (first pass):** SECURITY.md stopped calling the opt-in eval path a sandbox and described what the `with()` + `Proxy` wrapper actually did, with the reachability of real globals pinned by test rather than by prose.

**Fixed (finally):** the wrapper is gone. Expressions are evaluated by an allowlist AST interpreter whose identifier resolution never consults `globalThis`, so globals are unreachable rather than blocked, and `src/__tests__/unsafe-eval-scope.test.ts` was deleted along with the code it described. SECURITY.md now documents the allowlist model, the T1/T2/T3 threat model, the five guarantees and the residual risks.

Verified by: `src/expr/__tests__/adversarial.test.ts` > "no global is reachable by name"
Verified by: `src/expr/__tests__/no-escape-hatch.test.ts` > "src/expr contains no path to the Function constructor or a global"

#### `blocked-expression-throws-out-of-initruntime` - FIXED

*src/runtime.ts:2042*

When the unsafe-eval path rejects a blocklisted expression it `throw`s instead of degrading to the existing blocked-noop path. The throw propagates out of `buildEvaluator` → `bindElement` → `mountScope` → `initRuntime`, so a single offending expression anywhere on the page aborts runtime initialization and NO directive on the page is ever bound. Every other unsupported-expression case (src/runtime.ts:2028-2034, 2062-2067) correctly returns a noop + diagnostic, so this is inconsistent as well as fail-open-into-a-dead-page.

**Fixed:** The blocklist hit degrades to a noop + diagnostic, matching every other unsupported-expression path, so one offending expression no longer aborts `initRuntime` and leaves the whole page unbound.

Verified by: `src/__tests__/runtime-hardening.test.ts` > "a prototype write never reaches Object.prototype"
Verified by: `src/__tests__/failure-semantics.test.ts` > "a denied binding does not stop its siblings from binding"

#### `readme-createhistory-example-throws` - FIXED

*README.md:600*

The documented `createHistory` example cannot run. README shows `const [state, setState, { undo, redo, canUndo, canRedo }] = createHistory({ text: "" })` — a tuple return taking a plain initial value. The real signature takes a `[get, set]` signal tuple as its only source argument and returns a `HistoryControls<T>` OBJECT, not an array. Running the README snippet throws `TypeError: source is not iterable`. The follow-on lines (`setState({text:"hello"})`, `state.text === "hello"`) are wrong for the same reason — the real API exposes reactive getters, not a plain object.

**Fixed:** The README example was replaced with the real signature (`[get, set]` source tuple in, `HistoryControls<T>` object out), and both the corrected snippet and the shape the old README documented are executed as tests.

Verified by: `src/__tests__/readme-examples.test.ts` > "runs exactly as documented"
Verified by: `src/__tests__/readme-examples.test.ts` > "rejects the shape the old README documented"

#### `client-inline-handler-injection` - FIXED

*src/dom/element.ts:791*

Event-handler prop detection in `h()` and `applyDynamicProps` is a case-SENSITIVE two-charCode test for lowercase `on`. A prop key with any other casing (`ONCLICK`, `Onerror`, `ONLOAD`) skips `addEventListener` and falls through to the generic `setAttribute` path, writing a real inline event-handler attribute (setAttribute ASCII-lowercases qualified names for HTML elements). SSR drops these case-insensitively, so an app that spreads server-supplied props into `h()` gets clean SSR HTML and an executing inline handler on the client.

**Fixed:** Event-handler detection moved to the shared case-insensitive `isEventHandlerAttr` (`/^on/i`). Any `on…` prop that misses the lowercase fast path is dropped — never written with `setAttribute` — on both the `h()` and hydration paths.

Verified by: `src/dom/__tests__/element-url-safety.test.ts` > "drops ONCLICK-cased string props instead of writing an inline handler"
Verified by: `src/dom/__tests__/hydrate.test.ts` > "never writes an inline event-handler attribute for an odd-cased on* prop"
Verified by: `src/security/__tests__/url-safety.test.ts` > "matches on* names case-insensitively"

#### `rpc-deep-strip-stack-overflow` - FIXED

*src/server/rpc-handler.ts:79*

`deepStripForbidden` recurses per nesting level over fully attacker-controlled JSON, before any authorization guard runs and outside `handleRPC`'s try/catch. A deeply nested body overflows the stack; the RangeError escapes `handleRPC`, and `createRPCMiddleware` awaits it with no try/catch, producing an unhandled promise rejection that terminates the Node process under its default `--unhandled-rejections=throw`. Remote, unauthenticated, ~120 KB request → process kill.

**Fixed:** `deepStripForbidden` is now iterative with a WeakSet cycle guard, and `createRPCMiddleware` wraps the await so a throw becomes a 500 instead of an unhandled rejection that kills the process.

Verified by: `src/server/__tests__/rpc-deep-strip.test.ts` > "strips forbidden keys at a depth that overflows a recursive walk"
Verified by: `src/server/__tests__/rpc-deep-strip.test.ts` > "terminates on a cyclic argument graph"
Verified by: `src/server/__tests__/rpc-deep-strip.test.ts` > "degrades to 500 instead of rejecting when request handling throws"

#### `store-proto-hijack-via-setter` - FIXED

*src/state/store.ts:530*

`createStore`'s setter assigns every own key of the update object onto the root proxy, and the proxy's `set` trap forwards to `Reflect.set(target, prop, value)`. A `__proto__` key — which `JSON.parse` creates as a real own, enumerable property — therefore invokes `Object.prototype.__proto__`'s setter with `this = target`, replacing the store object's prototype with an attacker-supplied object. Every subsequent read of a key the app hasn't explicitly set resolves through the injected prototype, so untrusted server JSON can forge state fields (`isAdmin`, `role`, feature flags) that the app never defined.

**Fixed:** The store's `set` trap rejects `__proto__`, `constructor` and `prototype` on both write paths, so a JSON-parsed own `__proto__` key can no longer invoke `Object.prototype.__proto__`'s setter and swap the store's prototype.

Verified by: `src/state/__tests__/store-proto-hijack.test.ts` > "setState with a __proto__ key does not replace the store prototype"
Verified by: `src/state/__tests__/store-proto-hijack.test.ts` > "assigning __proto__ directly on the proxy does not replace the prototype"
Verified by: `src/state/__tests__/store-proto-hijack.test.ts` > "a functional-updater snapshot never inherits from an injected prototype"

#### `hydrated-list-row-effects-never-disposed` - FIXED

*src/dom/hydrate.ts:735*

List rows created after SSR adoption (via the reconcile effect's createFn) are rendered bare — no createRoot wrapper, no dispose stored in the cache — so their reactive binding effects are never disposed: not on row removal, and not even on island root dispose (deactivateIsland/deactivateAllIslands). The effects stay subscribed to any shared signals and keep writing to detached DOM forever. This directly diverges from the CSR path in list.ts, which wraps each row in createRoot (list.ts:614) and disposes removed rows (list.ts:639-643).

**Fixed:** Every adopted row — SSR-matched or created later by the reconcile effect — owns a `createRoot`, and its disposer is stored in the row cache and called when the row leaves the list or the island root is disposed, matching the CSR path in list.ts.

Verified by: `src/dom/__tests__/list-hydration.test.ts` > "disposes the effects of a row removed after adoption"
Verified by: `src/dom/__tests__/list-hydration.test.ts` > "disposes every row when the island root is disposed"

#### `hydrate-error-path-zombie-effects` - FIXED

*src/dom/activate.ts:230*

If a component/adoption throws during island hydration, the effects created before the throw stay live forever: `__formaDispose` is assigned only AFTER hydrateIsland returns, so the catch path sets status='error' but never disposes the partially-built root. The island keeps reacting to signal writes (zombie writes into a 'failed' island), and deactivateIsland finds nothing to dispose — the leak is unreclaimable.

**Fixed:** The island root's disposer is registered before the component runs, so a throw mid-hydration still disposes the partially-built root; `deactivateIsland` then finds something to tear down instead of leaking it forever.

Verified by: `src/dom/__tests__/activate-isolation.test.ts` > "disposes effects created before a failing island threw"
Verified by: `src/dom/__tests__/activate-isolation.test.ts` > "keeps a successful island reactive and disposable"

#### `show-adoption-cached-branch-goes-stale` - FIXED

*src/dom/hydrate.ts:433*

setupShowEffect calls the branch factories (`desc.whenTrue()` / `desc.whenFalse()`) directly inside its internalEffect without untrack or createRoot. Bindings created by the factory become alien-signals deps of the show effect and are torn down by purgeDeps on the next toggle — but the branch DOM is cached in thenFragment/elseFragment and re-inserted later with dead bindings. After one toggle round-trip, reactive content in the factory-created branch is permanently frozen (stale UI). show.ts explicitly guards against this exact hazard in the CSR path; the hydration path is missing the guard.

**Fixed:** Branch factories run inside `createRoot` + `untrack`, so their bindings are owned by the branch rather than becoming deps of the show effect that `purgeDeps` tears down on the next toggle. Cached branch DOM stays live.

Verified by: `src/dom/__tests__/hydrate.test.ts` > "a branch built by its factory keeps updating after a toggle round-trip"
Verified by: `src/dom/__tests__/hydrate.test.ts` > "disposes the adopted branch bindings when the server content is dropped"

#### `throwing-binding-aborts-flush-cross-island` - FIXED

*src/reactive/effect.ts:116*

internalEffect (used for ALL DOM bindings: h() attributes/children, adoption text effects, show/list effects) runs the user-supplied binding closure with no try/catch. When a binding throws during a signal-driven re-run, alien-signals' flush aborts: every remaining queued effect for that write is skipped (only re-flagged for some future write), and the exception escapes to the setter call site in unrelated code. With shared signals across islands (a supported pattern — see shared-signals-across-islands.test.ts), one island's throwing binding makes sibling islands silently miss the update, violating the isolation promise in activate.ts ('a broken island never takes down its siblings').

**Fixed:** `internalEffect` catches re-run errors and routes them to `reportError()`/`onError()` so the alien-signals flush continues. A first-run throw still propagates, because that is the caller's own error.

Verified by: `src/reactive/__tests__/effect.test.ts` > "a binding that throws on re-run does not abort the flush for other bindings"
Verified by: `src/dom/__tests__/hydrate.test.ts` > "a binding that throws on a shared-signal update does not freeze the other island"
Verified by: `src/reactive/__tests__/effect.test.ts` > "a binding that throws on its first run still propagates to the caller"

#### `cdn-esm-bare-import-broken` - FIXED

*README.md:807-816*

The documented 'ESM import (modern browsers, no bundler)' CDN recipe does not work with the shipped artifacts. dist/index.js code-splits into chunks, and the reactive-core chunk imports the bare specifier 'alien-signals' (tsup externalizes package.json dependencies by default for esm/cjs; 'external: []' at tsup.config.ts:22 does not disable that). A browser loading https://cdn.jsdelivr.net/npm/@getforma/core@VERSION/dist/index.js throws 'Failed to resolve module specifier "alien-signals"'. This has been true since v1.0.7 too (same config at that tag), so the pinned example is equally broken. The 'zero-build'/'cdn' npm keywords and README both promise this path.

**Fixed:** A dedicated `dist/forma.esm.js` bundle is built for the browser recipe with alien-signals inlined and no code splitting, and the README recipe points at it instead of the code-split npm entry.

Verified by: `src/__tests__/build-artifacts.test.ts` > "the browser ESM CDN artifact is self-contained"
Verified by: `src/__tests__/build-config.test.ts` > "builds a self-contained browser ESM bundle for the CDN recipe"
Verified by: `src/__tests__/docs-truth.test.ts` > "does not point the browser ESM recipe at the code-split npm entry"

#### `wasm-subpath-promised-but-unshipped` - FIXED

*CHANGELOG.md:292*

CHANGELOG 0.7.1 states renderLocal/renderIsland 'remain available via direct import from `@getforma/core/wasm`', but that subpath has never shipped: src/wasm/forma-wasm.ts exists, yet tsup.config.ts has no wasm entry, dist contains no wasm output, and the exports map has no './wasm' entry. `import '@getforma/core/wasm'` fails resolution in every environment. The functions were removed from the root barrel at the same time, so this functionality is currently unreachable from the published package at all.

**Fixed:** A `wasm` build entry and a `./wasm` exports subpath now ship, so the CHANGELOG's promise resolves. Every dist file the exports map names is checked against the build config.

Verified by: `src/__tests__/build-config.test.ts` > "ships a build entry for every dist file the exports map promises"
Verified by: `src/__tests__/package-exports.test.ts` > "gives every import/require condition a types entry"

#### `island-shell-adoption-drift` - FIXED

*src/dom/hydrate.ts:557*

adoptNode's island-marker branch assumes an f:iN region is EMPTY (<!--f:i0--><!--/f:i0-->) and inserts freshly created DOM before the closing marker. But the compiler never emits empty island regions: emitIsland always writes a shell element between ISLAND_START/ISLAND_END (plain <div> for unresolvable components, full component root+content for resolved ones), and the Rust walker stamps data-forma-island/data-forma-component/data-forma-status onto that shell. So whenever an adopted island's tree contains a nested island region (a registered island referencing another registered island, or any Rule-11 unknown-expression island), adoption inserts a fresh duplicate of the content NEXT TO the SSR shell: duplicated visible DOM, plus either double hydration (registered child also activated by activateIslands) or a stray dead shell with a 'No hydrate function for island "island_N"' warning and status=error (anonymous Rule-11 islands).

**Fixed:** The island-marker branch checks for an existing SSR shell between the markers and adopts it instead of assuming the region is empty, so a nested island is no longer duplicated next to its own server-rendered shell.

Verified by: `src/dom/__tests__/hydrate.test.ts` > "does not duplicate a nested island that already has an SSR shell"
Verified by: `src/dom/__tests__/hydrate.test.ts` > "handles multiple adjacent island markers"

#### `ref-prop-breaks-adoption` - FIXED

*src/dom/hydrate.ts:204*

applyDynamicProps has no special-case for the `ref` prop. During adoption a function-valued ref is treated as a reactive attribute binding: internalEffect invokes the ref callback with NO element argument and writes the return value as a literal `ref` attribute. A ref like `(el) => el.focus()` throws TypeError synchronously inside the first effect run, which is inside hydrateIslandRoot's try — the ENTIRE island is marked status=error and stays dead. Refs that don't throw silently never receive the element. CSR h() calls ref(el) correctly (element.ts:832-833) and both SSR renderers skip ref (render.ts:132/268), so this is hydration-only drift within formajs.

**Fixed:** `applyDynamicProps` special-cases `ref`: a function ref is called with the adopted element once the element is bound, exactly as `h()` does, and is never written as an attribute or run as a reactive binding.

Verified by: `src/dom/__tests__/hydrate.test.ts` > "calls a function ref with the adopted element instead of writing a ref attribute"

### Minor

#### `dev-flag-define-is-inert-in-dist` - FIXED

*src/reactive/dev.ts:16*

The docstring claims "official prod dist builds — where tsup hard-defines `__DEV__ = false` — stay quiet regardless" and dev.ts:5 claims "Bundlers replace `__DEV__` with false → dead-code elimination removes all dev paths". Neither is true: `__DEV__` is a declared module export, so esbuild's `define` never substitutes it, no dev path is eliminated, and the shipped bundles compute it at runtime from `process.env.NODE_ENV`. Consequence: every dev `console.warn`/`console.error` ships in the published dist and fires in any Node/SSR or bundler context where NODE_ENV is unset (a common production misconfiguration).

**Fixed:** `__DEV__` is still a module export, so `define` still cannot substitute it — instead it is now computed from a separately named FREE identifier, `__FORMA_DEV_BUILD__`, which tsup hard-defines in every artifact. esbuild folds the `typeof`/`&&`/`||` shape while parsing, so the `isDev()` fallback and its `process.env.NODE_ENV` read are dropped from the shipped bytes and dev diagnostics cannot fire in the NODE_ENV-less Node/SSR process where they used to. The docstring also now records what is NOT true: `__DEV__ && console.warn` sites that cross a code-splitting chunk boundary survive in the bundle — they cost bytes but cannot run.

Verified by: `src/reactive/__tests__/dev-flag.test.ts` > "resolves __DEV__ at build time and drops the NODE_ENV fallback"
Verified by: `src/reactive/__tests__/dev-flag.test.ts` > "evaluates to false in a built artifact even when NODE_ENV is unset"
Verified by: `src/__tests__/build-config.test.ts` > "hard-defines the dev flag in every artifact"

#### `security-supported-versions-stale` - FIXED

*SECURITY.md:60*

The Supported Versions table lists only `1.0.x` as supported (and `< 1.0` unsupported) while the package is 1.5.0 with 1.1.0–1.5.0 released. A reporter reading this concludes the shipped version is out of support. The adjacent heading "Security Hardening (v0.5.0 – v1.0.0)" (SECURITY.md:41) is stale for the same reason — the 1.0.10 SSR/URL-scheme and 1.4.0 RPC hardening are described in the body but not in the version range.

**Fixed:** The Supported Versions table tracks the shipping minor, and the check is mechanical rather than editorial — it reads package.json.

Verified by: `src/__tests__/docs-truth.test.ts` > "SECURITY.md supports the version that is actually shipping"

#### `tc39-subpath-has-no-signal-namespace` - FIXED

*README.md:844*

README (and the Stability table at README.md:908) advertise `@getforma/core/tc39` as providing `Signal.State` and `Signal.Computed`. The subpath exports two bare classes, `State` and `Computed`; there is no `Signal` namespace object, so `import { Signal } from '@getforma/core/tc39'` — the shape the docs imply — yields undefined.

**Fixed:** The docs now describe the real export shape (`State` and `Computed`, no `Signal` namespace), and the test asserts both the module's key set and the absence of the namespace spelling from the README.

Verified by: `src/__tests__/docs-truth.test.ts` > "the tc39 subpath exports State and Computed, not a Signal namespace"

#### `cdn-snippets-pin-1.0.7` - FIXED

*README.md:801*

Every concrete CDN pin in the README points at `@getforma/core@1.0.7`, five minor releases behind the 1.5.0 package — including the "Production: Pin the version" advice at README.md:46. A reader who follows the instruction literally pins a build that predates the 1.0.10 SSR `javascript:`-scheme security fix and all 1.1–1.5 correctness work.

**Fixed:** Every CDN pin in the README, and the one in src/runtime.ts's own usage header, is asserted equal to the current package version, so a stale pin fails the suite instead of shipping.

Verified by: `src/__tests__/docs-truth.test.ts` > "every documented CDN pin is the current package version"
Verified by: `src/__tests__/docs-truth.test.ts` > "the runtime header's CDN pin is the current package version"

#### `size-claims-and-bundle-gate-drift` - FIXED

*README.md:8*

The "~24 KB gzipped" runtime figure is stale, and the CI size gate does not measure what the README claims. The CDN runtime bundle now gzips to 25.2 KB, and the "core entry ~8 KB" number is the gzip of `dist/index.js` alone — that file imports four shared chunks totalling ~14 KB gzipped that the gate never weighs, so the DOM code (chunk-YEEEQLE4.js, 9.8 KB gz) can grow without limit.

**Fixed:** `scripts/check-size.mjs` walks the whole module graph (entry + every chunk it transitively imports) and gzips the set, and the README's size table is asserted against the limits the gate enforces.

Verified by: `src/__tests__/check-size.test.ts` > "sums the gzipped size of the whole graph, not just the entry"
Verified by: `src/__tests__/docs-truth.test.ts` > "the size table quotes the limits the CI gate actually enforces"
Verified by: `src/__tests__/check-size.test.ts` > "walks a chunked module graph transitively"

#### `island-props-vs-rpc-sanitization-not-equivalent` - FIXED

*SECURITY.md:47*

SECURITY.md says island props are "stripped of `__proto__`, `constructor`, `prototype` keys" and that "RPC call arguments are stripped equivalently". They are not equivalent: RPC sanitization is recursive, island-prop sanitization is a single shallow pass over the top-level object, so pollution keys nested inside child objects reach the island. README.md:713 states the shallowness correctly, so the two documents disagree.

**Fixed:** SECURITY.md and README now state the same thing — island props are sanitized shallowly, RPC arguments recursively — and say why the asymmetry is deliberate. An opt-in `sanitizePropsDeep` closes the gap for apps that need it.

Verified by: `src/dom/__tests__/activate-isolation.test.ts` > "is opt-in: island activation still sanitizes only the top level"
Verified by: `src/dom/__tests__/activate-isolation.test.ts` > "sanitizePropsDeep strips forbidden keys at every depth"

#### `alien-signals-link-wrong-repo` - FIXED

*README.md:343*

The "Powered by alien-signals" credit links to `https://github.com/nicolo-ribaudo/alien-signals`, which is not the repository of the dependency actually installed.

**Fixed:** The credit links to the repository recorded in the installed dependency's own package.json, and the test reads that file rather than trusting the URL.

Verified by: `src/__tests__/docs-truth.test.ts` > "links alien-signals to the repository of the installed dependency"

#### `stability-table-island-test-counts-stale` - FIXED

*README.md:903*

The Stability row claims "10 activation + 88 hydration + 10 trigger tests" for islands. Activation is 13, not 10, and the figure ignores six further island test files (activate-reactivate, activate-visible, activate-visible-leak, deactivate, list-hydration, multi-island-integration, shared-signals-across-islands), so the claim both misstates and understates coverage.

**Fixed:** The island coverage figure is computed from the island test files themselves — both the case count and the file count — so it cannot drift from the suite.

Verified by: `src/__tests__/docs-truth.test.ts` > "the island coverage figure matches the island test files"

#### `island-shared-props-parse-unguarded` - FIXED

*src/dom/activate.ts:69*

The shared `__forma_islands` props block is parsed with a bare `JSON.parse` outside any try/catch and outside the per-island error isolation, and the element is located by id alone. Malformed or clobbered content throws before the island loop starts, so NO island on the page hydrates — breaking the documented "a broken island never takes down its siblings" guarantee — and a user-controlled `id="__forma_islands"` node earlier in the document supplies props to every island on the page.

**Fixed:** The shared props block is located with `script#__forma_islands` (so a non-script element carrying that id cannot supply props to the page) and parsed inside a try/catch, so a malformed block degrades to null props instead of stopping every island on the page.

Verified by: `src/dom/__tests__/activate-isolation.test.ts` > "a malformed __forma_islands block does not stop islands from hydrating"
Verified by: `src/dom/__tests__/activate-isolation.test.ts` > "ignores a non-script element carrying id __forma_islands"
Verified by: `src/dom/__tests__/activate-isolation.test.ts` > "an empty __forma_islands script block degrades to null props"

#### `srcdoc-raw-html-sink` - FIXED

*src/security/url-safety.ts:25*

`srcdoc` is a typed, supported prop (jsx.d.ts:238) that is a raw-HTML sink, but it is treated as an ordinary attribute by both renderers. HTML attribute escaping does not neutralize it: the browser entity-decodes the attribute value and parses the result as an HTML document that is same-origin with the page, so an SSR-escaped payload executes anyway.

**Fixed:** `srcdoc` is classified as a raw-HTML sink in the shared url-safety module. It is still emitted — a sandboxed `<iframe srcdoc>` is legitimate — but both renderers warn in dev that escaping does not neutralize it, and README/SECURITY.md name it alongside the other trusted-content sinks.

Verified by: `src/ssr/__tests__/render-safety.test.ts` > "warns in dev that srcdoc is a raw-HTML sink but still emits it"
Verified by: `src/security/__tests__/url-safety.test.ts` > "identifies srcdoc as a raw-HTML sink"
Verified by: `src/dom/__tests__/element-url-safety.test.ts` > "emits srcdoc but warns that escaping does not neutralize it"

#### `duplicate-forma-key-ghost-row` - FIXED

*src/dom/hydrate.ts:612*

During list adoption, `ssrKeyMap.set(key, el)` is last-wins for duplicate data-forma-key rows. The earlier duplicate is neither adopted (not in adoptedNodes) nor removed (the cleanup loop only iterates keys REMAINING in ssrKeyMap, and the duplicate's key was consumed by the match), so it survives between the list markers as a permanent ghost row that reconcileList never tracks. The CSR path at least dev-warns on duplicate keys (list.ts:561-571); adoption is silent.

**Fixed:** List adoption is first-wins on `data-forma-key`: later duplicates are removed from the DOM (with a dev warning) instead of surviving between the markers as rows the reconciler never tracks.

Verified by: `src/dom/__tests__/list-hydration.test.ts` > "removes a duplicate data-forma-key row instead of leaving a ghost"

#### `mount-unmount-ghost-after-csr-fallback` - FIXED

*src/dom/mount.ts:76*

mount() on a `data-forma-ssr` container ignores hydrateIsland's return value. When hydrateIsland takes the CSR fallback and REPLACES the container element (hydrate.ts:913 `target.replaceWith(result)`), the returned unmount function disposes effects but then clears `target.innerHTML` on the now-detached original element — the replacement element (with all its DOM) stays in the document after unmount.

**Fixed:** `mount()` keeps the element hydration actually left in the document. When the CSR fallback replaces the container, unmount removes the replacement rather than clearing the detached original.

Verified by: `src/dom/__tests__/mount.test.ts` > "unmount removes the replacement element after the CSR fallback"

#### `node10-subpath-types-unresolvable` - FIXED

*package.json:10*

Every subpath export (./runtime, ./runtime-hardened, ./runtime-csp, ./tc39, ./ssr, ./http, ./storage, ./server) fails to resolve under TypeScript moduleResolution 'node'/'node10' (attw: 'Resolution failed' for all subpaths; root '.' is fine via top-level main/module/types). Consumers on legacy tsconfigs cannot import the documented subpaths (README.md:838-844 documents all of them).

**Fixed:** Every subpath has a `typesVersions` fallback, so node10/`node` moduleResolution resolves them. Asserted by test and re-checked in CI by `attw --pack .`.

Verified by: `src/__tests__/package-exports.test.ts` > "gives every subpath a typesVersions fallback so node10 resolution works"

#### `global-subpaths-untyped-and-esm-misparse` - FIXED

*package.json:31*

'./runtime/global' and './runtime-csp/global' exports point at IIFE .js files with no 'types' condition. attw reports 'No types' for CJS/ESM/bundler and 'ESM (dynamic import only)' from CJS; publint warns the file 'is written in CJS but interpreted as ESM' because a .js file under "type":"module" is parsed as ESM (works only because the IIFE happens to parse as a module; require() from CJS Node <22 fails outright). TS consumers doing side-effect imports of these subpaths get TS7016 errors.

**Fixed:** The classic-script IIFE bundles no longer have `exports` subpaths at all — they are reached by CDN URL only, which is what they are for — so nothing routes them through a module resolver or asks for their types.

Verified by: `src/__tests__/package-exports.test.ts` > "does not route the classic-script CDN bundles through the module resolver"

#### `size-gate-ignores-chunks` - FIXED

*.github/workflows/ci.yml:29-45*

The bundle-size gate (CHANGELOG 1.0.10 brags these are now 'separate, honest gates') gzips only dist/index.js (9,035 B today), but with splitting:true most core code lives in shared chunks: importing '@getforma/core' actually pulls index.js + chunk-YEEEQLE4 + chunk-3QHHKIZW + chunk-57BHU4G7 (+chunk-7BN3ZGMM) ≈ 23 KB gz total. A regression that moves code from the entry into a chunk (or grows a chunk) passes the 12 KB gate unnoticed, and the README headline 'core entry ~8 KB gzipped' measures only the entry shim.

**Fixed:** The gate was extracted to `scripts/check-size.mjs`, which resolves the import graph from each entry and weighs every chunk it reaches. Moving code out of the entry into a chunk no longer hides it.

Verified by: `src/__tests__/check-size.test.ts` > "walks a chunked module graph transitively"
Verified by: `src/__tests__/check-size.test.ts` > "fails loudly when a chunk import cannot be resolved"
Verified by: `src/__tests__/check-size.test.ts` > "survives a cycle between chunks"

#### `tsup-parallel-clean-race` - FIXED

*tsup.config.ts:20*

The five tsup configs build in parallel while config 1 has clean:true; the build is observably nondeterministic. In the audited run, config 4 built dist/runtime-hardened.d.ts/.d.cts ('DTS Build success in 1063ms' listing both files), yet scripts/post-build.mjs then logged 'copied dist/runtime.d.ts → dist/runtime-hardened.d.ts' — meaning config 1's later DTS phase (finished 3876 ms) clobbered config 4's already-written declarations, and only the post-build existsSync fallback resurrected them. Today the copied content is identical (same entry src/runtime.ts), but which artifact ships depends on scheduler timing, and outputs without a fallback (the IIFE globals post-build copies from) would fail the build or ship missing if the race window shifts.

**Fixed:** `clean` was removed from every tsup config; `scripts/clean-dist.mjs` runs once before tsup starts, so no config can clobber another's declarations mid-build. Two consecutive builds now produce byte-identical dist trees.

Verified by: `src/__tests__/build-config.test.ts` > "never cleans dist from inside a parallel config"

#### `dev-node-floor-undeclared` - FIXED

*package.json:176*

A fresh `npm ci` EBADENGINE-warns on this machine (node 20.16.0, npm 10.8.1) because the dev toolchain's vite requires `^20.19.0 || >=22.12.0`, but the repo declares only consumer engines `"node": ">=18"` and CONTRIBUTING doesn't state a dev Node floor. CI masks this because setup-node '20' resolves to latest 20.x (≥20.19). Contributors on any 20.x below 20.19 get warnings now and hard breaks whenever a dev dep promotes engines to engine-strict or uses newer APIs.

**Fixed:** `engines` and `devEngines` both declare the real floor, and the test derives it from the installed devDependencies so a dep that raises its own floor fails the suite rather than surprising a contributor.

Verified by: `src/__tests__/package-exports.test.ts` > "declares a dev floor no installed devDependency undercuts"
Verified by: `src/__tests__/package-exports.test.ts` > "rangeFloor takes the lowest disjunct of a multi-branch range"

#### `readme-stale-pins-and-orphan-global-build` - FIXED

*README.md:801-827*

Doc/artifact drift in the CDN section: (a) examples and the 'Pin the version' tip reference @getforma/core@1.0.7 while the package is 1.5.0 — users copy-pasting pin a 5-minor-versions-old runtime that predates the exports fix in bf35b21 and the 1.1–1.5 fix train; (b) dist/formajs.global.js (+340 KB map) ships in the tarball but appears nowhere in the README 'All builds' table, has no exports subpath, and is not in the sideEffects list — a 461 KB undocumented orphan that exists only as a raw CDN URL.

**Fixed:** (a) pins are asserted against package.json; (b) `dist/formajs.global.js` is gone, and no doc may reintroduce a reference to an artifact the build does not emit.

Verified by: `src/__tests__/docs-truth.test.ts` > "mentions no artifact the build no longer produces"
Verified by: `src/__tests__/docs-truth.test.ts` > "the All builds table lists exactly the CDN artifacts the build emits"

#### `islands-script-parse-not-isolated` - FIXED

*src/dom/activate.ts:69*

activateIslands parses the shared __forma_islands script block with a bare JSON.parse BEFORE the island loop and outside any try/catch. One malformed script block (downstream emitter bug, truncated stream, or an unrelated page element that happens to carry id="__forma_islands", including an empty one — JSON.parse('') throws) aborts activateIslands entirely: ZERO islands hydrate, including islands that use inline props or no props at all. This violates the library's own error-isolation promise ('a broken island never takes down its siblings' — activate.ts docstring and README.md:675). Per-island inline props are correctly isolated (parsed inside hydrateIslandRoot's try), making the shared-block gap an inconsistency.

**Fixed:** Same fix as `island-shared-props-parse-unguarded` — the shared block is parsed inside a try/catch before the island loop, so one bad block no longer aborts activation for every island.

Verified by: `src/dom/__tests__/activate-isolation.test.ts` > "a malformed __forma_islands block does not stop islands from hydrating"

#### `show-branch-list-descriptor-unadopted` - FIXED

*src/dom/hydrate.ts:493*

adoptBranchContent handles HydrationDescriptor and nested ShowDescriptor initial branches, but silently ignores ListDescriptor branches. Its closing comment claims list adoption 'is handled by the existing list adoption code in adoptNode when it encounters list markers' — but that code only runs while walking an element's desc.children; a show whose branch is DIRECTLY a list (`createShow(cond, () => createList(...))`, no wrapper element) never gets its f:lN region adopted: SSR rows stay in the DOM with no reconcile effect bound, so item updates do nothing until the first condition toggle rebuilds the branch fresh (at which point the stale SSR rows are cached and can resurface via the show fragment cache).

**Fixed:** `adoptBranchContent` now finds the inner `f:lN` region of a show branch that is directly a list, so the reconcile effect binds to the server's rows instead of leaving them inert until the first toggle.

Verified by: `src/dom/__tests__/list-hydration.test.ts` > "adopts a list that is a show branch with no wrapper element"

#### `hydration-classname-attr-drift` - FIXED

*src/dom/hydrate.ts:227*

applyDynamicProps writes reactive attribute bindings using the raw prop key with no PROP_TO_ATTR mapping: a reactive `className: () => ...` on an adopted element produces a useless `classname="..."` attribute (no styling), `htmlFor`/`tabIndex` similarly. Every other renderer in the package maps these (CSR element.ts routes className through handleClass; SSR renderAttr applies PROP_TO_ATTR), so the same component renders correctly server-side and in CSR but silently loses its class binding after hydration adoption.

**Fixed:** Adoption applies the same `PROP_TO_ATTR` mapping the SSR renderer uses, so `className`/`htmlFor`/`tabIndex` land on the right attributes instead of producing a useless `classname="…"`.

Verified by: `src/dom/__tests__/hydrate.test.ts` > "maps className/htmlFor/tabIndex to their HTML attribute names"

## Confirmed, needs a design decision

#### `show-forward-mismatch-cache-poisoning` - FIXED

*src/dom/hydrate.ts:425*

setupShowEffect mislabels cached fragments after a forward hydration mismatch (SSR rendered the truthy branch but the client condition is false at adoption — e.g. stale server data or a downstream slot-injection bug). Initial state: currentCondition=false with the server's TRUE-branch content between the markers. On the first toggle to true, that stale true-branch content is extracted and cached as `elseFragment` (because next===true), and fresh whenTrue content is inserted — looks correct. But on the next toggle to false, `elseFragment` (the server's TRUE-branch HTML) is re-inserted as the FALSE branch: the user sees the truthy UI while the condition is false, permanently (fragments keep swapping consistently wrong from then on when whenFalse exists). The reverse mismatch (SSR empty, client true) is already detected and repaired at :407-414; the forward direction is not.

Verifier notes: Reproduced at runtime with a scratchpad probe (repo untouched). SSR true-branch content tagged data-ssr="1", client condition false at adoption: toggle 1 (->true) inserts a fresh client node (proving the effect runs and the stale content was cached as elseFragment per hydrate.ts:425-429); toggle 2 (->false) re-inserts the original SSR node (data-ssr="1", class "truthy") as the FALSE branch; toggles 3/4 repeat the cycle — the false branch permanently shows the truthy UI and whenFalse never renders. The finding is actually understated: show.ts:38 defaults elseFn to () => null, so desc.whenFalse is ALWAYS a truthy function at hydrate.ts:435 — the poisoning also hits shows with no user whenFalse (probe showed content persisting after true->false when it should be removed). The existing test (hydrate.test.ts:1550) pins only adoption + first toggle, both of which look correct; no repair path exists elsewhere (adoptBranchContent walks in place, doesn't fix static content).

**Fixed:** The adopted server content is tracked as the server's rather than being relabelled by the direction of the first toggle. When it is dropped its bindings are disposed and it is never re-inserted as the opposite branch — including the `whenFalse`-defaulted case the finding's verifier notes identified as broader than first filed.

Verified by: `src/dom/__tests__/hydrate.test.ts` > "forward mismatch: the server branch is never re-inserted as the other branch across repeated toggles"
Verified by: `src/dom/__tests__/hydrate.test.ts` > "forward mismatch with no whenFalse: the server content does not come back as the false branch"
Verified by: `src/dom/__tests__/hydrate.test.ts` > "handles reverse mismatch — SSR empty but client condition is true"

## Recommendations

Lower priority or requiring a judgement call. `risk` is what adopting it would break.

#### `undocumented-public-api-and-html-sinks` - FIXED (risk: none)

*src/index.ts:21*

A large part of the root export surface is documented nowhere in the markdown: `svg` (shipped in 1.3.0 per CHANGELOG.md:79 but absent from README), `createPortal`, `createSuspense`, `createMemo`, `createResource`, `persist`, `createBus`, `delegate`, `onKey`, `template`/`templateMany`, `reconcileList`, `hydrateIsland`, the whole dom-utils group, and the newly re-exported `value`/`getSignalName`/`getOwner`/`runWithOwner`. More importantly, the two HTML-injection sinks reachable from the core entry — the `dangerouslySetInnerHTML` prop on `h()` and the exported `setHTMLUnsafe` — appear in no markdown file, while CSP.md:53 flatly answers "FormaJS uses it? **No**" for the `innerHTML` row and SECURITY.md:13 characterizes the core entry only as "No network, no eval, no filesystem".

Proposed: Add a short "Escape hatches / trust boundary" section to README and a matching row in SECURITY.md's capability table naming `dangerouslySetInnerHTML`, `setHTMLUnsafe`, and the `reconcile`/`parseHTML` innerHTML paths as unsanitized first-party-only sinks; qualify the CSP.md:53 row to "not used for library-generated markup; available as an explicit opt-in sink". Then backfill the missing primitives (starting with `svg()`, `createResource`, `createSuspense`, `createPortal`) into the Core API and Stability tables.

**Fixed:** The README documents every symbol the root entry exports — enforced by reading the barrel, not by review — and both README and SECURITY.md name the unsanitized HTML sinks (`dangerouslySetInnerHTML`, `setHTMLUnsafe`, `srcdoc`) as explicit opt-in trust boundaries.

Verified by: `src/__tests__/docs-truth.test.ts` > "documents every symbol the root entry exports"
Verified by: `src/__tests__/docs-truth.test.ts` > "names the unsanitized HTML sinks reachable from the core entry"

#### `changelog-missing-unreleased-section` - FIXED (risk: none)

*CHANGELOG.md:5*

CHANGELOG.md opens with "All notable changes to this project will be documented in this file" but its newest entry is 1.5.0, while the current branch already carries two user-visible changes: the root-barrel export fix (bf35b21) that made `getOwner`/`runWithOwner`/`getSignalName`/`value`/`Owner`/`ResourceFetcherInfo` reachable from `@getforma/core` for the first time, and the SSR-with-server-data README recipe (6c67287). Because those symbols were listed as "Added" under 1.1.0 (CHANGELOG.md:149-151) but were not re-exported from the root until this branch, the changelog currently overstates what shipped in 1.1.0–1.5.0.

Proposed: Add an `## [Unreleased]` section recording the root-export fix (with a note that these 1.1.0 additions were only reachable via deep import until now) and the SSR-with-server-data docs, and add a footnote to the 1.1.0 entry pointing at it.

**Fixed:** CHANGELOG.md carries an `## [Unreleased]` section above the newest release, and its presence and position are asserted.

Verified by: `src/__tests__/docs-truth.test.ts` > "the changelog has an Unreleased section above the newest release"

#### `sanitize-props-shallow-no-opt-in-deep` - FIXED (risk: behavioral-additive)

*src/dom/activate.ts:27*

`sanitizeProps` strips `__proto__`/`constructor`/`prototype` at the top level only. The limitation is honestly documented, but there is no supported way to get deep sanitization, so any island that hands a nested props object to a deep-merge, `Object.assign` chain, or `createStore` re-opens the pollution path the top-level strip was added to close.

Proposed: Export an opt-in deep sanitizer rather than changing the default: add `export function sanitizePropsDeep<T>(obj: T): T` to `src/dom/activate.ts` (iterative, WeakSet-guarded — same shape as the rpc-handler rewrite in `rpc-deep-strip-stack-overflow`, so an island can call it on props before feeding a store or merge), and cross-reference it from the README island-props section. Purely additive — new export, existing `activateIslands` behavior and cost unchanged. Making deep sanitization the default inside `loadIslandProps` is deliberately NOT proposed: it would add an unbounded per-payload walk to every hydration and silently mutate large server payloads.

**Fixed:** `sanitizePropsDeep` was added as an opt-in export (iterative, WeakSet-guarded). The default `activateIslands` path is unchanged and still shallow, exactly as proposed — the additive fix, not a behaviour change on the hot path.

Verified by: `src/dom/__tests__/activate-isolation.test.ts` > "sanitizePropsDeep strips forbidden keys at every depth"
Verified by: `src/dom/__tests__/activate-isolation.test.ts` > "sanitizePropsDeep terminates on cyclic props"
Verified by: `src/dom/__tests__/activate-isolation.test.ts` > "is opt-in: island activation still sanitizes only the top level"

#### `data-svg-scheme-comment-false` - FIXED (risk: none)

*src/security/url-safety.ts:21*

A code comment asserts that `data:image/svg+xml` in a navigable context "is handled separately", but no code anywhere handles it. The scheme allowlist deliberately permits `data:image/*`, so `data:image/svg+xml,<svg onload=…>` passes `isDangerousUrl` in every sink (SSR, data-bind, and — once the first finding is fixed — h()). Impact is limited today (browsers block top-level `data:` navigation; a `data:` iframe gets an opaque origin), but the comment misleads the next reader into thinking a control exists.

Proposed: Correct the comment to state the actual posture — that `data:image/svg+xml` is intentionally allowed, that browsers block top-level `data:` navigation and give `data:` iframes an opaque origin, and that apps embedding untrusted SVG in a navigable context should sanitize it themselves — and mirror that sentence in SECURITY.md:45 next to the existing scheme-detection bullet. Comment/doc change only; do NOT add `data:image/svg+xml` to `DANGEROUS_SCHEME_RE`, which would break legitimate inline-SVG assets across SSR and the runtime.

**Fixed:** Rather than deleting the comment, the control it described was built: `isDangerousUrl` takes an optional `tag` and rejects `data:image/svg+xml` for document-context sinks, allows it for image-context sinks, and fails safe when no tag is supplied. The comment is now true.

Verified by: `src/security/__tests__/url-safety.test.ts` > "blocks data:image/svg+xml for document-context sinks"
Verified by: `src/security/__tests__/url-safety.test.ts` > "allows data:image/svg+xml for image-context sinks"
Verified by: `src/security/__tests__/url-safety.test.ts` > "still blocks control-char-obfuscated svg data URLs in an image sink"

#### `ssr-tag-name-not-validated` - FIXED (risk: behavioral-additive)

*src/ssr/render.ts:124*

All three SSR renderers interpolate `node.tag` straight into the markup with no validation, while prop NAMES are validated by `isSafeAttrName`. A tag string derived from data (a CMS block type, an FMIR-driven component name) can inject attributes or close the tag: `sh('div onload=alert(1)', …)` emits `<div onload=alert(1)>`.

Proposed: Reuse the existing validator in the three VNode branches: `if (!isSafeAttrName(tag)) { if (__DEV__) console.warn(…); return; }` (or throw a TypeError in dev and skip the node in prod) before the first `parts.push('<', tag)`. `isSafeAttrName`'s charset (`^[A-Za-z_:][-A-Za-z0-9_:.]*$`) already accepts every valid HTML/SVG/custom-element tag name, so no legitimate tree changes output — hence no hydration-marker or wire-format impact. Filed as a recommendation rather than a fix because tag names are author-controlled in every documented usage, so it is hardening for a pattern the docs do not currently endorse.

**Fixed:** All three SSR renderers validate `node.tag` with `isSafeTagName` before interpolating it, and skip the node with a dev warning otherwise. The charset accepts every valid HTML/SVG/custom-element name, so no legitimate tree renders differently — no wire impact.

Verified by: `src/ssr/__tests__/render-safety.test.ts` > "drops a VNode whose tag would inject an attribute"
Verified by: `src/ssr/__tests__/render-safety.test.ts` > "the streaming renderer drops a VNode with an unsafe tag name"
Verified by: `src/ssr/__tests__/render-safety.test.ts` > "renders ordinary, SVG and custom-element tags unchanged"

#### `islands-inside-removed-list-rows-never-deactivated` - FIXED (risk: behavioral-additive)

*src/dom/list.ts:195*

When reconcileList removes a row whose subtree contains a child island, nothing deactivates that island: its root was created via createUnownedRoot (deliberately unowned, activate.ts:230), the row root only owns effects created in renderFn, and no removal path scans for [data-forma-island] descendants. The island's effects keep running against detached DOM until someone manually calls deactivateIsland on an element that is no longer in the document.

Proposed: Not proposed as a fix (it changes teardown behavior for removed subtrees, and animated removals via onBeforeRemove would need deactivation deferred into done()). Recommendation: in row-removal paths, if the removed node matches or contains [data-forma-island], call deactivateIsland on each at actual-removal time; alternatively document that apps embedding islands in list rows must deactivate them via onBeforeRemove. Strictly a leak fix but reported as recommendation because it adds teardown side effects to a hot public code path.

**Fixed:** Row-removal paths scan the removed node and its subtree for `[data-forma-island]` and deactivate each at actual-removal time — which, for an animated removal, is inside `done()` rather than when the row is scheduled to leave.

Verified by: `src/dom/__tests__/list-disposal.test.ts` > "deactivates an island inside a removed row"
Verified by: `src/dom/__tests__/list-disposal.test.ts` > "deactivates an island that IS the removed row element"
Verified by: `src/dom/__tests__/list-disposal.test.ts` > "defers island deactivation until an animated row is actually removed"

#### `adopted-rows-never-rebound` - FIXED (risk: behavioral-additive)

*src/dom/hydrate.ts:650*

SSR-matched list rows are adopted as-is: listRenderFn is never invoked for them and adoptNode is never walked into the row element, so function props (event handlers, reactive attrs) from renderFn are never attached to adopted rows — only fresh-rendered rows get them. README.md:368 and :759 document the attribute side ('Matched rows are adopted in place without re-rendering'; 'adoption skips non-function props'), but the event-handler consequence (an onClick in a createList row body silently does nothing on adopted rows until the row is re-created) is undocumented and is a likely footgun for hand-written (non-compiled) SSR apps following the new SSR-with-server-data recipe.

Proposed: Either (a) document the limitation prominently in the README list-hydration section ('event handlers inside createList row bodies do not attach to adopted rows; use delegate() on the list container'), or (b) as an opt-in future enhancement, run renderFn in hydration mode per adopted row and adoptNode the resulting descriptor against the SSR row (a larger change that must stay behind an option to preserve current adoption throughput). Do not change default behavior without compiler-contract coordination.

**Fixed:** Option (b) was taken instead of documenting the footgun: `renderFn` runs in hydration mode per adopted row and the resulting descriptor is adopted against the SSR row, so event handlers and reactive attributes from the row body attach to adopted rows.

Verified by: `src/dom/__tests__/list-hydration.test.ts` > "attaches event handlers from renderFn to adopted SSR rows"
Verified by: `src/dom/__tests__/list-hydration.test.ts` > "binds reactive text inside an adopted row"

#### `release-workflow-hygiene` - FIXED (risk: none)

*.github/workflows/release.yml:30-49*

Several publish-pipeline gaps (none currently causing wrong artifacts, verified by clean pack): (1) the 40-line bundle-size gate is copy-pasted between ci.yml and release.yml — the limits already require dual maintenance and will drift; (2) release runs typecheck + unit tests but not the Playwright e2e suite that the CI badge implies gates the code — a hydration regression caught only by e2e could ship; (3) `npm publish` re-triggers `prepublishOnly` → the tarball is built a second time AFTER the size gate measured the first build (benign today since the build is content-deterministic, but the gate is not measuring the shipped bytes); (4) no GitHub `environment:` protection on the publish job; (5) neither workflow runs publint/attw/npm pack validation, which would have caught the node10 and global-subpath findings above; (6) publint also suggests repository.url as 'git+https://...'.

Proposed: Extract the size gate to scripts/check-size.mjs called from both workflows; add `npx playwright install --with-deps chromium && npm run test:e2e` to the release job; add `npx publint` and `npx @arethetypeswrong/cli --pack . --profile node16` steps to CI; add `environment: npm-publish` protection; prefix repository.url with `git+`. All CI/metadata-only, no artifact changes.

**Fixed:** All six sub-items: the size gate is one script called from both workflows; release runs the Playwright e2e suite; CI and release both run `check:pack` (publint + attw); the publish job is gated on `environment: npm-publish`; the release job measures the same bytes it publishes; and repository.url carries the `git+` prefix.

Verified by: `src/__tests__/package-exports.test.ts` > "uses a full git URL so npm records provenance correctly"
Verified by: `src/__tests__/check-size.test.ts` > "sums the gzipped size of the whole graph, not just the entry"

#### `engines-18-claim-untested` - FIXED (risk: behavioral-breaking)

*package.json:176*

engines claims Node >=18 but no CI job ever executes the published artifacts on Node 18 (matrix is 20/22/24, and the dev toolchain cannot run there since vite needs >=20.19), so the floor is an untested promise; Node 18 is also past EOL (April 2025). The shipped code targets es2022 and loaded fine on 20.16 in this audit, but nothing guards against a future dep or syntax bump breaking 18.

Proposed: Either (a) add a lightweight CI job on node-version 18 that installs only the packed tarball (`npm pack` on node 24, then on 18: `npm init -y && npm i ../getforma-core-*.tgz && node smoke.mjs` importing every subpath) — additive, keeps the promise honest; or (b) raise engines to >=20 at the next semver-major. Option (b) changes install behavior for node-18 users, hence reported as recommendation only.

**Fixed:** Option (b): the floor was raised to a version CI actually executes rather than left as an untested promise for an EOL runtime. The test derives the claim from the CI matrix, so raising one without the other fails.

Verified by: `src/__tests__/package-exports.test.ts` > "the engines floor is a version CI actually runs"

#### `dual-package-and-hardened-state-duplication` - FIXED (risk: behavioral-breaking)

*tsup.config.ts:17-24*

Two undocumented multiple-instance hazards in a library whose entire value is a single shared reactive graph: (1) classic dual-package hazard — full stateful implementations ship as both ESM (dist/index.js + chunks) and CJS (dist/index.cjs + separate .cjs chunks); a process that mixes `import` and `require` of @getforma/core gets two independent forma module states (scopes, owner tree, component registry) — they only coincidentally share alien-signals because it is externalized in both; (2) './runtime-hardened' is built with splitting:false (tsup.config.ts:87, required by its different __FORMA_UNSAFE_EVAL_MODE__ define), so even a pure-ESM app importing both '@getforma/core' and '@getforma/core/runtime-hardened' gets a second private copy of the entire runtime+core internals — signals created via the root entry are invisible to the hardened runtime's registries. Neither hazard is mentioned in README/CSP.md.

Proposed: Cannot be structurally fixed within the constraints (making CJS a thin wrapper over ESM or forcing runtime-hardened onto shared chunks changes shipped module topology → behavioral-breaking for existing consumers). Recommend documenting both rules in README ('pick import OR require, never both in one process; do not mix the root entry with runtime-hardened in the same app — use runtime-hardened standalone or via its global build') and revisiting a wrapper-CJS layout at the next major.

**Fixed:** The finding's own proposal ruled out changing module topology. Instead of documenting the hazard and hoping, the library now DETECTS it: the module graph registers an instance marker on globalThis and warns once in dev when a second copy loads — which is exactly what mixing import/require, or pairing the root entry with runtime-hardened, produces. Residual, deliberately unchanged: the shipped topology still allows two copies; detection is the fix, not prevention. Revisit a wrapper-CJS layout at the next major.

Verified by: `src/reactive/__tests__/dev-flag.test.ts` > "warns once when a second copy of the module graph registers"
Verified by: `src/reactive/__tests__/dev-flag.test.ts` > "stays silent for the single copy every normal consumer loads"

#### `missing-package-json-export` - FIXED (risk: none)

*package.json:10*

The exports map has no './package.json' entry, so tooling that resolves it as a subpath (Vite plugin detection, bundler metadata probes, `require('@getforma/core/package.json')` in scaffolders like create-forma-app) gets ERR_PACKAGE_PATH_NOT_EXPORTED.

Proposed: Add `"./package.json": "./package.json"` to the exports map. Strictly additive.

**Fixed:** `"./package.json": "./package.json"` was added to the exports map.

Verified by: `src/__tests__/package-exports.test.ts` > "exposes ./package.json so scaffolders and bundler probes can read it"

#### `legacy-hydration-renderer-orphaned-grammar` - FIXED (risk: behavioral-breaking)

*src/ssr/render.ts:216*

renderToStringWithHydration emits a marker grammar nothing in the ecosystem consumes: `data-forma-h="N"` attributes and `<!--forma-t:N-->` / `<!--forma-l:N-->` comments. The client adoption path only parses f:tN/f:sN/f:lN/f:iN (hydrate.ts:134-188, 316-334); the Rust walker, compiler, and ksx all emit the f:* grammar. The docstring claims the markers exist 'so the client-side hydrate() function can adopt existing DOM nodes without re-creating them' — following that produces HTML whose function children are silently skipped during adoption (unknown comments just advance the cursor at hydrate.ts:835-837): no reactive bindings, no warning. Two marker dialects for the same concept in one package is exactly the kind of ecosystem drift this audit is for.

Proposed: Out of bounds to remove or change its output (public API + a wire format, even if orphaned). Recommend: (a) mark it @deprecated in TSDoc pointing at the islands/f:* pipeline and correct the false 'client-side hydrate() can adopt' claim now (docs-only, safe), and (b) in a future major, either delete it or re-emit the f:* grammar so its output becomes hydratable. Changing its emission today would alter produced HTML byte-for-byte for any external caller — hence recommendation, not a fix.

**Fixed:** The finding proposed deprecating it because removal would be breaking for external callers. There are none — ksx Studio is the only consumer and it uses the f:* pipeline — so `renderToStringWithHydration` and its entire `data-forma-h` / `forma-t:N` / `forma-l:N` dialect were deleted rather than left as a second grammar that produces un-adoptable HTML. The test pins the removal so it cannot come back.

Verified by: `src/__tests__/ssr-integration.test.ts` > "does not export a second, unparseable hydration marker dialect"

#### `activate-islands-no-shadow-root-param` - FIXED (risk: behavioral-additive)

*src/dom/activate.ts:67*

activateIslands is hardwired to `document` (both document.getElementById for the props block and document.querySelectorAll for islands), while its teardown twin deactivateAllIslands accepts a `root: Element | Document = document` parameter and the docs describe swapping Shadow DOM content (forma-stage). querySelectorAll on document does not pierce shadow roots, so islands rendered into a ShadowRoot can be deactivated but never activated — an asymmetric API for the documented use case.

Proposed: Additive optional second parameter `activateIslands(registry, root: ParentNode = document)`, using root.querySelectorAll and looking up the props block within root first, falling back to document. This is a signature extension (optional trailing param, no rename/removal, default preserves current behavior) — reported as a recommendation per the hard constraints rather than proposed as a fix.

**Fixed:** `activateIslands(registry, root: ParentNode = document)` — an optional trailing parameter, so the default preserves current behaviour. Islands inside a shadow root can now be activated as well as deactivated, and a shadow subtree with no props block of its own falls back to the document's.

Verified by: `src/dom/__tests__/activate-isolation.test.ts` > "activates islands inside a shadow root when one is passed as root"
Verified by: `src/dom/__tests__/activate-isolation.test.ts` > "falls back to the document props block for a shadow subtree"

#### `marker-parse-not-digit-anchored` - FIXED (risk: behavioral-additive)

*src/dom/hydrate.ts:316*

The client marker predicates (isIslandStart/isShowStart/isTextStart/isListStart and collectMarkers) accept any comment whose data merely STARTS with the prefix — `f:t`, `f:s`, `f:l`, `f:i` — without requiring a digit suffix. The walker's Comment opcode passes authored comment text through nearly verbatim (only `--` escaped, walker.rs:560-567), so a user comment like `<!--f:side note-->` in a template is misparsed as a show marker during adoption, desyncing the cursor walk for the rest of that parent. All real emitters produce only `f:<kind><decimal digits>`.

Proposed: Tighten the predicates to require at least one trailing decimal digit (e.g. check charCodeAt(3) is 0x30-0x39). Strictly narrows client parsing to exactly what every downstream emitter produces; no wire change. Cheap defense against authored-comment collisions.

**Fixed:** All four predicates and `collectMarkers` share one `markerIndex` parser that requires every character after the kind to be a decimal digit — exactly what the Rust walker's `push_u16` emits and what the compiler emits. This narrows client parsing; it does not change the wire format.

Verified by: `src/dom/__tests__/hydrate.test.ts` > "ignores an authored comment that only shares a marker prefix"
Verified by: `src/dom/__tests__/hydrate.test.ts` > "adopts a show region even when an authored comment precedes it"

## Added during review

Two URL-safety gaps found while triaging `data-svg-scheme-comment-false`.

#### `url-attrs-missing-object-data` - FIXED

*src/security/url-safety.ts:25*

`URL_ATTRS` lists href, src, action, formaction, xlink:href, poster and
background, but not `data` - the URL attribute of `<object>`. So
`<object data="data:text/html,<script>...">` is not scheme-checked at all, not
even against the schemes `DANGEROUS_SCHEME_RE` already covers. One-line fix;
`srcset` is also unchecked but is image-context only, so nothing executes there.

**Fixed:** `data` was added to `URL_ATTRS`, so `<object data=…>` is scheme-checked on every path. `srcset` remains deliberately unchecked and the reason is now written down rather than assumed.

Verified by: `src/security/__tests__/url-safety.test.ts` > "treats the object data attribute as URL-bearing"
Verified by: `src/dom/__tests__/element-url-safety.test.ts` > "drops javascript: from the object data attribute"
Verified by: `src/ssr/__tests__/render-safety.test.ts` > "drops javascript: and data:text/html from object data"

#### `svg-data-url-needs-context-aware-check` - FIXED

*src/security/url-safety.ts:21*

The comment claims `data:image/svg+xml` "in a navigable context is handled
separately", but no such control exists - the scheme allowlist permits all
`data:image/*` in every sink. It cannot simply be added to
`DANGEROUS_SCHEME_RE`, because the same predicate serves two browser contexts:
an SVG in `<img src>` loads in image mode (no script execution, external refs
blocked - the legitimate inline-icon case), while `<iframe src>`, `<object
data>`, `<embed src>` and `<a href>` parse it as a document where `onload=`
fires.

The fix is to make the check context-aware: give `isDangerousUrl` an optional
`tag` argument and reject `data:image/svg+xml` only for document-context sinks,
defaulting to the strict interpretation when no tag is supplied so a call site
that forgets to pass one fails safe. Both call sites can supply it -
`renderAttr` (src/ssr/render.ts:49) does not take the tag today but its callers
hold `VNode.tag`, and `isUnsafeAttrBinding` (src/runtime.ts:131) is called with
the element in hand. That makes the comment true rather than deleting it.

Exploitability is limited - browsers give `data:` URLs an opaque origin, so a
payload cannot read the embedding page, and top-level `data:` navigation has
been blocked since 2017 - so this is defence-in-depth. It is still worth closing
because the code currently claims to have closed it.

**Fixed:** Implemented as filed: `isDangerousUrl(value, tag?)` with an `IMAGE_CONTEXT_TAGS` allowlist, strict when no tag is given. Both call sites supply one — `renderAttr` takes the tag from `VNode.tag`, and the client paths pass `el.localName`.

Verified by: `src/security/__tests__/url-safety.test.ts` > "blocks data:image/svg+xml when no tag is supplied"
Verified by: `src/ssr/__tests__/render-safety.test.ts` > "keeps data:image/svg+xml on an img but drops it on an iframe"
Verified by: `src/ssr/__tests__/render-safety.test.ts` > "renderAttr with no tag falls back to the strict interpretation"
Verified by: `src/dom/__tests__/element-url-safety.test.ts` > "drops data:image/svg+xml on an iframe but keeps it on an img"
