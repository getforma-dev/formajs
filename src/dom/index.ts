/**
 * Forma DOM - Public API
 *
 * Re-exports all DOM module primitives.
 */

export { h, Fragment, fragment, cleanup } from './element.js';
export { createText } from './text.js';
export { mount } from './mount.js';
export { createList, reconcileList, longestIncreasingSubsequence } from './list.js';
export type { ReconcileResult } from './list.js';
export { createShow } from './show.js';
export { createSwitch } from './switch.js';
export { createPortal } from './portal.js';
export { createErrorBoundary } from './error-boundary.js';
export { createSuspense } from './suspense.js';
export { getSuspenseContext, pushSuspenseContext, popSuspenseContext } from './suspense.js';
export type { SuspenseContext } from './suspense.js';
export { template, templateMany } from './template.js';
export { hydrateIsland } from './hydrate.js';
export { activateIslands } from './activate.js';
export type { IslandHydrateFn } from './activate.js';
