# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-03-13

### Added
- Reactive primitives: createSignal, createEffect, createComputed, createMemo, batch, untrack
- Virtual DOM: h(), mount(), fragment, createText
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
