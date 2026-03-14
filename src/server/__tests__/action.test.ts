import { describe, it, expect, vi } from 'vitest';
import { createAction } from '../action';

describe('createAction', () => {
  it('calls the server function and returns result', async () => {
    const serverFn = vi.fn(async (x: number) => x * 2);
    const action = createAction(serverFn);

    const result = await action(5);
    expect(result).toBe(10);
    expect(serverFn).toHaveBeenCalledWith(5);
  });

  it('pending signal is true during execution', async () => {
    let resolve!: (v: string) => void;
    const serverFn = vi.fn(() => new Promise<string>(r => { resolve = r; }));
    const action = createAction(serverFn);

    expect(action.pending()).toBe(false);

    const promise = action();
    expect(action.pending()).toBe(true);

    resolve('done');
    await promise;
    expect(action.pending()).toBe(false);
  });

  it('error signal captures rejection', async () => {
    const serverFn = vi.fn(async () => { throw new Error('server down'); });
    const action = createAction(serverFn);

    expect(action.error()).toBe(undefined);

    await expect(action()).rejects.toThrow('server down');
    expect(action.error()).toBeInstanceOf(Error);
    expect((action.error() as Error).message).toBe('server down');
  });

  it('clearError resets the error state', async () => {
    const serverFn = vi.fn(async () => { throw new Error('oops'); });
    const action = createAction(serverFn);

    await expect(action()).rejects.toThrow();
    expect(action.error()).toBeTruthy();

    action.clearError();
    expect(action.error()).toBe(undefined);
  });

  it('runs optimistic callback before server function resolves', async () => {
    const order: string[] = [];

    const action = createAction(
      async () => {
        // Simulate async delay
        await new Promise(r => setTimeout(r, 10));
        order.push('server-resolved');
      },
      {
        optimistic: () => { order.push('optimistic'); },
      },
    );

    const promise = action();
    // optimistic runs synchronously, server fn hasn't resolved yet
    expect(order).toEqual(['optimistic']);

    await promise;
    expect(order).toEqual(['optimistic', 'server-resolved']);
  });

  it('runs onSuccess after server resolves', async () => {
    const spy = vi.fn();
    const action = createAction(
      async (x: number) => x * 10,
      { onSuccess: spy },
    );

    await action(3);
    expect(spy).toHaveBeenCalledWith(30, 3);
  });

  it('runs onError after server rejects', async () => {
    const spy = vi.fn();
    const action = createAction(
      async () => { throw new Error('fail'); },
      { onError: spy },
    );

    await expect(action()).rejects.toThrow('fail');
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it('error clears on next successful call', async () => {
    let shouldFail = true;
    const action = createAction(async () => {
      if (shouldFail) throw new Error('fail');
      return 'ok';
    });

    await expect(action()).rejects.toThrow();
    expect(action.error()).toBeTruthy();

    shouldFail = false;
    await action();
    expect(action.error()).toBe(undefined);
  });

  it('pending resets even on error', async () => {
    const action = createAction(async () => { throw new Error('fail'); });

    await expect(action()).rejects.toThrow();
    expect(action.pending()).toBe(false);
  });
});
