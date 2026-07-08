// WASM loader hygiene (1.5.0): response.ok on IR fetch (no caching garbage) and
// in-flight memoization of the wasm instantiate + IR fetch.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const BINARY_URL = 'https://cdn.test/forma_walker_bg.wasm';
const IR_URL = 'https://cdn.test/page.ir';

// vi.mock is hoisted above imports; use vi.hoisted so the spies exist first.
const h = vi.hoisted(() => ({
  loaderDefault: vi.fn(async (_bin?: string) => undefined),
  renderSpy: vi.fn(() => '<div>ok</div>'),
  renderIslandSpy: vi.fn(() => '<span>island</span>'),
}));

vi.mock('forma-test-loader', () => ({
  default: h.loaderDefault,
  render: h.renderSpy,
  render_island: h.renderIslandSpy,
}));

function setConfig() {
  (window as unknown as { __FORMA_WASM__: unknown }).__FORMA_WASM__ = {
    loader: 'forma-test-loader',
    binary: BINARY_URL,
    ir: IR_URL,
  };
}

function okIr(bytes: Uint8Array): Response {
  return {
    ok: true, status: 200, statusText: 'OK',
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as Response;
}
function errorIr(status: number): Response {
  const html = new TextEncoder().encode('<html>error</html>');
  return {
    ok: false, status, statusText: 'Not Found',
    arrayBuffer: async () => html.buffer.slice(0),
  } as unknown as Response;
}

beforeEach(() => {
  vi.resetModules();
  h.loaderDefault.mockReset();
  h.loaderDefault.mockImplementation(async () => undefined);
  h.renderSpy.mockClear();
  h.renderIslandSpy.mockClear();
  setConfig();
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { __FORMA_WASM__?: unknown }).__FORMA_WASM__;
});

describe('getIR response.ok handling', () => {
  it('rejects on a non-ok IR response and does NOT cache it (a later call retries)', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(errorIr(404))
      .mockResolvedValueOnce(okIr(new Uint8Array([1, 2, 3])));
    vi.stubGlobal('fetch', fetchSpy);

    const { renderLocal } = await import('../forma-wasm');
    await expect(renderLocal('{}')).rejects.toThrow(/Failed to fetch IR|404/);

    const out = await renderLocal('{}');
    expect(out).toBe('<div>ok</div>');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe('in-flight memoization', () => {
  it('two concurrent renderLocal() fetch IR once and instantiate wasm once', async () => {
    let resolveFetch!: (r: Response) => void;
    const fetchSpy = vi.fn(() => new Promise<Response>((res) => { resolveFetch = res; }));
    vi.stubGlobal('fetch', fetchSpy);

    const { renderLocal } = await import('../forma-wasm');
    const p1 = renderLocal('{"a":1}');
    const p2 = renderLocal('{"a":1}');
    await Promise.resolve();
    resolveFetch(okIr(new Uint8Array([9, 9, 9])));

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe('<div>ok</div>');
    expect(r2).toBe('<div>ok</div>');
    expect(h.loaderDefault).toHaveBeenCalledTimes(1);
    expect(h.loaderDefault).toHaveBeenCalledWith(BINARY_URL);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(IR_URL);
    expect(h.renderSpy).toHaveBeenCalledTimes(2);
  });

  it('a failed wasm instantiation is evicted so a later render retries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okIr(new Uint8Array([1]))));
    h.loaderDefault
      .mockRejectedValueOnce(new Error('instantiate failed'))
      .mockResolvedValueOnce(undefined);

    const { renderLocal } = await import('../forma-wasm');
    await expect(renderLocal('{}')).rejects.toThrow(/instantiate failed/);
    await expect(renderLocal('{}')).resolves.toBe('<div>ok</div>');
    expect(h.loaderDefault).toHaveBeenCalledTimes(2);
  });
});
