import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registerServerFunction,
  getServerFunction,
  getRegisteredEndpoints,
  handleRPC,
  createRPCMiddleware,
} from '../rpc-handler';

/**
 * Helper: clear the internal registry between tests by removing known endpoints.
 * We re-register only what each test needs.
 */
function clearRegistry() {
  for (const ep of getRegisteredEndpoints()) {
    // The registry is a Map; the only public mutation API is registerServerFunction.
    // We can overwrite with a no-op, but to truly clear we rely on the module-scoped
    // Map. Instead we'll use a fresh approach: register and then use getServerFunction.
    // Actually, the simplest way is to access the map indirectly.
  }
}

describe('registerServerFunction / getServerFunction', () => {
  it('registers and retrieves a function by endpoint', () => {
    const fn = vi.fn(async () => 'ok');
    registerServerFunction('/rpc/testFn_abc123', fn);

    const retrieved = getServerFunction('/rpc/testFn_abc123');
    expect(retrieved).toBe(fn);
  });

  it('returns undefined for unregistered endpoints', () => {
    expect(getServerFunction('/rpc/doesNotExist_zzz')).toBeUndefined();
  });

  it('getRegisteredEndpoints includes registered paths', () => {
    registerServerFunction('/rpc/endpointList_111', vi.fn(async () => {}));
    const endpoints = getRegisteredEndpoints();
    expect(endpoints).toContain('/rpc/endpointList_111');
  });
});

describe('handleRPC', () => {
  const ENDPOINT = '/rpc/myHandler_xyz';

  beforeEach(() => {
    // Register a well-known handler for most tests
    registerServerFunction(ENDPOINT, async (...args: unknown[]) => {
      return { echo: args };
    });
  });

  // ------------------------------------------------------------------
  // 1. Routes to registered functions by endpoint path
  // ------------------------------------------------------------------
  it('routes to a registered function by endpoint path', async () => {
    const result = await handleRPC(ENDPOINT, { args: [1, 'hello'] });
    expect(result).toEqual({ data: { echo: [1, 'hello'] } });
  });

  // ------------------------------------------------------------------
  // 2. Returns 404-style error for unknown endpoints
  // ------------------------------------------------------------------
  it('returns error response for unknown endpoints', async () => {
    const result = await handleRPC('/rpc/nonexistent_000', { args: [] });
    expect(result.error).toMatch(/Unknown server function/);
    expect(result.data).toBeUndefined();
  });

  // ------------------------------------------------------------------
  // 3. FORBIDDEN_KEYS are blocked (prototype pollution protection)
  // ------------------------------------------------------------------
  describe('FORBIDDEN_KEYS protection', () => {
    const forbidden = ['__proto__', 'constructor', 'prototype'];

    for (const key of forbidden) {
      it(`blocks endpoint name "${key}"`, async () => {
        // Even if someone registers these (shouldn't happen), handleRPC blocks them
        registerServerFunction(`/rpc/${key}`, async () => 'should not run');

        const result = await handleRPC(`/rpc/${key}`, { args: [] });
        expect(result.error).toBe('Forbidden endpoint name');
        expect(result.data).toBeUndefined();
      });
    }

    it('blocks __proto__ even with deeper path segments', async () => {
      // The code uses endpoint.split('/').pop() to extract the final segment
      const result = await handleRPC('/api/rpc/__proto__', { args: [] });
      expect(result.error).toBe('Forbidden endpoint name');
    });
  });

  // ------------------------------------------------------------------
  // 3b. Non-forbidden but "tricky" keys are NOT blocked
  //     (toString, valueOf, hasOwnProperty are not in FORBIDDEN_KEYS)
  // ------------------------------------------------------------------
  describe('non-forbidden keys are allowed through', () => {
    const allowed = ['toString', 'valueOf', 'hasOwnProperty'];

    for (const key of allowed) {
      it(`allows endpoint name "${key}" (not in FORBIDDEN_KEYS)`, async () => {
        const fn = vi.fn(async () => `result-${key}`);
        registerServerFunction(`/rpc/${key}`, fn);

        const result = await handleRPC(`/rpc/${key}`, { args: [] });
        // These are allowed because they're not in the FORBIDDEN_KEYS set
        expect(result.data).toBe(`result-${key}`);
        expect(fn).toHaveBeenCalled();
      });
    }
  });

  // ------------------------------------------------------------------
  // 4. Malformed / missing args still calls the function (handleRPC
  //    trusts the caller to validate; middleware does the 400 check)
  // ------------------------------------------------------------------
  it('passes args to the handler function', async () => {
    const spy = vi.fn(async (a: unknown, b: unknown) => ({ a, b }));
    registerServerFunction('/rpc/argCheck_001', spy);

    await handleRPC('/rpc/argCheck_001', { args: ['x', 42] });
    expect(spy).toHaveBeenCalledWith('x', 42);
  });

  // ------------------------------------------------------------------
  // 5. Error handling: dev vs prod message sanitization
  // ------------------------------------------------------------------
  describe('error message sanitization', () => {
    const ERROR_ENDPOINT = '/rpc/throwingFn_err';

    beforeEach(() => {
      registerServerFunction(ERROR_ENDPOINT, async () => {
        throw new Error('secret database connection string leaked');
      });
    });

    it('returns generic message in production (non-dev) mode', async () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const result = await handleRPC(ERROR_ENDPOINT, { args: [] });
        expect(result.error).toBe('Internal server error');
        expect(result.error).not.toContain('database');
        expect(result.data).toBeUndefined();
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });

    it('returns the actual error message in development mode', async () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      try {
        const result = await handleRPC(ERROR_ENDPOINT, { args: [] });
        expect(result.error).toBe('secret database connection string leaked');
        expect(result.data).toBeUndefined();
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });

    it('returns generic message when error is not an Error instance', async () => {
      registerServerFunction('/rpc/throwString_err', async () => {
        throw 'raw string error'; // eslint-disable-line no-throw-literal
      });

      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      try {
        const result = await handleRPC('/rpc/throwString_err', { args: [] });
        // Even in dev mode, non-Error throws get the generic message
        // because `err instanceof Error` is false
        expect(result.error).toBe('Internal server error');
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });
  });

  // ------------------------------------------------------------------
  // 6. Successful call returns function result serialized
  // ------------------------------------------------------------------
  it('returns the function result wrapped in { data }', async () => {
    registerServerFunction('/rpc/addFn_001', async (a: unknown, b: unknown) => {
      return (a as number) + (b as number);
    });

    const result = await handleRPC('/rpc/addFn_001', { args: [3, 7] });
    expect(result).toEqual({ data: 10 });
  });

  it('returns null data when function returns null', async () => {
    registerServerFunction('/rpc/nullFn_001', async () => null);

    const result = await handleRPC('/rpc/nullFn_001', { args: [] });
    expect(result).toEqual({ data: null });
  });

  it('includes __revalidate when revalidateData is provided', async () => {
    registerServerFunction('/rpc/revalFn_001', async () => 'mutated');

    const revalData = { '/api/todos': { items: [] } };
    const result = await handleRPC('/rpc/revalFn_001', { args: [] }, revalData);
    expect(result).toEqual({
      data: 'mutated',
      __revalidate: revalData,
    });
  });

  it('does not include __revalidate when not provided', async () => {
    registerServerFunction('/rpc/noReval_001', async () => 'plain');

    const result = await handleRPC('/rpc/noReval_001', { args: [] });
    expect(result).toEqual({ data: 'plain' });
    expect(result.__revalidate).toBeUndefined();
  });
});

