# Changelog

All notable changes to this project will be documented in this file.

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
