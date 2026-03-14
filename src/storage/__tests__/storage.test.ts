import { describe, it, expect, beforeEach } from 'vitest';
import { createLocalStorage } from '../local';
import { createSessionStorage } from '../session';

describe('createLocalStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('get returns null when key does not exist', () => {
    const store = createLocalStorage<string>('test-key');
    expect(store.get()).toBe(null);
  });

  it('set and get round-trips JSON values', () => {
    const store = createLocalStorage<{ name: string }>('user');
    store.set({ name: 'Alice' });
    expect(store.get()).toEqual({ name: 'Alice' });
  });

  it('stores primitives', () => {
    const numStore = createLocalStorage<number>('count');
    numStore.set(42);
    expect(numStore.get()).toBe(42);

    const strStore = createLocalStorage<string>('greeting');
    strStore.set('hello');
    expect(strStore.get()).toBe('hello');

    const boolStore = createLocalStorage<boolean>('flag');
    boolStore.set(true);
    expect(boolStore.get()).toBe(true);
  });

  it('stores arrays', () => {
    const store = createLocalStorage<number[]>('items');
    store.set([1, 2, 3]);
    expect(store.get()).toEqual([1, 2, 3]);
  });

  it('remove deletes the key', () => {
    const store = createLocalStorage<string>('removable');
    store.set('temp');
    expect(store.get()).toBe('temp');
    store.remove();
    expect(store.get()).toBe(null);
  });

  it('key property is accessible', () => {
    const store = createLocalStorage<string>('my-key');
    expect(store.key).toBe('my-key');
  });

  it('supports custom serializer/deserializer', () => {
    const store = createLocalStorage<Date>('date', {
      serialize: (d) => d.toISOString(),
      deserialize: (s) => new Date(s),
    });
    const date = new Date('2026-01-01T00:00:00Z');
    store.set(date);
    const got = store.get()!;
    expect(got.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('get returns null on corrupt data', () => {
    localStorage.setItem('corrupt', '{invalid json');
    const store = createLocalStorage<any>('corrupt');
    expect(store.get()).toBe(null);
  });
});

describe('createSessionStorage', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('get returns null when key does not exist', () => {
    const store = createSessionStorage<string>('sess-key');
    expect(store.get()).toBe(null);
  });

  it('set and get round-trips JSON values', () => {
    const store = createSessionStorage<{ token: string }>('auth');
    store.set({ token: 'abc123' });
    expect(store.get()).toEqual({ token: 'abc123' });
  });

  it('remove deletes the key', () => {
    const store = createSessionStorage<string>('temp');
    store.set('data');
    store.remove();
    expect(store.get()).toBe(null);
  });

  it('key property is accessible', () => {
    const store = createSessionStorage<string>('sess-id');
    expect(store.key).toBe('sess-id');
  });

  it('custom serializer works', () => {
    const store = createSessionStorage<number>('num', {
      serialize: (n) => String(n * 2),
      deserialize: (s) => parseInt(s, 10) / 2,
    });
    store.set(21);
    expect(store.get()).toBe(21);
  });
});
