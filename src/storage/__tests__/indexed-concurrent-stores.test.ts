// IndexedDB concurrent store creation (1.5.0) — must not wedge/lose stores.
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { createIndexedDB } from '../indexed';

describe('createIndexedDB concurrent store creation', () => {
  it('creating many object stores on one db concurrently keeps them all usable', async () => {
    const dbName = 'concurrentStores_' + Math.random();
    const N = 6;
    const stores = Array.from({ length: N }, (_, i) => createIndexedDB<number>(dbName, 'store' + i));
    // Fire all writes concurrently — this races the version bumps.
    await Promise.all(stores.map((s, i) => s.set('k', i)));
    // Every store must have committed and be readable.
    for (let i = 0; i < N; i++) {
      expect(await stores[i]!.get('k')).toBe(i);
    }
  });

  it('a store that fails once still self-heals on retry (no permanent wedge)', async () => {
    const dbName = 'selfHeal_' + Math.random();
    const stores = Array.from({ length: 5 }, (_, i) => createIndexedDB<string>(dbName, 's' + i));
    await Promise.allSettled(stores.map((s) => s.set('k', 'v')));
    // Retry any that failed — they must eventually succeed.
    for (let i = 0; i < 5; i++) {
      await stores[i]!.set('k', 'v' + i);
      expect(await stores[i]!.get('k')).toBe('v' + i);
    }
  });
});
