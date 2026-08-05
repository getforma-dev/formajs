# FormaJS hardening audit - 2026-08-05

A five-lens audit (docs-vs-behavior, security, reactive-core correctness,
packaging/CI, downstream contract) of @getforma/core 1.5.0. Every finding below
was adversarially re-verified against the source before landing here; 54 raw
findings produced 38 confirmed, 1 confirmed-with-caveats, 15 recommendations,
and 0 that survived as false positives.

Fixing was interrupted partway, so **almost everything here is still open**.
Status is tracked per row: FIXED, or OPEN.

Scope note: this ecosystem has no external users - ksx Studio is the only real
consumer. Breaking app-facing behaviour or public API is acceptable; the FMIR
binary layout and the hydration wire contract (`f:tN`/`f:sN`/`f:lN`/`f:iN`
markers, `data-forma-*` attributes, the `__forma_islands` protocol) are not,
because the Rust walker and ksx depend on them byte-for-byte.

## Confirmed findings

### Critical

#### `csp-safe-by-default-is-false-in-shipped-standard-build` - OPEN

*src/runtime.ts:350*

The headline CSP promise is false for the build every README/CDN snippet points at. The standard `formajs-runtime.global.js` / `dist/runtime.js` ships with the `new Function()` fallback ENABLED by default, and it is used silently for any expression the hand-written parser cannot handle. README.md:234 ("no `eval()`, no `new Function()` by default"), README.md:349, CSP.md:3 ("CSP-safe by default. No `unsafe-inline` or `unsafe-eval` required"), CSP.md:56 (table row `new Function(...)` → "FormaJS uses it? **No**") and SECURITY.md:27 ("`new Function` is present but only reached when `_allowUnsafeEval` is explicitly enabled") all state the opposite. Under the strict header CSP.md:87-95 recommends (`script-src 'nonce-…' 'self'`, no `unsafe-eval`), `new Function` throws EvalError, the catch at src/runtime.ts:2062 swallows it, and the expression silently evaluates to `undefined` — the page renders wrong with only a console message.

#### `client-url-attr-xss-h` - OPEN

*src/dom/element.ts:422*

The client DOM path (`h()` and hydration) writes URL-bearing attributes (href/src/action/formaction/poster/xlink:href) with no dangerous-scheme check, while the SSR renderer drops them. Any Forma app that renders a URL from server/user data — the documented `h("img", { src: item.art })` / `h("a", { href: item.url })` pattern — is a stored-XSS sink on the client, and the SSR-blocked payload is *re-added* at hydration.

### Major

#### `readme-showcase-example-cannot-run-on-hardened-build` - OPEN

*README.md:206*

The README's flagship "what you get from a single HTML file with one script tag" example uses arrow functions inside `data-computed` and `data-list` (`items.filter(i => i.toLowerCase().includes(query.toLowerCase()))`). The CSP-safe parser explicitly rejects arrow functions, so this example does not work on the hardened build that README.md:237 tells strict-CSP users to switch to, and works on the standard build only via `new Function`. The example is presented as the proof of the zero-build, CSP-safe story it actually disproves.

#### `security-md-sandbox-claim-overstated` - OPEN

*SECURITY.md:27*

SECURITY.md states the unsafe-eval path "is sandboxed via a `with()` + `Proxy` wrapper that blocks access to `constructor`, `__proto__`, `eval`, `Function`, and other dangerous properties." The Proxy is not a sandbox: its `has` trap returns `key in scope.getters`, so any identifier that is NOT a declared state key reports `false` and `with()` falls through to the real global scope. Arbitrary globals (`document`, `fetch`, `localStorage`, `XMLHttpRequest`) are fully reachable from any expression; only the specific blocklisted names are stopped.

#### `blocked-expression-throws-out-of-initruntime` - FIXED

*src/runtime.ts:2042*

When the unsafe-eval path rejects a blocklisted expression it `throw`s instead of degrading to the existing blocked-noop path. The throw propagates out of `buildEvaluator` → `bindElement` → `mountScope` → `initRuntime`, so a single offending expression anywhere on the page aborts runtime initialization and NO directive on the page is ever bound. Every other unsupported-expression case (src/runtime.ts:2028-2034, 2062-2067) correctly returns a noop + diagnostic, so this is inconsistent as well as fail-open-into-a-dead-page.

#### `readme-createhistory-example-throws` - OPEN

*README.md:600*

The documented `createHistory` example cannot run. README shows `const [state, setState, { undo, redo, canUndo, canRedo }] = createHistory({ text: "" })` — a tuple return taking a plain initial value. The real signature takes a `[get, set]` signal tuple as its only source argument and returns a `HistoryControls<T>` OBJECT, not an array. Running the README snippet throws `TypeError: source is not iterable`. The follow-on lines (`setState({text:"hello"})`, `state.text === "hello"`) are wrong for the same reason — the real API exposes reactive getters, not a plain object.

#### `client-inline-handler-injection` - OPEN

*src/dom/element.ts:791*

