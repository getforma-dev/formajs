import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createIndexedDB, createLocalStorage, createSessionStorage } from '../storage';

describe('storage integration', () => {
  it('reads and writes localStorage values', () => {
    const store = createLocalStorage<{ name: string }>('user');
    store.remove();

    expect(store.get()).toBeNull();
    store.set({ name: 'Alice' });
    expect(store.get()).toEqual({ name: 'Alice' });
    store.remove();
    expect(store.get()).toBeNull();
  });

  it('reads and writes sessionStorage values', () => {
    const store = createSessionStorage<{ token: string }>('auth');
    store.remove();

    expect(store.get()).toBeNull();
    store.set({ token: 'abc123' });
    expect(store.get()).toEqual({ token: 'abc123' });
    store.remove();
    expect(store.get()).toBeNull();
  });

  it('supports indexedDB CRUD and key listing', async () => {
    const store = createIndexedDB<{ title: string }>('formajs-test-db', 'notes');

    await store.clear();
    await store.set('n1', { title: 'One' });
    await store.set('n2', { title: 'Two' });

    expect(await store.get('n1')).toEqual({ title: 'One' });
    expect(await store.getAll()).toEqual([{ title: 'One' }, { title: 'Two' }]);
    expect(await store.keys()).toEqual(['n1', 'n2']);

    await store.delete('n1');
    expect(await store.get('n1')).toBeUndefined();

    await store.clear();
    expect(await store.getAll()).toEqual([]);
  });
});
