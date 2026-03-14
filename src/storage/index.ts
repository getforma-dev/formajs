/**
 * Forma Storage
 *
 * Typed wrappers for localStorage, sessionStorage, and IndexedDB.
 * Zero dependencies — native browser APIs only.
 */

export { createLocalStorage } from './local.js';
export type { TypedStorage, StorageOptions } from './types.js';
export { createSessionStorage } from './session.js';
export { createIndexedDB, type IDBStore } from './indexed.js';
