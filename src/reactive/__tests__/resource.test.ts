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
    let read!: Promise<unknown>;
    createRoot(() => {
      const resource = createResource(
        () => true,
        () => Promise.reject(new Error('fail')),
      );
      // The error is read a macrotask later, and the test waits for that read
      // itself. It used to wait a fixed 10 ms instead, which raced the 0 ms
      // timer and lost once in 100 runs under a load average over 200
      // (FORMA-179).
      read = Promise.resolve()
        .then(() => new Promise((r) => setTimeout(r, 0)))
        .then(() => resource.error());
    });
    const errorVal = await read;
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
