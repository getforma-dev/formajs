/**
 * Single-flight mutation revalidation.
 *
 * `src/server/mutation.ts` sat at 5.88% statements with NO test file, while
 * `registerResource`, `unregisterResource`, `applyRevalidation`,
 * `enableAutoRevalidation` and `withRevalidation` are all public on
 * `@getforma/core/server`. Every one of them could be replaced with a no-op and
 * the suite stayed green.
 *
 * These drive real resources, not mocks: the observable is the resource's own
 * value changing — or, for the negative cases, deliberately NOT changing.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createRoot, createResource } from 'forma/reactive';
import {
  registerResource,
  unregisterResource,
  applyRevalidation,
  enableAutoRevalidation,
  withRevalidation,
} from '../mutation';

const registered: string[] = [];
const detach: Array<() => void> = [];

afterEach(() => {
  for (const key of registered.splice(0)) unregisterResource(key);
  for (const off of detach.splice(0)) off();
});

/** A resource that never fetches, so its value only ever changes via mutate(). */
function resourceOf<T>(initial: T): { res: ReturnType<typeof createResource<T>>; dispose: () => void } {
  let res!: ReturnType<typeof createResource<T>>;
  let dispose!: () => void;
  createRoot((d) => {
    dispose = d;
    res = createResource<T>(
      () => false as unknown as true, // falsy source: the fetcher never runs
      () => new Promise<T>(() => {}),
      { initialValue: initial },
    );
  });
  return { res, dispose };
}

function track(key: string): string {
  registered.push(key);
  return key;
}

describe('applyRevalidation', () => {
  it('pushes fresh data straight into the registered resource', () => {
    const { res, dispose } = resourceOf<string[]>(['old']);
    registerResource(track('/api/todos'), res as never);

    applyRevalidation({ '/api/todos': ['a', 'b'] });

    expect(res()).toEqual(['a', 'b']);
    dispose();
  });

  it('revalidates several resources from one response and leaves others alone', () => {
    const todos = resourceOf<string[]>(['old-todos']);
    const user = resourceOf<{ name: string }>({ name: 'old-user' });
    const other = resourceOf<number>(1);
    registerResource(track('/api/todos'), todos.res as never);
    registerResource(track('/api/user'), user.res as never);
    registerResource(track('/api/other'), other.res as never);

    applyRevalidation({ '/api/todos': ['fresh'], '/api/user': { name: 'fresh' } });

    expect(todos.res()).toEqual(['fresh']);
    expect(user.res()).toEqual({ name: 'fresh' });
    expect(other.res()).toBe(1); // untouched — this is the two-sided half
    todos.dispose(); user.dispose(); other.dispose();
  });

  it('an unknown key is ignored rather than throwing', () => {
    const { res, dispose } = resourceOf<string>('kept');
    registerResource(track('/api/known'), res as never);

    applyRevalidation({ '/api/never-registered': 'x' });

    expect(res()).toBe('kept');
    dispose();
  });

  it('a resource that was unregistered stops receiving revalidations', () => {
    const { res, dispose } = resourceOf<string>('v1');
    registerResource('/api/todos', res as never);
    applyRevalidation({ '/api/todos': 'v2' });
    expect(res()).toBe('v2');

    unregisterResource('/api/todos');
    applyRevalidation({ '/api/todos': 'v3' });

    expect(res()).toBe('v2'); // the unregister actually detached it
    dispose();
  });

  it('re-registering the same key replaces the target, it does not fan out', () => {
    const first = resourceOf<string>('first');
    const second = resourceOf<string>('second');
    registerResource(track('/api/x'), first.res as never);
    registerResource('/api/x', second.res as never);

    applyRevalidation({ '/api/x': 'fresh' });

    expect(second.res()).toBe('fresh');
    expect(first.res()).toBe('first');
    first.dispose(); second.dispose();
  });
});

describe('enableAutoRevalidation', () => {
  it('applies the payload of a forma:revalidate event', () => {
    const { res, dispose } = resourceOf<string>('before');
    registerResource(track('/api/todos'), res as never);
    detach.push(enableAutoRevalidation());

    window.dispatchEvent(
      new CustomEvent('forma:revalidate', { detail: { '/api/todos': 'after' } }),
    );

    expect(res()).toBe('after');
    dispose();
  });

  it('its cleanup function really detaches the listener', () => {
    const { res, dispose } = resourceOf<string>('v1');
    registerResource(track('/api/todos'), res as never);
    const off = enableAutoRevalidation();

    window.dispatchEvent(new CustomEvent('forma:revalidate', { detail: { '/api/todos': 'v2' } }));
    expect(res()).toBe('v2');

    off();
    window.dispatchEvent(new CustomEvent('forma:revalidate', { detail: { '/api/todos': 'v3' } }));

    expect(res()).toBe('v2');
    dispose();
  });

  it('ignores an event whose detail is not an object', () => {
    const { res, dispose } = resourceOf<string>('kept');
    registerResource(track('/api/todos'), res as never);
    detach.push(enableAutoRevalidation());

    for (const detail of [null, undefined, 'string', 42]) {
      window.dispatchEvent(new CustomEvent('forma:revalidate', { detail }));
    }

    expect(res()).toBe('kept');
    dispose();
  });
});

describe('withRevalidation', () => {
  it('carries the mutation result and the revalidation map in one response', () => {
    const created = { id: 1, text: 'Buy milk' };
    const all = [created, { id: 2, text: 'Other' }];

    const response = withRevalidation(created, { '/api/todos': all });

    expect(response).toEqual({ data: created, __revalidate: { '/api/todos': all } });
  });

  it('round-trips through applyRevalidation the way the client uses it', () => {
    // The end-to-end shape: server wraps, client applies __revalidate, and the
    // dependent resource is fresh without a second request.
    const { res, dispose } = resourceOf<string[]>(['stale']);
    registerResource(track('/api/todos'), res as never);

    const response = withRevalidation({ ok: true }, { '/api/todos': ['fresh'] });
    applyRevalidation(response.__revalidate!);

    expect(response.data).toEqual({ ok: true });
    expect(res()).toEqual(['fresh']);
    dispose();
  });
});