Event-handler prop detection in `h()` and `applyDynamicProps` is a case-SENSITIVE two-charCode test for lowercase `on`. A prop key with any other casing (`ONCLICK`, `Onerror`, `ONLOAD`) skips `addEventListener` and falls through to the generic `setAttribute` path, writing a real inline event-handler attribute (setAttribute ASCII-lowercases qualified names for HTML elements). SSR drops these case-insensitively, so an app that spreads server-supplied props into `h()` gets clean SSR HTML and an executing inline handler on the client.

#### `rpc-deep-strip-stack-overflow` - OPEN

*src/server/rpc-handler.ts:79*

`deepStripForbidden` recurses per nesting level over fully attacker-controlled JSON, before any authorization guard runs and outside `handleRPC`'s try/catch. A deeply nested body overflows the stack; the RangeError escapes `handleRPC`, and `createRPCMiddleware` awaits it with no try/catch, producing an unhandled promise rejection that terminates the Node process under its default `--unhandled-rejections=throw`. Remote, unauthenticated, ~120 KB request → process kill.

#### `store-proto-hijack-via-setter` - OPEN

*src/state/store.ts:530*

`createStore`'s setter assigns every own key of the update object onto the root proxy, and the proxy's `set` trap forwards to `Reflect.set(target, prop, value)`. A `__proto__` key — which `JSON.parse` creates as a real own, enumerable property — therefore invokes `Object.prototype.__proto__`'s setter with `this = target`, replacing the store object's prototype with an attacker-supplied object. Every subsequent read of a key the app hasn't explicitly set resolves through the injected prototype, so untrusted server JSON can forge state fields (`isAdmin`, `role`, feature flags) that the app never defined.

#### `hydrated-list-row-effects-never-disposed` - OPEN

*src/dom/hydrate.ts:735*

