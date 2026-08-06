import { describe, it, expect, vi } from 'vitest';
import { persist } from '../persist';
import { createSignal } from 'forma/reactive';

function createMockStorage(): Storage {
  const data: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => (key in data ? data[key] : null)),
    setItem: vi.fn((key: string, value: string) => {
      data[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete data[key];
    }),
    clear: vi.fn(() => {
      for (const key of Object.keys(data)) delete data[key];
    }),
    get length() {
      return Object.keys(data).length;
    },
    key: vi.fn((index: number) => Object.keys(data)[index] ?? null),
  };
}

describe('persist cross-tab sync (P1)', () => {
  it('re-hydrates the signal when a storage event fires for the same key', () => {
    const storage = createMockStorage();
    const [val, setVal] = createSignal('a');
    persist([val, setVal], 'k', { storage, syncTabs: true });

    storage.setItem('k', '"b"');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'k', newValue: '"b"', storageArea: storage }),
    );

    expect(val()).toBe('b');
  });

  it('ignores storage events for a different key', () => {
    const storage = createMockStorage();
    const [val, setVal] = createSignal('a');
    persist([val, setVal], 'k', { storage, syncTabs: true });

    storage.setItem('other', '"z"');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'other', newValue: '"z"', storageArea: storage }),
    );

    expect(val()).toBe('a');
  });

  it('external re-hydration does not echo an extra write back to storage', () => {
    const storage = createMockStorage();
    const [val, setVal] = createSignal('a');
    persist([val, setVal], 'k', { storage, syncTabs: true });

    (storage.setItem as any).mockClear();
    storage.setItem('k', '"b"');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'k', newValue: '"b"', storageArea: storage }),
    );

    const writesToKey = (storage.setItem as any).mock.calls.filter(
      (c: any[]) => c[0] === 'k',
    );
    expect(writesToKey.length).toBe(1);
    expect(val()).toBe('b');
  });
});

describe('persist versioned migration (P2)', () => {
  it('migrates legacy bare (unversioned) data via migrate()', () => {
    const storage = createMockStorage();
    storage.setItem('n', '41');

    const [val, setVal] = createSignal(0);
    const migrate = vi.fn((old: unknown, oldVersion: number) => {
      expect(oldVersion).toBe(0);
      return (old as number) + 1;
    });
    persist([val, setVal], 'n', { storage, version: 1, migrate });

    expect(migrate).toHaveBeenCalledTimes(1);
    expect(val()).toBe(42);
  });

  it('does not call migrate when stored envelope version equals current version', () => {
    const storage = createMockStorage();
    const [a, setA] = createSignal(5);
    persist([a, setA], 'v', { storage, version: 2 });

    const migrate = vi.fn((old: unknown) => old as number);
    const [b, setB] = createSignal(0);
    persist([b, setB], 'v', { storage, version: 2, migrate });

    expect(migrate).not.toHaveBeenCalled();
    expect(b()).toBe(5);
  });

  it('skips hydration when data is stale and no migrate is provided', () => {
    const storage = createMockStorage();
    storage.setItem('s', '99');

    const [val, setVal] = createSignal(7);
    persist([val, setVal], 's', { storage, version: 3 });

    expect(val()).toBe(7);
  });
});

describe('persist onError reporting (P3)', () => {
  it('reports write failures (quota) via onError instead of swallowing', () => {
    const storage = createMockStorage();
    (storage.setItem as any).mockImplementation(() => {
      const e: any = new Error('quota');
      e.name = 'QuotaExceededError';
      throw e;
    });

    const onError = vi.fn();
    const [val, setVal] = createSignal('x');
    expect(() => persist([val, setVal], 'k', { storage, onError })).not.toThrow();

    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls[0][1]).toBe('write');
  });

  it('reports hydrate failures (corrupt data) via onError', () => {
    const storage = createMockStorage();
    storage.setItem('bad', '{not json');

    const onError = vi.fn();
    const [val, setVal] = createSignal('safe');
    persist([val, setVal], 'bad', { storage, onError });

    expect(val()).toBe('safe');
    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls[0][1]).toBe('hydrate');
  });
});

