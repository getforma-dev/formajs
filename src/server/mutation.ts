/**
 * FormaJS Server - Mutation
 *
 * Single-flight mutation pattern: the server response carries both the
 * mutation result AND fresh data for dependent resources in one round trip.
 *
 * Without single-flight:
 *   Client -> Server: createTodo("Buy milk")
 *   Server -> Client: { id: 1, text: "Buy milk" }
 *   Client -> Server: GET /api/todos (refetch to update list)
 *   Server -> Client: [all todos]
 *
 * With single-flight:
 *   Client -> Server: createTodo("Buy milk")
 *   Server -> Client: { data: {...}, __revalidate: { "/api/todos": [all todos] } }
 *   (No second request needed!)
 */

import type { Resource } from '../reactive/resource.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MutationResponse<T> {
  /** The mutation result. */
  data: T;
  /**
   * Fresh data for dependent resources, keyed by resource identifier.
   * When present, the client updates these resources directly instead of refetching.
   */
  __revalidate?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Resource registry for revalidation
// ---------------------------------------------------------------------------

const resourceRegistry = new Map<string, Resource<unknown>>();

/**
 * Register a resource with a key so it can be revalidated by single-flight mutations.
 *
 * ```ts
 * const todos = createResource(
 *   () => true,
 *   () => fetch('/api/todos').then(r => r.json()),
 * );
 * registerResource('/api/todos', todos);
 * ```
 */
export function registerResource(key: string, resource: Resource<unknown>): void {
  resourceRegistry.set(key, resource);
}

/**
 * Unregister a resource (call on cleanup/unmount).
 */
export function unregisterResource(key: string): void {
  resourceRegistry.delete(key);
}

/**
 * Apply revalidation data from a single-flight mutation response.
 * For each key in the revalidate map, find the matching resource
 * and mutate it directly with the fresh data (skipping a refetch).
 */
export function applyRevalidation(revalidateData: Record<string, unknown>): void {
  for (const [key, freshData] of Object.entries(revalidateData)) {
    const resource = resourceRegistry.get(key);
    if (resource) {
      resource.mutate(freshData);
    }
  }
}

/**
 * Listen for revalidation events dispatched by $$serverFunction.
 * Call this once during app initialization to enable automatic
 * single-flight mutation handling.
 *
 * ```ts
 * // In your app entry:
 * import { enableAutoRevalidation } from 'forma/server/mutation';
 * enableAutoRevalidation();
 * ```
 */
export function enableAutoRevalidation(): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (detail && typeof detail === 'object') {
      applyRevalidation(detail as Record<string, unknown>);
    }
  };

  window.addEventListener('forma:revalidate', handler);

  // Return cleanup function
  return () => window.removeEventListener('forma:revalidate', handler);
}

/**
 * Wrap a server function response to include revalidation data.
 * Use this on the server side to enable single-flight mutations.
 *
 * ```ts
 * // Server-side:
 * async function createTodo(text: string) {
 *   "use server";
 *   const newTodo = await db.insert('todos', { text, done: false });
 *   const allTodos = await db.query('todos');
 *   return withRevalidation(newTodo, {
 *     '/api/todos': allTodos,
 *   });
 * }
 * ```
 */
export function withRevalidation<T>(data: T, revalidate: Record<string, unknown>): MutationResponse<T> {
  return { data, __revalidate: revalidate };
}
