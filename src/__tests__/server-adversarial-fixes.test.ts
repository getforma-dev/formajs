// Robustness defects found by adversarial verification of the 1.4.0 server/SSR work.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRPC, createRPCMiddleware, registerServerFunction, setRPCGuard } from '../server';
import { renderToStream, shSuspense, sh } from '../ssr';

afterEach(() => {
  setRPCGuard(undefined);
  delete (Object.prototype as Record<string, unknown>).polluted;
});

function mockRes() {
  const json = vi.fn();
  const statusJson = vi.fn();
  const status = vi.fn().mockReturnValue({ json: statusJson });
  return { json, statusJson, status };
}

describe('RPC guard failures are contained (HIGH)', () => {
  it('a throwing guard denies with 403 and does not leak the error (direct)', async () => {
    const ep = `/rpc/g1_${Date.now()}`;
    registerServerFunction(ep, async () => 'ran');
    setRPCGuard(() => { throw new Error('db down: secret=xyz'); });
    let threw = false;
    let result: Awaited<ReturnType<typeof handleRPC>> | undefined;
    try { result = await handleRPC(ep, { args: [] }); } catch { threw = true; }
    expect(threw).toBe(false);
    expect(result!.status).toBe(403);
    expect(result!.error).not.toContain('secret');
  });

  it('a rejecting guard in middleware sends 403 (no unhandled crash)', async () => {
    const ep = `/rpc/g2_${Date.now()}`;
    registerServerFunction(ep, async () => 'ran');
    const mw = createRPCMiddleware({ guard: async () => { throw new Error('leak me'); } });
    const res = mockRes();
    let threw = false;
    try {
      await mw(
        { method: 'POST', url: ep, path: ep, body: { args: [] },
          headers: { 'x-forma-rpc': '1', 'content-type': 'application/json' } },
        { json: res.json, status: res.status },
      );
    } catch { threw = true; }
    expect(threw).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('RPC arg sanitizer does not crash on frozen args (MEDIUM)', () => {
  it('a frozen arg with __proto__ does not throw out of handleRPC', async () => {
    const ep = `/rpc/frozen_${Date.now()}`;
    registerServerFunction(ep, async () => 'ok');
    const frozen = Object.freeze(JSON.parse('{"__proto__":{"p":1},"role":"x"}'));
    let threw = false;
    let result: Awaited<ReturnType<typeof handleRPC>> | undefined;
    try { result = await handleRPC(ep, { args: [frozen] }); } catch { threw = true; }
    expect(threw).toBe(false);
    expect(result!.error).toBeUndefined();
    expect(({} as Record<string, unknown>).p).toBeUndefined();
  });
});

describe('streaming: a sync-throwing asyncFn does not abort the stream (MEDIUM)', () => {
  it('preserves the shell and fallback and terminates', async () => {
    const stream = renderToStream(
      sh('main', null,
        'before',
        shSuspense(
          sh('span', null, 'Loading...'),
          () => { throw new Error('sync boom'); },
        ),
        'after',
      ),
    );
    let out = '';
    let threw = false;
    try { for await (const chunk of stream) out += chunk; } catch { threw = true; }
    expect(threw).toBe(false);
    expect(out).toContain('before');
    expect(out).toContain('after');
    expect(out).toContain('Loading...');
  });
});
