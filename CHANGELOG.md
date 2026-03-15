# Changelog

All notable changes to this project will be documented in this file.

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
