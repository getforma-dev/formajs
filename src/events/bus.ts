// Typed event bus — pub/sub pattern

/**
 * A typed publish/subscribe event bus.
 *
 * The type parameter `T` maps event names to their payload types,
 * ensuring type-safe event emission and subscription.
 */
export interface EventBus<T extends Record<string, unknown>> {
  /** Subscribe to an event. Returns an unsubscribe function. */
  on<K extends keyof T>(event: K, handler: (payload: T[K]) => void): () => void;
  /** Subscribe to an event, automatically unsubscribing after the first firing. */
  once<K extends keyof T>(event: K, handler: (payload: T[K]) => void): () => void;
  /** Emit an event to all current subscribers. */
  emit<K extends keyof T>(event: K, payload: T[K]): void;
  /** Remove a specific handler from an event. */
  off<K extends keyof T>(event: K, handler: (payload: T[K]) => void): void;
  /** Remove all handlers for all events. */
  clear(): void;
}

/**
 * Create a typed event bus for publish/subscribe messaging.
 *
 * ```ts
 * type Events = { save: { id: number }; delete: { id: number } };
 * const bus = createBus<Events>();
 *
 * const unsub = bus.on('save', (payload) => console.log(payload.id));
 * bus.emit('save', { id: 42 });
 * unsub();
 * ```
 */
export function createBus<
  T extends Record<string, unknown> = Record<string, unknown>,
>(): EventBus<T> {
  const listeners = new Map<keyof T, Set<(payload: any) => void>>();

  function getHandlers<K extends keyof T>(event: K): Set<(payload: any) => void> {
    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    return set;
  }

  function on<K extends keyof T>(
    event: K,
    handler: (payload: T[K]) => void,
  ): () => void {
    const set = getHandlers(event);
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }

  function once<K extends keyof T>(
    event: K,
    handler: (payload: T[K]) => void,
  ): () => void {
    const wrapper = (payload: T[K]) => {
      off(event, wrapper);
      handler(payload);
    };
    return on(event, wrapper);
  }

  function emit<K extends keyof T>(event: K, payload: T[K]): void {
    const set = listeners.get(event);
    if (set) {
      // Iterate over a snapshot so removals during emit are safe
      for (const handler of [...set]) {
        try {
          handler(payload);
        } catch (e) {
          console.error(`[forma] Bus handler error on "${String(event)}":`, e);
        }
      }
    }
  }

  function off<K extends keyof T>(
    event: K,
    handler: (payload: T[K]) => void,
  ): void {
    const set = listeners.get(event);
    if (set) {
      set.delete(handler);
    }
  }

  function clear(): void {
    listeners.clear();
  }

  return { on, once, emit, off, clear };
}