describe('createRPCMiddleware', () => {
  function createMockRes() {
    const jsonFn = vi.fn();
    const statusJsonFn = vi.fn();
    const statusFn = vi.fn(() => ({ json: statusJsonFn }));
    return {
      json: jsonFn,
      status: statusFn,
      // Helpers for assertions
      _jsonFn: jsonFn,
      _statusFn: statusFn,
      _statusJsonFn: statusJsonFn,
    };
  }

  it('rejects non-POST methods with 405', async () => {
    const middleware = createRPCMiddleware();
    const res = createMockRes();

    await middleware(
      { url: '/rpc/test', method: 'GET' },
      res,
    );

    expect(res._statusFn).toHaveBeenCalledWith(405);
    expect(res._statusJsonFn).toHaveBeenCalledWith({ error: 'Method not allowed' });
  });

  it('rejects missing body with 400', async () => {
    const middleware = createRPCMiddleware();
    const res = createMockRes();

    await middleware(
      { url: '/rpc/test', method: 'POST', body: undefined },
      res,
    );

    expect(res._statusFn).toHaveBeenCalledWith(400);
    expect(res._statusJsonFn).toHaveBeenCalledWith({
      error: 'Invalid RPC request: missing args array',
    });
  });

  it('rejects body without args array with 400', async () => {
    const middleware = createRPCMiddleware();
    const res = createMockRes();

    await middleware(
      { url: '/rpc/test', method: 'POST', body: { args: 'not-an-array' } },
      res,
    );

    expect(res._statusFn).toHaveBeenCalledWith(400);
    expect(res._statusJsonFn).toHaveBeenCalledWith({
      error: 'Invalid RPC request: missing args array',
    });
  });

  it('returns 500 for handler errors', async () => {
    registerServerFunction('/rpc/mw_fail', async () => {
      throw new Error('boom');
    });

    const middleware = createRPCMiddleware();
    const res = createMockRes();

    await middleware(
      { url: '/rpc/mw_fail', method: 'POST', body: { args: [] } },
      res,
    );

    expect(res._statusFn).toHaveBeenCalledWith(500);
    expect(res._statusJsonFn).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(String) }),
    );
  });

  it('returns success response via res.json for valid calls', async () => {
    registerServerFunction('/rpc/mw_ok', async (x: unknown) => (x as number) * 2);

    const middleware = createRPCMiddleware();
    const res = createMockRes();

    await middleware(
      { url: '/rpc/mw_ok', method: 'POST', body: { args: [21] } },
      res,
    );

    expect(res._jsonFn).toHaveBeenCalledWith({ data: 42 });
  });
});