List rows created after SSR adoption (via the reconcile effect's createFn) are rendered bare — no createRoot wrapper, no dispose stored in the cache — so their reactive binding effects are never disposed: not on row removal, and not even on island root dispose (deactivateIsland/deactivateAllIslands). The effects stay subscribed to any shared signals and keep writing to detached DOM forever. This directly diverges from the CSR path in list.ts, which wraps each row in createRoot (list.ts:614) and disposes removed rows (list.ts:639-643).

#### `hydrate-error-path-zombie-effects` - OPEN

*src/dom/activate.ts:230*

If a component/adoption throws during island hydration, the effects created before the throw stay live forever: `__formaDispose` is assigned only AFTER hydrateIsland returns, so the catch path sets status='error' but never disposes the partially-built root. The island keeps reacting to signal writes (zombie writes into a 'failed' island), and deactivateIsland finds nothing to dispose — the leak is unreclaimable.

#### `show-adoption-cached-branch-goes-stale` - OPEN

*src/dom/hydrate.ts:433*

setupShowEffect calls the branch factories (`desc.whenTrue()` / `desc.whenFalse()`) directly inside its internalEffect without untrack or createRoot. Bindings created by the factory become alien-signals deps of the show effect and are torn down by purgeDeps on the next toggle — but the branch DOM is cached in thenFragment/elseFragment and re-inserted later with dead bindings. After one toggle round-trip, reactive content in the factory-created branch is permanently frozen (stale UI). show.ts explicitly guards against this exact hazard in the CSR path; the hydration path is missing the guard.

#### `throwing-binding-aborts-flush-cross-island` - OPEN

*src/reactive/effect.ts:116*

internalEffect (used for ALL DOM bindings: h() attributes/children, adoption text effects, show/list effects) runs the user-supplied binding closure with no try/catch. When a binding throws during a signal-driven re-run, alien-signals' flush aborts: every remaining queued effect for that write is skipped (only re-flagged for some future write), and the exception escapes to the setter call site in unrelated code. With shared signals across islands (a supported pattern — see shared-signals-across-islands.test.ts), one island's throwing binding makes sibling islands silently miss the update, violating the isolation promise in activate.ts ('a broken island never takes down its siblings').

#### `cdn-esm-bare-import-broken` - OPEN

*README.md:807-816*

The documented 'ESM import (modern browsers, no bundler)' CDN recipe does not work with the shipped artifacts. dist/index.js code-splits into chunks, and the reactive-core chunk imports the bare specifier 'alien-signals' (tsup externalizes package.json dependencies by default for esm/cjs; 'external: []' at tsup.config.ts:22 does not disable that). A browser loading https://cdn.jsdelivr.net/npm/@getforma/core@VERSION/dist/index.js throws 'Failed to resolve module specifier "alien-signals"'. This has been true since v1.0.7 too (same config at that tag), so the pinned example is equally broken. The 'zero-build'/'cdn' npm keywords and README both promise this path.

#### `wasm-subpath-promised-but-unshipped` - OPEN

*CHANGELOG.md:292*

CHANGELOG 0.7.1 states renderLocal/renderIsland 'remain available via direct import from `@getforma/core/wasm`', but that subpath has never shipped: src/wasm/forma-wasm.ts exists, yet tsup.config.ts has no wasm entry, dist contains no wasm output, and the exports map has no './wasm' entry. `import '@getforma/core/wasm'` fails resolution in every environment. The functions were removed from the root barrel at the same time, so this functionality is currently unreachable from the published package at all.

#### `island-shell-adoption-drift` - OPEN

*src/dom/hydrate.ts:557*

adoptNode's island-marker branch assumes an f:iN region is EMPTY (<!--f:i0--><!--/f:i0-->) and inserts freshly created DOM before the closing marker. But the compiler never emits empty island regions: emitIsland always writes a shell element between ISLAND_START/ISLAND_END (plain <div> for unresolvable components, full component root+content for resolved ones), and the Rust walker stamps data-forma-island/data-forma-component/data-forma-status onto that shell. So whenever an adopted island's tree contains a nested island region (a registered island referencing another registered island, or any Rule-11 unknown-expression island), adoption inserts a fresh duplicate of the content NEXT TO the SSR shell: duplicated visible DOM, plus either double hydration (registered child also activated by activateIslands) or a stray dead shell with a 'No hydrate function for island "island_N"' warning and status=error (anonymous Rule-11 islands).

#### `ref-prop-breaks-adoption` - OPEN

*src/dom/hydrate.ts:204*

applyDynamicProps has no special-case for the `ref` prop. During adoption a function-valued ref is treated as a reactive attribute binding: internalEffect invokes the ref callback with NO element argument and writes the return value as a literal `ref` attribute. A ref like `(el) => el.focus()` throws TypeError synchronously inside the first effect run, which is inside hydrateIslandRoot's try — the ENTIRE island is marked status=error and stays dead. Refs that don't throw silently never receive the element. CSR h() calls ref(el) correctly (element.ts:832-833) and both SSR renderers skip ref (render.ts:132/268), so this is hydration-only drift within formajs.

### Minor

#### `dev-flag-define-is-inert-in-dist` - OPEN

*src/reactive/dev.ts:16*

The docstring claims "official prod dist builds — where tsup hard-defines `__DEV__ = false` — stay quiet regardless" and dev.ts:5 claims "Bundlers replace `__DEV__` with false → dead-code elimination removes all dev paths". Neither is true: `__DEV__` is a declared module export, so esbuild's `define` never substitutes it, no dev path is eliminated, and the shipped bundles compute it at runtime from `process.env.NODE_ENV`. Consequence: every dev `console.warn`/`console.error` ships in the published dist and fires in any Node/SSR or bundler context where NODE_ENV is unset (a common production misconfiguration).

#### `security-supported-versions-stale` - OPEN

*SECURITY.md:60*

The Supported Versions table lists only `1.0.x` as supported (and `< 1.0` unsupported) while the package is 1.5.0 with 1.1.0–1.5.0 released. A reporter reading this concludes the shipped version is out of support. The adjacent heading "Security Hardening (v0.5.0 – v1.0.0)" (SECURITY.md:41) is stale for the same reason — the 1.0.10 SSR/URL-scheme and 1.4.0 RPC hardening are described in the body but not in the version range.

#### `tc39-subpath-has-no-signal-namespace` - OPEN

*README.md:844*

README (and the Stability table at README.md:908) advertise `@getforma/core/tc39` as providing `Signal.State` and `Signal.Computed`. The subpath exports two bare classes, `State` and `Computed`; there is no `Signal` namespace object, so `import { Signal } from '@getforma/core/tc39'` — the shape the docs imply — yields undefined.

#### `cdn-snippets-pin-1.0.7` - OPEN

*README.md:801*

Every concrete CDN pin in the README points at `@getforma/core@1.0.7`, five minor releases behind the 1.5.0 package — including the "Production: Pin the version" advice at README.md:46. A reader who follows the instruction literally pins a build that predates the 1.0.10 SSR `javascript:`-scheme security fix and all 1.1–1.5 correctness work.

#### `size-claims-and-bundle-gate-drift` - OPEN

*README.md:8*

The "~24 KB gzipped" runtime figure is stale, and the CI size gate does not measure what the README claims. The CDN runtime bundle now gzips to 25.2 KB, and the "core entry ~8 KB" number is the gzip of `dist/index.js` alone — that file imports four shared chunks totalling ~14 KB gzipped that the gate never weighs, so the DOM code (chunk-YEEEQLE4.js, 9.8 KB gz) can grow without limit.

#### `island-props-vs-rpc-sanitization-not-equivalent` - OPEN

*SECURITY.md:47*

SECURITY.md says island props are "stripped of `__proto__`, `constructor`, `prototype` keys" and that "RPC call arguments are stripped equivalently". They are not equivalent: RPC sanitization is recursive, island-prop sanitization is a single shallow pass over the top-level object, so pollution keys nested inside child objects reach the island. README.md:713 states the shallowness correctly, so the two documents disagree.

#### `alien-signals-link-wrong-repo` - OPEN

*README.md:343*

The "Powered by alien-signals" credit links to `https://github.com/nicolo-ribaudo/alien-signals`, which is not the repository of the dependency actually installed.

#### `stability-table-island-test-counts-stale` - OPEN

*README.md:903*

The Stability row claims "10 activation + 88 hydration + 10 trigger tests" for islands. Activation is 13, not 10, and the figure ignores six further island test files (activate-reactivate, activate-visible, activate-visible-leak, deactivate, list-hydration, multi-island-integration, shared-signals-across-islands), so the claim both misstates and understates coverage.

#### `island-shared-props-parse-unguarded` - OPEN

*src/dom/activate.ts:69*

The shared `__forma_islands` props block is parsed with a bare `JSON.parse` outside any try/catch and outside the per-island error isolation, and the element is located by id alone. Malformed or clobbered content throws before the island loop starts, so NO island on the page hydrates — breaking the documented "a broken island never takes down its siblings" guarantee — and a user-controlled `id="__forma_islands"` node earlier in the document supplies props to every island on the page.

#### `srcdoc-raw-html-sink` - OPEN

*src/security/url-safety.ts:25*

`srcdoc` is a typed, supported prop (jsx.d.ts:238) that is a raw-HTML sink, but it is treated as an ordinary attribute by both renderers. HTML attribute escaping does not neutralize it: the browser entity-decodes the attribute value and parses the result as an HTML document that is same-origin with the page, so an SSR-escaped payload executes anyway.

#### `duplicate-forma-key-ghost-row` - OPEN

*src/dom/hydrate.ts:612*

During list adoption, `ssrKeyMap.set(key, el)` is last-wins for duplicate data-forma-key rows. The earlier duplicate is neither adopted (not in adoptedNodes) nor removed (the cleanup loop only iterates keys REMAINING in ssrKeyMap, and the duplicate's key was consumed by the match), so it survives between the list markers as a permanent ghost row that reconcileList never tracks. The CSR path at least dev-warns on duplicate keys (list.ts:561-571); adoption is silent.

#### `mount-unmount-ghost-after-csr-fallback` - OPEN

*src/dom/mount.ts:76*

mount() on a `data-forma-ssr` container ignores hydrateIsland's return value. When hydrateIsland takes the CSR fallback and REPLACES the container element (hydrate.ts:913 `target.replaceWith(result)`), the returned unmount function disposes effects but then clears `target.innerHTML` on the now-detached original element — the replacement element (with all its DOM) stays in the document after unmount.

#### `node10-subpath-types-unresolvable` - OPEN

*package.json:10*

Every subpath export (./runtime, ./runtime-hardened, ./runtime-csp, ./tc39, ./ssr, ./http, ./storage, ./server) fails to resolve under TypeScript moduleResolution 'node'/'node10' (attw: 'Resolution failed' for all subpaths; root '.' is fine via top-level main/module/types). Consumers on legacy tsconfigs cannot import the documented subpaths (README.md:838-844 documents all of them).

#### `global-subpaths-untyped-and-esm-misparse` - OPEN

*package.json:31*

'./runtime/global' and './runtime-csp/global' exports point at IIFE .js files with no 'types' condition. attw reports 'No types' for CJS/ESM/bundler and 'ESM (dynamic import only)' from CJS; publint warns the file 'is written in CJS but interpreted as ESM' because a .js file under "type":"module" is parsed as ESM (works only because the IIFE happens to parse as a module; require() from CJS Node <22 fails outright). TS consumers doing side-effect imports of these subpaths get TS7016 errors.

#### `size-gate-ignores-chunks` - OPEN

*.github/workflows/ci.yml:29-45*

The bundle-size gate (CHANGELOG 1.0.10 brags these are now 'separate, honest gates') gzips only dist/index.js (9,035 B today), but with splitting:true most core code lives in shared chunks: importing '@getforma/core' actually pulls index.js + chunk-YEEEQLE4 + chunk-3QHHKIZW + chunk-57BHU4G7 (+chunk-7BN3ZGMM) ≈ 23 KB gz total. A regression that moves code from the entry into a chunk (or grows a chunk) passes the 12 KB gate unnoticed, and the README headline 'core entry ~8 KB gzipped' measures only the entry shim.

#### `tsup-parallel-clean-race` - OPEN

*tsup.config.ts:20*

The five tsup configs build in parallel while config 1 has clean:true; the build is observably nondeterministic. In the audited run, config 4 built dist/runtime-hardened.d.ts/.d.cts ('DTS Build success in 1063ms' listing both files), yet scripts/post-build.mjs then logged 'copied dist/runtime.d.ts → dist/runtime-hardened.d.ts' — meaning config 1's later DTS phase (finished 3876 ms) clobbered config 4's already-written declarations, and only the post-build existsSync fallback resurrected them. Today the copied content is identical (same entry src/runtime.ts), but which artifact ships depends on scheduler timing, and outputs without a fallback (the IIFE globals post-build copies from) would fail the build or ship missing if the race window shifts.

#### `dev-node-floor-undeclared` - OPEN

*package.json:176*

A fresh `npm ci` EBADENGINE-warns on this machine (node 20.16.0, npm 10.8.1) because the dev toolchain's vite requires `^20.19.0 || >=22.12.0`, but the repo declares only consumer engines `"node": ">=18"` and CONTRIBUTING doesn't state a dev Node floor. CI masks this because setup-node '20' resolves to latest 20.x (≥20.19). Contributors on any 20.x below 20.19 get warnings now and hard breaks whenever a dev dep promotes engines to engine-strict or uses newer APIs.

#### `readme-stale-pins-and-orphan-global-build` - OPEN

*README.md:801-827*

Doc/artifact drift in the CDN section: (a) examples and the 'Pin the version' tip reference @getforma/core@1.0.7 while the package is 1.5.0 — users copy-pasting pin a 5-minor-versions-old runtime that predates the exports fix in bf35b21 and the 1.1–1.5 fix train; (b) dist/formajs.global.js (+340 KB map) ships in the tarball but appears nowhere in the README 'All builds' table, has no exports subpath, and is not in the sideEffects list — a 461 KB undocumented orphan that exists only as a raw CDN URL.

#### `islands-script-parse-not-isolated` - OPEN

*src/dom/activate.ts:69*

activateIslands parses the shared __forma_islands script block with a bare JSON.parse BEFORE the island loop and outside any try/catch. One malformed script block (downstream emitter bug, truncated stream, or an unrelated page element that happens to carry id="__forma_islands", including an empty one — JSON.parse('') throws) aborts activateIslands entirely: ZERO islands hydrate, including islands that use inline props or no props at all. This violates the library's own error-isolation promise ('a broken island never takes down its siblings' — activate.ts docstring and README.md:675). Per-island inline props are correctly isolated (parsed inside hydrateIslandRoot's try), making the shared-block gap an inconsistency.

#### `show-branch-list-descriptor-unadopted` - OPEN

*src/dom/hydrate.ts:493*

adoptBranchContent handles HydrationDescriptor and nested ShowDescriptor initial branches, but silently ignores ListDescriptor branches. Its closing comment claims list adoption 'is handled by the existing list adoption code in adoptNode when it encounters list markers' — but that code only runs while walking an element's desc.children; a show whose branch is DIRECTLY a list (`createShow(cond, () => createList(...))`, no wrapper element) never gets its f:lN region adopted: SSR rows stay in the DOM with no reconcile effect bound, so item updates do nothing until the first condition toggle rebuilds the branch fresh (at which point the stale SSR rows are cached and can resurface via the show fragment cache).

#### `hydration-classname-attr-drift` - OPEN

*src/dom/hydrate.ts:227*

applyDynamicProps writes reactive attribute bindings using the raw prop key with no PROP_TO_ATTR mapping: a reactive `className: () => ...` on an adopted element produces a useless `classname="..."` attribute (no styling), `htmlFor`/`tabIndex` similarly. Every other renderer in the package maps these (CSR element.ts routes className through handleClass; SSR renderAttr applies PROP_TO_ATTR), so the same component renders correctly server-side and in CSR but silently loses its class binding after hydration adoption.

## Confirmed, needs a design decision

#### `show-forward-mismatch-cache-poisoning` - OPEN

*src/dom/hydrate.ts:425*

setupShowEffect mislabels cached fragments after a forward hydration mismatch (SSR rendered the truthy branch but the client condition is false at adoption — e.g. stale server data or a downstream slot-injection bug). Initial state: currentCondition=false with the server's TRUE-branch content between the markers. On the first toggle to true, that stale true-branch content is extracted and cached as `elseFragment` (because next===true), and fresh whenTrue content is inserted — looks correct. But on the next toggle to false, `elseFragment` (the server's TRUE-branch HTML) is re-inserted as the FALSE branch: the user sees the truthy UI while the condition is false, permanently (fragments keep swapping consistently wrong from then on when whenFalse exists). The reverse mismatch (SSR empty, client true) is already detected and repaired at :407-414; the forward direction is not.

