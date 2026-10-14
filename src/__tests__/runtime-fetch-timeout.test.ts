/**
 * `data-fetch` gives up on a stalled endpoint after 30 s (FORMA-132, decision
 * brief L-46), as `createFetch` does: before, a request that never answered
 * held its `loading:` target true forever and its `error:` target never heard
 * of it. The clock is faked; the network is a fetch that settles only when its
 * signal aborts, as a real request does.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as runtime from '../runtime';

/** Requests made through the stub, each with the signal it was given. */
let requests: Array<{ url: string; init: RequestInit }> = [];

/**
 * How an engine rejects an aborted fetch. WebKit rejects with its own
 * AbortError whatever reason the signal carries, so the runtime cannot take
 * its message from the rejection.
 */
const engineAbort = () => new DOMException('Fetch is aborted', 'AbortError');

/** A fetch whose server never answers. */
function stalled(url: string, init: RequestInit = {}): Promise<Response> {
  requests.push({ url, init });
  return new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(engineAbort()));
  });
}

/** A fetch whose server answers `body` after `ms`, unless aborted first. */
const answersAfter = (ms: number, body: unknown) => (url: string, init: RequestInit = {}): Promise<Response> => {
  requests.push({ url, init });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ json: async () => body } as Response), ms);
    init.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(engineAbort()); });
  });
};

const text = (container: HTMLElement, id: string) => container.querySelector(`#${id}`)!.textContent;

describe('data-fetch timeout', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    requests = [];
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    runtime.unmount(container);
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const page = (url: string) => `
    <div data-forma-state='{}'>
      <div data-fetch="GET ${url} → items |loading:busy |error:failed"></div>
      <p id="items" data-text="{items}"></p>
      <p id="busy" data-text="{busy}"></p>
      <p id="failed" data-text="{failed}"></p>
    </div>`;

  it('a data-fetch to a stalled endpoint aborts at 30 s into its error: target', async () => {
    vi.stubGlobal('fetch', stalled);
    container.innerHTML = page('/api/stalled');
    runtime.mount(container);

    await vi.advanceTimersByTimeAsync(29_999);
    expect(text(container, 'busy')).toBe('true');
    expect(text(container, 'failed')).toBe('');
    expect(requests[0]!.init.signal!.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(requests[0]!.init.signal!.aborted).toBe(true);
    expect(text(container, 'failed')).toBe('data-fetch timed out after 30000 ms');
    expect(text(container, 'busy')).toBe('false');
    expect(text(container, 'items')).toBe('');
  });

  it('a data-fetch answered before 30 s lands in its target and is never aborted', async () => {
    vi.stubGlobal('fetch', answersAfter(29_000, 'loaded'));
    container.innerHTML = page('/api/slow');
    runtime.mount(container);

    await vi.advanceTimersByTimeAsync(29_000);
    expect(text(container, 'items')).toBe('loaded');
    expect(text(container, 'busy')).toBe('false');

    // Its timer was cleared with the answer: nothing aborts it afterwards.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.init.signal!.aborted).toBe(false);
    expect(text(container, 'failed')).toBe('');
    expect(text(container, 'items')).toBe('loaded');
  });

  it('each request of a polling data-fetch has its own 30 s', async () => {
    vi.stubGlobal('fetch', stalled);
    container.innerHTML = `
      <div data-forma-state='{}'>
        <div data-fetch="GET /api/poll → items |error:failed |poll:20000"></div>
        <p id="failed" data-text="{failed}"></p>
      </div>`;
    runtime.mount(container);

    // Requests at 0 s and 20 s; the first times out at 30 s, the second at 50 s.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(requests.map((r) => r.init.signal!.aborted)).toEqual([true, false]);
    expect(text(container, 'failed')).toBe('data-fetch timed out after 30000 ms');
    await vi.advanceTimersByTimeAsync(19_999);
    expect(requests.map((r) => r.init.signal!.aborted)).toEqual([true, false, false]);
    await vi.advanceTimersByTimeAsync(1);
    expect(requests.map((r) => r.init.signal!.aborted)).toEqual([true, true, false]);
  });
});
