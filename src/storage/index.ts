/**
 * Forma Storage
 *
 * Typed wrappers for localStorage, sessionStorage, and IndexedDB.
 * Zero dependencies — native browser APIs only.
 */

export { createLocalStorage, type TypedStorage, type StorageOptions } from './local.js';
export { createSessionStorage } from './session.js';
export { createIndexedDB, type IDBStore } from './indexed.js';