Verifier notes: Reproduced at runtime with a scratchpad probe (repo untouched). SSR true-branch content tagged data-ssr="1", client condition false at adoption: toggle 1 (->true) inserts a fresh client node (proving the effect runs and the stale content was cached as elseFragment per hydrate.ts:425-429); toggle 2 (->false) re-inserts the original SSR node (data-ssr="1", class "truthy") as the FALSE branch; toggles 3/4 repeat the cycle — the false branch permanently shows the truthy UI and whenFalse never renders. The finding is actually understated: show.ts:38 defaults elseFn to () => null, so desc.whenFalse is ALWAYS a truthy function at hydrate.ts:435 — the poisoning also hits shows with no user whenFalse (probe showed content persisting after true->false when it should be removed). The existing test (hydrate.test.ts:1550) pins only adoption + first toggle, both of which look correct; no repair path exists elsewhere (adoptBranchContent walks in place, doesn't fix static content).

Proposed: 

## Recommendations

Lower priority or requiring a judgement call. `risk` is what adopting it would break.

#### `undocumented-public-api-and-html-sinks` - OPEN (risk: none)

*src/index.ts:21*

A large part of the root export surface is documented nowhere in the markdown: `svg` (shipped in 1.3.0 per CHANGELOG.md:79 but absent from README), `createPortal`, `createSuspense`, `createMemo`, `createResource`, `persist`, `createBus`, `delegate`, `onKey`, `template`/`templateMany`, `reconcileList`, `hydrateIsland`, the whole dom-utils group, and the newly re-exported `value`/`getSignalName`/`getOwner`/`runWithOwner`. More importantly, the two HTML-injection sinks reachable from the core entry — the `dangerouslySetInnerHTML` prop on `h()` and the exported `setHTMLUnsafe` — appear in no markdown file, while CSP.md:53 flatly answers "FormaJS uses it? **No**" for the `innerHTML` row and SECURITY.md:13 characterizes the core entry only as "No network, no eval, no filesystem".

Proposed: Add a short "Escape hatches / trust boundary" section to README and a matching row in SECURITY.md's capability table naming `dangerouslySetInnerHTML`, `setHTMLUnsafe`, and the `reconcile`/`parseHTML` innerHTML paths as unsanitized first-party-only sinks; qualify the CSP.md:53 row to "not used for library-generated markup; available as an explicit opt-in sink". Then backfill the missing primitives (starting with `svg()`, `createResource`, `createSuspense`, `createPortal`) into the Core API and Stability tables.

#### `changelog-missing-unreleased-section` - OPEN (risk: none)

*CHANGELOG.md:5*

CHANGELOG.md opens with "All notable changes to this project will be documented in this file" but its newest entry is 1.5.0, while the current branch already carries two user-visible changes: the root-barrel export fix (bf35b21) that made `getOwner`/`runWithOwner`/`getSignalName`/`value`/`Owner`/`ResourceFetcherInfo` reachable from `@getforma/core` for the first time, and the SSR-with-server-data README recipe (6c67287). Because those symbols were listed as "Added" under 1.1.0 (CHANGELOG.md:149-151) but were not re-exported from the root until this branch, the changelog currently overstates what shipped in 1.1.0–1.5.0.

Proposed: Add an `## [Unreleased]` section recording the root-export fix (with a note that these 1.1.0 additions were only reachable via deep import until now) and the SSR-with-server-data docs, and add a footnote to the 1.1.0 entry pointing at it.

#### `sanitize-props-shallow-no-opt-in-deep` - OPEN (risk: behavioral-additive)

*src/dom/activate.ts:27*

`sanitizeProps` strips `__proto__`/`constructor`/`prototype` at the top level only. The limitation is honestly documented, but there is no supported way to get deep sanitization, so any island that hands a nested props object to a deep-merge, `Object.assign` chain, or `createStore` re-opens the pollution path the top-level strip was added to close.

Proposed: Export an opt-in deep sanitizer rather than changing the default: add `export function sanitizePropsDeep<T>(obj: T): T` to `src/dom/activate.ts` (iterative, WeakSet-guarded — same shape as the rpc-handler rewrite in `rpc-deep-strip-stack-overflow`, so an island can call it on props before feeding a store or merge), and cross-reference it from the README island-props section. Purely additive — new export, existing `activateIslands` behavior and cost unchanged. Making deep sanitization the default inside `loadIslandProps` is deliberately NOT proposed: it would add an unbounded per-payload walk to every hydration and silently mutate large server payloads.

#### `data-svg-scheme-comment-false` - OPEN (risk: none)

*src/security/url-safety.ts:21*

A code comment asserts that `data:image/svg+xml` in a navigable context "is handled separately", but no code anywhere handles it. The scheme allowlist deliberately permits `data:image/*`, so `data:image/svg+xml,<svg onload=…>` passes `isDangerousUrl` in every sink (SSR, data-bind, and — once the first finding is fixed — h()). Impact is limited today (browsers block top-level `data:` navigation; a `data:` iframe gets an opaque origin), but the comment misleads the next reader into thinking a control exists.

Proposed: Correct the comment to state the actual posture — that `data:image/svg+xml` is intentionally allowed, that browsers block top-level `data:` navigation and give `data:` iframes an opaque origin, and that apps embedding untrusted SVG in a navigable context should sanitize it themselves — and mirror that sentence in SECURITY.md:45 next to the existing scheme-detection bullet. Comment/doc change only; do NOT add `data:image/svg+xml` to `DANGEROUS_SCHEME_RE`, which would break legitimate inline-SVG assets across SSR and the runtime.

#### `ssr-tag-name-not-validated` - OPEN (risk: behavioral-additive)

*src/ssr/render.ts:124*

All three SSR renderers interpolate `node.tag` straight into the markup with no validation, while prop NAMES are validated by `isSafeAttrName`. A tag string derived from data (a CMS block type, an FMIR-driven component name) can inject attributes or close the tag: `sh('div onload=alert(1)', …)` emits `<div onload=alert(1)>`.

Proposed: Reuse the existing validator in the three VNode branches: `if (!isSafeAttrName(tag)) { if (__DEV__) console.warn(…); return; }` (or throw a TypeError in dev and skip the node in prod) before the first `parts.push('<', tag)`. `isSafeAttrName`'s charset (`^[A-Za-z_:][-A-Za-z0-9_:.]*$`) already accepts every valid HTML/SVG/custom-element tag name, so no legitimate tree changes output — hence no hydration-marker or wire-format impact. Filed as a recommendation rather than a fix because tag names are author-controlled in every documented usage, so it is hardening for a pattern the docs do not currently endorse.

#### `islands-inside-removed-list-rows-never-deactivated` - OPEN (risk: behavioral-additive)

*src/dom/list.ts:195*

When reconcileList removes a row whose subtree contains a child island, nothing deactivates that island: its root was created via createUnownedRoot (deliberately unowned, activate.ts:230), the row root only owns effects created in renderFn, and no removal path scans for [data-forma-island] descendants. The island's effects keep running against detached DOM until someone manually calls deactivateIsland on an element that is no longer in the document.

Proposed: Not proposed as a fix (it changes teardown behavior for removed subtrees, and animated removals via onBeforeRemove would need deactivation deferred into done()). Recommendation: in row-removal paths, if the removed node matches or contains [data-forma-island], call deactivateIsland on each at actual-removal time; alternatively document that apps embedding islands in list rows must deactivate them via onBeforeRemove. Strictly a leak fix but reported as recommendation because it adds teardown side effects to a hot public code path.

#### `adopted-rows-never-rebound` - OPEN (risk: behavioral-additive)

*src/dom/hydrate.ts:650*

SSR-matched list rows are adopted as-is: listRenderFn is never invoked for them and adoptNode is never walked into the row element, so function props (event handlers, reactive attrs) from renderFn are never attached to adopted rows — only fresh-rendered rows get them. README.md:368 and :759 document the attribute side ('Matched rows are adopted in place without re-rendering'; 'adoption skips non-function props'), but the event-handler consequence (an onClick in a createList row body silently does nothing on adopted rows until the row is re-created) is undocumented and is a likely footgun for hand-written (non-compiled) SSR apps following the new SSR-with-server-data recipe.

Proposed: Either (a) document the limitation prominently in the README list-hydration section ('event handlers inside createList row bodies do not attach to adopted rows; use delegate() on the list container'), or (b) as an opt-in future enhancement, run renderFn in hydration mode per adopted row and adoptNode the resulting descriptor against the SSR row (a larger change that must stay behind an option to preserve current adoption throughput). Do not change default behavior without compiler-contract coordination.

#### `release-workflow-hygiene` - OPEN (risk: none)

*.github/workflows/release.yml:30-49*

Several publish-pipeline gaps (none currently causing wrong artifacts, verified by clean pack): (1) the 40-line bundle-size gate is copy-pasted between ci.yml and release.yml — the limits already require dual maintenance and will drift; (2) release runs typecheck + unit tests but not the Playwright e2e suite that the CI badge implies gates the code — a hydration regression caught only by e2e could ship; (3) `npm publish` re-triggers `prepublishOnly` → the tarball is built a second time AFTER the size gate measured the first build (benign today since the build is content-deterministic, but the gate is not measuring the shipped bytes); (4) no GitHub `environment:` protection on the publish job; (5) neither workflow runs publint/attw/npm pack validation, which would have caught the node10 and global-subpath findings above; (6) publint also suggests repository.url as 'git+https://...'.

Proposed: Extract the size gate to scripts/check-size.mjs called from both workflows; add `npx playwright install --with-deps chromium && npm run test:e2e` to the release job; add `npx publint` and `npx @arethetypeswrong/cli --pack . --profile node16` steps to CI; add `environment: npm-publish` protection; prefix repository.url with `git+`. All CI/metadata-only, no artifact changes.

#### `engines-18-claim-untested` - OPEN (risk: behavioral-breaking)

*package.json:176*

engines claims Node >=18 but no CI job ever executes the published artifacts on Node 18 (matrix is 20/22/24, and the dev toolchain cannot run there since vite needs >=20.19), so the floor is an untested promise; Node 18 is also past EOL (April 2025). The shipped code targets es2022 and loaded fine on 20.16 in this audit, but nothing guards against a future dep or syntax bump breaking 18.

Proposed: Either (a) add a lightweight CI job on node-version 18 that installs only the packed tarball (`npm pack` on node 24, then on 18: `npm init -y && npm i ../getforma-core-*.tgz && node smoke.mjs` importing every subpath) — additive, keeps the promise honest; or (b) raise engines to >=20 at the next semver-major. Option (b) changes install behavior for node-18 users, hence reported as recommendation only.

#### `dual-package-and-hardened-state-duplication` - OPEN (risk: behavioral-breaking)

*tsup.config.ts:17-24*

Two undocumented multiple-instance hazards in a library whose entire value is a single shared reactive graph: (1) classic dual-package hazard — full stateful implementations ship as both ESM (dist/index.js + chunks) and CJS (dist/index.cjs + separate .cjs chunks); a process that mixes `import` and `require` of @getforma/core gets two independent forma module states (scopes, owner tree, component registry) — they only coincidentally share alien-signals because it is externalized in both; (2) './runtime-hardened' is built with splitting:false (tsup.config.ts:87, required by its different __FORMA_UNSAFE_EVAL_MODE__ define), so even a pure-ESM app importing both '@getforma/core' and '@getforma/core/runtime-hardened' gets a second private copy of the entire runtime+core internals — signals created via the root entry are invisible to the hardened runtime's registries. Neither hazard is mentioned in README/CSP.md.

Proposed: Cannot be structurally fixed within the constraints (making CJS a thin wrapper over ESM or forcing runtime-hardened onto shared chunks changes shipped module topology → behavioral-breaking for existing consumers). Recommend documenting both rules in README ('pick import OR require, never both in one process; do not mix the root entry with runtime-hardened in the same app — use runtime-hardened standalone or via its global build') and revisiting a wrapper-CJS layout at the next major.

#### `missing-package-json-export` - OPEN (risk: none)

*package.json:10*

The exports map has no './package.json' entry, so tooling that resolves it as a subpath (Vite plugin detection, bundler metadata probes, `require('@getforma/core/package.json')` in scaffolders like create-forma-app) gets ERR_PACKAGE_PATH_NOT_EXPORTED.

Proposed: Add `"./package.json": "./package.json"` to the exports map. Strictly additive.

#### `legacy-hydration-renderer-orphaned-grammar` - OPEN (risk: behavioral-breaking)

*src/ssr/render.ts:216*

renderToStringWithHydration emits a marker grammar nothing in the ecosystem consumes: `data-forma-h="N"` attributes and `<!--forma-t:N-->` / `<!--forma-l:N-->` comments. The client adoption path only parses f:tN/f:sN/f:lN/f:iN (hydrate.ts:134-188, 316-334); the Rust walker, compiler, and ksx all emit the f:* grammar. The docstring claims the markers exist 'so the client-side hydrate() function can adopt existing DOM nodes without re-creating them' — following that produces HTML whose function children are silently skipped during adoption (unknown comments just advance the cursor at hydrate.ts:835-837): no reactive bindings, no warning. Two marker dialects for the same concept in one package is exactly the kind of ecosystem drift this audit is for.

Proposed: Out of bounds to remove or change its output (public API + a wire format, even if orphaned). Recommend: (a) mark it @deprecated in TSDoc pointing at the islands/f:* pipeline and correct the false 'client-side hydrate() can adopt' claim now (docs-only, safe), and (b) in a future major, either delete it or re-emit the f:* grammar so its output becomes hydratable. Changing its emission today would alter produced HTML byte-for-byte for any external caller — hence recommendation, not a fix.

#### `activate-islands-no-shadow-root-param` - OPEN (risk: behavioral-additive)

*src/dom/activate.ts:67*

activateIslands is hardwired to `document` (both document.getElementById for the props block and document.querySelectorAll for islands), while its teardown twin deactivateAllIslands accepts a `root: Element | Document = document` parameter and the docs describe swapping Shadow DOM content (forma-stage). querySelectorAll on document does not pierce shadow roots, so islands rendered into a ShadowRoot can be deactivated but never activated — an asymmetric API for the documented use case.

Proposed: Additive optional second parameter `activateIslands(registry, root: ParentNode = document)`, using root.querySelectorAll and looking up the props block within root first, falling back to document. This is a signature extension (optional trailing param, no rename/removal, default preserves current behavior) — reported as a recommendation per the hard constraints rather than proposed as a fix.

#### `marker-parse-not-digit-anchored` - OPEN (risk: behavioral-additive)

*src/dom/hydrate.ts:316*

The client marker predicates (isIslandStart/isShowStart/isTextStart/isListStart and collectMarkers) accept any comment whose data merely STARTS with the prefix — `f:t`, `f:s`, `f:l`, `f:i` — without requiring a digit suffix. The walker's Comment opcode passes authored comment text through nearly verbatim (only `--` escaped, walker.rs:560-567), so a user comment like `<!--f:side note-->` in a template is misparsed as a show marker during adoption, desyncing the cursor walk for the rest of that parent. All real emitters produce only `f:<kind><decimal digits>`.

Proposed: Tighten the predicates to require at least one trailing decimal digit (e.g. check charCodeAt(3) is 0x30-0x39). Strictly narrows client parsing to exactly what every downstream emitter produces; no wire change. Cheap defense against authored-comment collisions.

## Added during review

Two URL-safety gaps found while triaging `data-svg-scheme-comment-false`.

#### `url-attrs-missing-object-data` - OPEN

*src/security/url-safety.ts:25*

`URL_ATTRS` lists href, src, action, formaction, xlink:href, poster and
background, but not `data` - the URL attribute of `<object>`. So
`<object data="data:text/html,<script>...">` is not scheme-checked at all, not
even against the schemes `DANGEROUS_SCHEME_RE` already covers. One-line fix;
`srcset` is also unchecked but is image-context only, so nothing executes there.

#### `svg-data-url-needs-context-aware-check` - OPEN

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
