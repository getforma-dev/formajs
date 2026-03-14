// Typed event bus — pub/sub pattern

export interface EventBus<T extends Record<string, unknown>> {
  on<K extends keyof T>(event: K, handler: (payload: T[K]) => void): () => void;
  once<K extends keyof T>(event: K, handler: (payload: T[K]) => void): () => void;
  emit<K extends keyof T>(event: K, payload: T[K]): void;
  off<K extends keyof T>(event: K, handler: (payload: T[K]) => void): void;
  clear(): void;
}

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
