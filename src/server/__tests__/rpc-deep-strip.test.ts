/**
 * Regression suite for `rpc-deep-strip-stack-overflow`.
 *
 * `deepStripForbidden` recursed once per nesting level over a fully
 * attacker-controlled body, before any authorization guard and outside
 * `handleRPC`'s try/catch. A deeply nested request overflowed the stack, and the
 * RangeError escaped through `createRPCMiddleware`'s un-awaited-in-try call as
 * an unhandled rejection — process death under Node's default
 * `--unhandled-rejections=throw`, remote and unauthenticated.
 */
import { describe, it, expect, vi } from 'vitest';
import { createRPCMiddleware, handleRPC, registerServerFunction } from '../rpc-handler';

/** Build a `depth`-deep chain of objects; returns [root, leaf]. */
function buildDeepChain(depth: number): [Record<string, unknown>, Record<string, unknown>] {
  const root: Record<string, unknown> = {};
  let cursor = root;
  for (let i = 0; i < depth; i++) {
    const next: Record<string, unknown> = {};
    cursor['child'] = next;
    cursor = next;
  }
  return [root, cursor];
}

/** A mock Express-style response that records what the middleware sent. */
function mockRes() {
  const sent: { code: number; body: unknown }[] = [];
  const res = {
    json: (body: unknown) => { sent.push({ code: 200, body }); },
    status: (code: number) => ({ json: (body: unknown) => { sent.push({ code, body }); } }),
  };
  return { res, sent };
}

const DEPTH = 50_000;

describe('deepStripForbidden depth safety', () => {
  it('strips forbidden keys at a depth that overflows a recursive walk', async () => {
    registerServerFunction('/rpc/deepEcho', async (...args: unknown[]) => args.length);

    const [root, leaf] = buildDeepChain(DEPTH);
    // JSON.parse is the only way to get `__proto__` as a real own key.
    leaf['payload'] = JSON.parse('{"__proto__":{"polluted":true},"keep":1}');

    // Control: prove this structure really is deep enough to blow the stack,
    // so the test cannot silently stop testing anything if DEPTH is lowered.
    const recursiveWalk = (v: unknown): void => {
      if (v && typeof v === 'object') {
        for (const k of Object.keys(v as Record<string, unknown>)) {
          recursiveWalk((v as Record<string, unknown>)[k]);
        }
      }
    };
    expect(() => recursiveWalk(root)).toThrow(RangeError);

    const result = await handleRPC('/rpc/deepEcho', { args: [root] });

    expect(result.error).toBeUndefined();
    expect(result.data).toBe(1);
    const payload = leaf['payload'] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(payload, '__proto__')).toBe(false);
    expect(payload['keep']).toBe(1);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('terminates on a cyclic argument graph', async () => {
    registerServerFunction('/rpc/cyclic', async () => 'ok');

    const a: Record<string, unknown> = JSON.parse('{"__proto__":{"polluted":true},"name":"a"}');
    const b: Record<string, unknown> = { a };
    a['b'] = b; // cycle: a -> b -> a

    const result = await handleRPC('/rpc/cyclic', { args: [a] });

    expect(result.data).toBe('ok');
    expect(Object.prototype.hasOwnProperty.call(a, '__proto__')).toBe(false);
  });

  it('rejects args that throw while being read instead of propagating', async () => {
    registerServerFunction('/rpc/hostileArgs', async () => 'ok');

    const args: unknown[] = [];
    Object.defineProperty(args, 0, {
      get() { throw new Error('hostile getter'); },
      enumerable: true,
      configurable: true,
    });
    Object.defineProperty(args, 'length', { value: 1, writable: true });

    const result = await handleRPC('/rpc/hostileArgs', { args });
    expect(result.status).toBe(400);
    expect(result.error).toContain('unreadable args');
  });
});

describe('createRPCMiddleware error barrier', () => {
  const headers = { 'x-forma-rpc': '1', 'content-type': 'application/json' };

  it('answers a deeply nested body instead of rejecting', async () => {
    registerServerFunction('/rpc/deepMw', async () => 'done');
    const [root] = buildDeepChain(DEPTH);
    const middleware = createRPCMiddleware();
    const { res, sent } = mockRes();

    await expect(
      middleware(
        { url: '/rpc/deepMw', method: 'POST', headers, body: { args: [root] } },
        res,
      ),
    ).resolves.toBeUndefined();

    expect(sent).toEqual([{ code: 200, body: { data: 'done' } }]);
  });

  it('degrades to 500 instead of rejecting when request handling throws', async () => {
    const middleware = createRPCMiddleware();
    const { res, sent } = mockRes();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // No `path` and no `url`: resolving the endpoint throws inside the
    // middleware body. Whatever the cause, the caller must get a response
    // rather than an unhandled rejection.
    await expect(
      middleware(
        { url: undefined as unknown as string, method: 'POST', headers, body: { args: [] } },
        res,
      ),
    ).resolves.toBeUndefined();

    expect(sent).toEqual([{ code: 500, body: { error: 'Internal server error' } }]);
    errSpy.mockRestore();
  });
});
