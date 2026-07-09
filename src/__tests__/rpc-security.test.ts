import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRPCMiddleware,
  handleRPC,
  registerServerFunction,
  setRPCGuard,
} from '../server';

afterEach(() => {
  setRPCGuard(undefined);
  delete (Object.prototype as Record<string, unknown>).polluted;
});

describe('RPC handler security (1.4.0)', () => {
  it('global guard can deny a call with 403 and does not invoke the fn', async () => {
    const ep = `/rpc/secret_${Date.now()}`;
    const spy = vi.fn(async () => 'ran');
    registerServerFunction(ep, spy);
    setRPCGuard(() => false);

    const result = await handleRPC(ep, { args: [] });
    expect(result.error).toBe('Forbidden');
    expect((result as { status?: number }).status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });

  it('per-call authorize option overrides and allows the call', async () => {
    const ep = `/rpc/ok_${Date.now()}`;
    registerServerFunction(ep, async () => 'yes');
    const result = await handleRPC(ep, { args: [] }, undefined, {
      authorize: () => true,
    });
    expect(result).toEqual({ data: 'yes' });
  });

  it('deep-strips __proto__ from nested args so a merging fn cannot pollute Object.prototype', async () => {
    const ep = `/rpc/merge_${Date.now()}`;
    registerServerFunction(ep, async (input: unknown) => {
      const target: Record<string, unknown> = {};
      const merge = (t: Record<string, unknown>, s: Record<string, unknown>) => {
        for (const k of Object.keys(s)) {
          const v = s[k];
          if (v && typeof v === 'object') {
            t[k] = t[k] ?? {};
            merge(t[k] as Record<string, unknown>, v as Record<string, unknown>);
          } else {
            t[k] = v;
          }
        }
        return t;
      };
      return merge(target, input as Record<string, unknown>);
    });

    const malicious = JSON.parse('{"a":{"__proto__":{"polluted":true}}}');
    const result = await handleRPC(ep, { args: [malicious] });
    expect(result.error).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('direct path returns 400 when body.args is not an array', async () => {
    const ep = `/rpc/needargs_${Date.now()}`;
    registerServerFunction(ep, async () => 'x');
    const result = await handleRPC(ep, {} as { args: unknown[] });
    expect(result.error).toBe('Invalid RPC request: missing args array');
    expect((result as { status?: number }).status).toBe(400);
  });

  it('unknown endpoint reports status 404 (not 500)', async () => {
    const result = await handleRPC('/rpc/does-not-exist', { args: [] });
    expect((result as { status?: number }).status).toBe(404);
  });
});

describe('createRPCMiddleware enforcement (1.4.0)', () => {
  function mockRes() {
    const json = vi.fn();
    const statusJson = vi.fn();
    const status = vi.fn().mockReturnValue({ json: statusJson });
    return { json, statusJson, status };
  }

  it('rejects missing X-Forma-RPC header with 403', async () => {
    const mw = createRPCMiddleware();
    const res = mockRes();
    await mw(
      { method: 'POST', url: '/rpc/x', path: '/rpc/x', body: { args: [] },
        headers: { 'content-type': 'application/json' } },
      { json: res.json, status: res.status },
    );
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rejects non-JSON content-type with 415', async () => {
    const mw = createRPCMiddleware();
    const res = mockRes();
    await mw(
      { method: 'POST', url: '/rpc/x', path: '/rpc/x', body: { args: [] },
        headers: { 'x-forma-rpc': '1', 'content-type': 'text/plain' } },
      { json: res.json, status: res.status },
    );
    expect(res.status).toHaveBeenCalledWith(415);
  });

  it('resolves the endpoint path ignoring the query string', async () => {
    const ep = `/rpc/qs_${Date.now()}`;
    registerServerFunction(ep, async () => 'hit');
    const mw = createRPCMiddleware();
    const res = mockRes();
    await mw(
      { method: 'POST', url: `${ep}?trace=1`, path: undefined,
        body: { args: [] },
        headers: { 'x-forma-rpc': '1', 'content-type': 'application/json' } },
      { json: res.json, status: res.status },
    );
    expect(res.json).toHaveBeenCalledWith({ data: 'hit' });
    expect(res.status).not.toHaveBeenCalledWith(404);
  });

  it('maps unknown function to 404 and guard denial to 403', async () => {
    const mw404 = createRPCMiddleware();
    const r404 = mockRes();
    await mw404(
      { method: 'POST', url: '/rpc/nope', path: '/rpc/nope', body: { args: [] },
        headers: { 'x-forma-rpc': '1', 'content-type': 'application/json' } },
      { json: r404.json, status: r404.status },
    );
    expect(r404.status).toHaveBeenCalledWith(404);

    const ep = `/rpc/guarded_${Date.now()}`;
    registerServerFunction(ep, async () => 'x');
    const mw403 = createRPCMiddleware({ guard: () => false });
    const r403 = mockRes();
    await mw403(
      { method: 'POST', url: ep, path: ep, body: { args: [] },
        headers: { 'x-forma-rpc': '1', 'content-type': 'application/json' } },
      { json: r403.json, status: r403.status },
    );
    expect(r403.status).toHaveBeenCalledWith(403);
  });

  it('maps a handler throw to 500', async () => {
    const ep = `/rpc/boom_${Date.now()}`;
    registerServerFunction(ep, async () => { throw new Error('kaboom'); });
    const mw = createRPCMiddleware();
    const res = mockRes();
    await mw(
      { method: 'POST', url: ep, path: ep, body: { args: [] },
        headers: { 'x-forma-rpc': '1', 'content-type': 'application/json' } },
      { json: res.json, status: res.status },
    );
    expect(res.status).toHaveBeenCalledWith(500);
  });
});