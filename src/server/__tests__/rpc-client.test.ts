import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { $$serverFunction } from '../rpc-client';

describe('$$serverFunction', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Helper to create a successful Response-like object
  function okResponse(data: unknown) {
    return {
      ok: true,
      status: 200,
      json: async () => data,
      text: async () => JSON.stringify(data),
    };
  }

  // Helper to create a failing Response-like object
  function errorResponse(status: number, body: string) {
    return {
      ok: false,
      status,
      json: async () => ({ error: body }),
      text: async () => body,
    };
  }

  // ------------------------------------------------------------------
  // 1. Returns a callable function
  // ------------------------------------------------------------------
  it('returns a callable function', () => {
    mockFetch.mockResolvedValue(okResponse({ data: null }));

    const fn = $$serverFunction('/rpc/test_001');
    expect(typeof fn).toBe('function');
  });

  // ------------------------------------------------------------------
  // 2. Function makes POST to the correct endpoint with JSON body
  // ------------------------------------------------------------------
  it('makes a POST request to the correct endpoint', async () => {
    mockFetch.mockResolvedValue(okResponse({ data: 'ok' }));

    const fn = $$serverFunction('/rpc/createTodo_abc');
    await fn('hello');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('/rpc/createTodo_abc');
    expect(options.method).toBe('POST');
  });

  it('sends correct headers including Content-Type and X-Forma-RPC', async () => {
    mockFetch.mockResolvedValue(okResponse({ data: null }));

    const fn = $$serverFunction('/rpc/test_headers');
    await fn();

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Forma-RPC': '1',
    });
  });

  // ------------------------------------------------------------------
  // 3. Function serializes args correctly
  // ------------------------------------------------------------------
  it('serializes args as JSON { args: [...] }', async () => {
    mockFetch.mockResolvedValue(okResponse({ data: null }));

    const fn = $$serverFunction('/rpc/test_args');
    await fn('a', 42, true, null, { nested: [1] });

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body).toEqual({
      args: ['a', 42, true, null, { nested: [1] }],
    });
  });

  it('serializes empty args as { args: [] }', async () => {
    mockFetch.mockResolvedValue(okResponse({ data: null }));

    const fn = $$serverFunction('/rpc/test_noargs');
    await fn();

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body).toEqual({ args: [] });
  });

  // ------------------------------------------------------------------
  // 4. Function returns parsed response data
  // ------------------------------------------------------------------
  it('returns the parsed response data directly', async () => {
    mockFetch.mockResolvedValue(okResponse({ items: [1, 2, 3] }));

    const fn = $$serverFunction('/rpc/getData_001');
    const result = await fn();

    // When there's no __revalidate key, it returns result as-is from .json()
    expect(result).toEqual({ items: [1, 2, 3] });
  });

  it('returns result.data when response contains __revalidate', async () => {
    // Simulate a single-flight mutation response
    mockFetch.mockResolvedValue(okResponse({
      data: 'mutated-value',
      __revalidate: { '/api/todos': { items: [] } },
    }));

    const fn = $$serverFunction('/rpc/mutate_001');
    const result = await fn();

    // Should extract .data from the revalidation envelope
    expect(result).toBe('mutated-value');
  });

  it('dispatches forma:revalidate event when __revalidate is present', async () => {
    const revalData = { '/api/todos': { items: [] } };
    mockFetch.mockResolvedValue(okResponse({
      data: 'ok',
      __revalidate: revalData,
    }));

    const eventSpy = vi.fn();
    window.addEventListener('forma:revalidate', eventSpy);

    try {
      const fn = $$serverFunction('/rpc/revalEvent_001');
      await fn();

      expect(eventSpy).toHaveBeenCalledTimes(1);
      const event = eventSpy.mock.calls[0][0] as CustomEvent;
      expect(event.detail).toEqual(revalData);
    } finally {
      window.removeEventListener('forma:revalidate', eventSpy);
    }
  });

  // ------------------------------------------------------------------
  // 5. Handles error responses
  // ------------------------------------------------------------------
  it('throws on non-ok response with status and body', async () => {
    mockFetch.mockResolvedValue(errorResponse(500, 'Internal server error'));

    const fn = $$serverFunction('/rpc/failing_001');
    await expect(fn()).rejects.toThrow('Server function failed (500): Internal server error');
  });

  it('throws on 404 response', async () => {
    mockFetch.mockResolvedValue(errorResponse(404, 'Not found'));

    const fn = $$serverFunction('/rpc/missing_001');
    await expect(fn()).rejects.toThrow('Server function failed (404): Not found');
  });

  it('throws on network error from fetch', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const fn = $$serverFunction('/rpc/network_001');
    await expect(fn()).rejects.toThrow('Failed to fetch');
  });

  // ------------------------------------------------------------------
  // Multiple calls reuse the same function reference
  // ------------------------------------------------------------------
  it('returned function is stable and can be called multiple times', async () => {
    mockFetch
      .mockResolvedValueOnce(okResponse({ call: 1 }))
      .mockResolvedValueOnce(okResponse({ call: 2 }));

    const fn = $$serverFunction('/rpc/multi_001');
    const r1 = await fn('a');
    const r2 = await fn('b');

    expect(r1).toEqual({ call: 1 });
    expect(r2).toEqual({ call: 2 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
