import { describe, expect, it, vi } from 'vitest';
import {
  $$serverFunction,
  createRPCMiddleware,
  getRegisteredEndpoints,
  getServerFunction,
  handleRPC,
  registerServerFunction,
} from '../server';

describe('server integration', () => {
  it('registers and executes RPC handlers', async () => {
    const endpoint = `/rpc/sum_${Date.now()}`;
    registerServerFunction(endpoint, async (a: unknown, b: unknown) => Number(a) + Number(b));

    expect(getServerFunction(endpoint)).toBeTypeOf('function');
    expect(getRegisteredEndpoints()).toContain(endpoint);

    const result = await handleRPC(endpoint, { args: [2, 3] });
    expect(result as unknown).toBe(5);
  });

  it('blocks forbidden endpoint names', async () => {
    const result = await handleRPC('/rpc/__proto__', { args: [] });
    expect(result).toEqual({ error: 'Forbidden endpoint name' });
  });

  it('dispatches revalidation event from $$serverFunction payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { ok: true },
        __revalidate: { users: true },
      }),
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const observed: unknown[] = [];
    const listener = (event: Event) => {
      observed.push((event as CustomEvent).detail);
    };
    window.addEventListener('forma:revalidate', listener);

    const rpc = $$serverFunction<(...args: unknown[]) => Promise<unknown>>('/rpc/revalidate');
    const data = await rpc('x');

    window.removeEventListener('forma:revalidate', listener);

    expect(fetchMock).toHaveBeenCalledWith(
      '/rpc/revalidate',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(data).toEqual({ ok: true });
    expect(observed).toEqual([{ users: true }]);
  });

  it('validates middleware request shape', async () => {
    const middleware = createRPCMiddleware();

    const json = vi.fn();
    const statusJson = vi.fn();
    const status = vi.fn().mockReturnValue({ json: statusJson });

    await middleware(
      { method: 'GET', url: '/rpc/x', body: undefined },
      { json, status },
    );
    expect(status).toHaveBeenCalledWith(405);
    expect(statusJson).toHaveBeenCalledWith({ error: 'Method not allowed' });

    status.mockClear();
    statusJson.mockClear();
    json.mockClear();

    await middleware(
      { method: 'POST', url: '/rpc/x', body: {} },
      { json, status },
    );
    expect(status).toHaveBeenCalledWith(400);
    expect(statusJson).toHaveBeenCalledWith({
      error: 'Invalid RPC request: missing args array',
    });
  });
});
