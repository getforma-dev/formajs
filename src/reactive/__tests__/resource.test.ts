import { describe, it, expect, vi } from 'vitest';
import { createResource } from '../resource';
import { createSignal } from '../signal';
import { createRoot } from '../root';

describe('createResource', () => {
  it('starts in loading state', () => {
    createRoot(() => {
      const resource = createResource(
        () => true,
        () => Promise.resolve('data'),
      );
      expect(resource.loading()).toBe(true);
      expect(resource()).toBe(undefined);
      expect(resource.error()).toBe(undefined);
    });
  });

  it('resolves data from fetcher', async () => {
    let resolvedData: string | undefined;
    createRoot(() => {
      const resource = createResource(
        () => true,
        () => Promise.resolve('hello'),
      );
      // Data resolves asynchronously
      Promise.resolve().then(() => {
        resolvedData = resource();
      });
    });
    // Flush microtasks
    await new Promise((r) => setTimeout(r, 0));
    expect(resolvedData).toBe('hello');
  });

  it('sets error on fetcher rejection', async () => {
    let errorVal: unknown;
    createRoot(() => {
      const resource = createResource(
        () => true,
        () => Promise.reject(new Error('fail')),
      );
      Promise.resolve()
        .then(() => new Promise((r) => setTimeout(r, 0)))
        .then(() => {
          errorVal = resource.error();
        });
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(errorVal).toBeInstanceOf(Error);
    expect((errorVal as Error).message).toBe('fail');
  });

  it('refetches when source signal changes', async () => {
    const fetchLog: number[] = [];
    createRoot(() => {
      const [id, setId] = createSignal(1);
      const resource = createResource(id, (val) => {
        fetchLog.push(val);
        return Promise.resolve(`user-${val}`);
      });
      // Change source
      setId(2);
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchLog).toEqual([1, 2]);
  });

  it('mutate() overrides data directly', async () => {
    let resource: any;
    createRoot(() => {
      resource = createResource(
        () => true,
        () => Promise.resolve('fetched'),
      );
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(resource()).toBe('fetched');

    resource.mutate('manually-set');
    expect(resource()).toBe('manually-set');
  });

  it('supports initialValue option', () => {
    createRoot(() => {
      const resource = createResource(
        () => true,
        () => Promise.resolve('later'),
        { initialValue: 'initial' },
      );
      expect(resource()).toBe('initial');
    });
  });

  it('loading becomes false after resolve', async () => {
    let resource: any;
    createRoot(() => {
      resource = createResource(
        () => true,
        () => Promise.resolve('done'),
      );
    });
    expect(resource.loading()).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(resource.loading()).toBe(false);
  });
});
