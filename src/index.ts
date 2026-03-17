/// <reference path="./jsx.d.ts" />

/**
 * @getforma/core — Reactive DOM library for building web applications.
 * Signals, JSX via h(), islands architecture, SSR hydration, and more.
 * @packageDocumentation
 */

// Reactive core
export {
  createSignal, createEffect, createComputed, createMemo, batch,
  untrack, createRoot, onCleanup, on, onError,
  createRef, createReducer, createResource,
  // Reactive introspection (alien-signals 3.x)
  isSignal, isComputed, isEffect, isEffectScope,
  getBatchDepth, trigger,
} from './reactive';
export type { SignalGetter, SignalSetter, SignalOptions, Ref, Dispatch, Resource, ResourceOptions, ErrorHandler } from './reactive';

// DOM
export { h, Fragment, fragment, createText, mount, createList, cleanup, createShow, createSwitch, createPortal, createErrorBoundary, createSuspense, hydrateIsland, activateIslands, deactivateIsland, deactivateAllIslands, reconcileList, template, templateMany } from './dom';
export type { IslandHydrateFn, ReconcileResult, ListTransitionHooks, CreateListOptions, SwitchCase } from './dom';

// Component
export { defineComponent, disposeComponent, trackDisposer, onMount, onUnmount, createContext, provide, inject, unprovide } from './component';
export type { SetupFn, ComponentDef, CleanupFn, Context } from './component';

// State
export { createStore, createHistory, persist } from './state';
export type { StoreSetter, PersistOptions, HistoryControls } from './state';

// Events
export { createBus, delegate, onKey } from './events';
export type { EventBus, KeyOptions } from './events';

// DOM Utils
export { $, $$, addClass, removeClass, toggleClass, setStyle, setAttr, setText, setHTMLUnsafe,
         closest, children, siblings, parent, nextSibling, prevSibling,
         onResize, onIntersect, onMutation } from './dom-utils';

// ─── Subpath imports (not in this bundle — zero network code here) ───
// HTTP:    import { createFetch, createSSE, createWebSocket } from '@getforma/core/http'
// Storage: import { createLocalStorage, createIndexedDB } from '@getforma/core/storage'
// Server:  import { createAction, $$serverFunction } from '@getforma/core/server'
