/**
 * Forma Reactive
 *
 * Fine-grained reactive primitives backed by alien-signals,
 * following TC39 Signals proposal semantics.
 */

// Core primitives
export {
  createSignal,
  createValueSignal,
  value,
  type SignalGetter,
  type SignalSetter,
  type SignalOptions,
  type ValueSignalSetter,
} from './signal.js';
export { createEffect, internalEffect } from './effect.js';
export { createComputed } from './computed.js';
export { createMemo } from './memo.js';
export { batch } from './batch.js';

// Utilities
export { untrack } from './untrack.js';
export { createRoot } from './root.js';
export { onCleanup } from './cleanup.js';
export { on } from './on.js';

// Containers & patterns
export { createRef, type Ref } from './ref.js';
export { createReducer, type Dispatch } from './reducer.js';
export { createResource, type Resource, type ResourceOptions } from './resource.js';

// Suspense context (shared between reactive/resource and dom/suspense)
export {
  getSuspenseContext,
  pushSuspenseContext,
  popSuspenseContext,
  type SuspenseContext,
} from './suspense-context.js';

// Dev & observability
export { onError, __DEV__ } from './dev.js';
