/// <reference path="./jsx.d.ts" />

// Reactive core
export {
  createSignal, createEffect, createComputed, createMemo, batch,
  untrack, createRoot, onCleanup, on, onError,
  createRef, createReducer, createResource,
} from './reactive';

// DOM
export { h, Fragment, fragment, createText, mount, createList, cleanup, createShow, createSwitch, createPortal, createErrorBoundary, createSuspense, hydrateIsland, activateIslands, reconcileList, longestIncreasingSubsequence } from './dom';
export type { IslandHydrateFn } from './dom';

// Component
export { defineComponent, disposeComponent, trackDisposer, onMount, onUnmount, createContext, provide, inject, unprovide } from './component';

// State
export { createStore, createHistory, persist } from './state';

// Events
export { createBus, delegate, onKey } from './events';

// DOM Utils
export { $, $$, addClass, removeClass, toggleClass, setStyle, setAttr, setText, setHTML,
         closest, children, siblings, parent, nextSibling, prevSibling,
         onResize, onIntersect, onMutation } from './dom-utils';

// Storage
export { createLocalStorage, createSessionStorage, createIndexedDB } from './storage';

// HTTP
export { createFetch, fetchJSON, createSSE, createWebSocket } from './http';

// Server
export {
  createAction,
  registerResource,
  unregisterResource,
  applyRevalidation,
  enableAutoRevalidation,
  withRevalidation,
  $$serverFunction,
  registerServerFunction,
  getServerFunction,
  getRegisteredEndpoints,
  handleRPC,
  createRPCMiddleware,
} from './server';
export type { ActionOptions, Action } from './server';
export type { MutationResponse } from './server';
export type { RPCRequest, RPCResponse } from './server';

// WASM
export { renderLocal, renderIsland } from './wasm/forma-wasm.js';