describe('persist disposer (P4)', () => {
  it('returns a disposer that stops further writes', () => {
    const storage = createMockStorage();
    const [val, setVal] = createSignal('a');
    const dispose = persist([val, setVal], 'k', { storage, syncTabs: false });

    expect(typeof dispose).toBe('function');
    dispose();

    (storage.setItem as any).mockClear();
    setVal('b');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('disposer removes the storage listener (no re-hydration after dispose)', () => {
    const storage = createMockStorage();
    const [val, setVal] = createSignal('a');
    const dispose = persist([val, setVal], 'k', { storage, syncTabs: true });
    dispose();

    storage.setItem('k', '"b"');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'k', newValue: '"b"', storageArea: storage }),
    );

    expect(val()).toBe('a');
  });
});

describe('persist prototype-pollution safety (invariant)', () => {
  it('does not pollute Object.prototype from a malicious __proto__ payload', () => {
    const storage = createMockStorage();
    storage.setItem('p', '{"__proto__":{"polluted":true}}');

    const [val, setVal] = createSignal<Record<string, unknown>>({});
    persist([val, setVal], 'p', { storage });

    expect(({} as any).polluted).toBeUndefined();
  });
});
// ---------------------------------------------------------------------------
// validate() — the guard that stops tampered storage reaching app state
// ---------------------------------------------------------------------------

describe('persist validate()', () => {
  const isShape = (v: unknown): v is { n: number } =>
    typeof v === 'object' && v !== null && typeof (v as { n?: unknown }).n === 'number';

  it('refuses a stored value the validator rejects, leaving the signal at its default', () => {
    // localStorage is attacker-writable from any XSS on the origin (and from
    // the user, and from a previous version of the app). `validate` is the only
    // thing standing between that and app state; replacing the check with
    // `if (true)` used to change nothing that any test could see.
    const storage = createMockStorage();
    storage.setItem('k', JSON.stringify({ evil: true }));
    const [get] = createSignal<{ n: number }>({ n: 0 });
    const stop = persist([get, () => {}] as never, 'k', { storage, validate: isShape });

    expect(get()).toEqual({ n: 0 });
    expect(get()).not.toHaveProperty('evil');
    stop();
  });

  it('accepts a stored value the validator approves', () => {
    // The two-sided half: a validator that rejected everything would satisfy
    // the test above on its own.
    const storage = createMockStorage();
    storage.setItem('k', JSON.stringify({ n: 42 }));
    let current: { n: number } = { n: 0 };
    const stop = persist(
      [() => current, (v: { n: number }) => { current = v; }] as never,
      'k',
      { storage, validate: isShape },
    );

    expect(current).toEqual({ n: 42 });
    stop();
  });

  it.each([
    ['a JSON string where an object was stored', '"just a string"'],
    ['a number', '7'],
    ['null', 'null'],
    ['an array', '[1,2,3]'],
    ['an object with the wrong field type', '{"n":"not-a-number"}'],
  ])('refuses %s', (_label, stored) => {
    const storage = createMockStorage();
    storage.setItem('k', stored);
    let current: { n: number } = { n: -1 };
    const stop = persist(
      [() => current, (v: { n: number }) => { current = v; }] as never,
      'k',
      { storage, validate: isShape },
    );
    expect(current).toEqual({ n: -1 });
    stop();
  });

  it('with no validator, any well-formed JSON hydrates — that is the documented default', () => {
    const storage = createMockStorage();
    storage.setItem('k', JSON.stringify({ anything: 1 }));
    let current: unknown = { n: 0 };
    const stop = persist([() => current, (v: unknown) => { current = v; }] as never, 'k', { storage });
    expect(current).toEqual({ anything: 1 });
    stop();
  });
});
