/**
 * The preview frame's runtime (FORMA-128, tier (c); the frame document is
 * forma-server's `PageResponse::frame`, FORMA-125).
 *
 * The protocol half runs `connectFrame` on a stand-in for the frame's window:
 * an EventTarget with the frame document and a `parent`, because happy-dom's
 * own window is its own parent. Real `MessageChannel` ports carry the
 * messages, and the frame's origin is set to the opaque "null" a sandboxed
 * frame has. `e2e/frame.spec.ts` runs the same protocol in a real sandboxed
 * iframe, in three engines, where markup injected outside the root is shown
 * unbound (this suite's source runtime auto-mounts, as the frame build does
 * not). The build half runs the real tsup config.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { build, type Options } from 'tsup';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import rawConfig from '../../tsup.config';
import { FRAME_BUILD_FLAG, FRAME_DEFINE } from '../../scripts/build-defines.mjs';
import { parseImportSpecifiers } from '../../scripts/check-size.mjs';
import { connectFrame, FRAME_ROOT_ID, type FrameMessage } from '../runtime-frame';
import { clearDiagnostics } from '../runtime';

/** Time for a message that should NOT arrive to have arrived. */
const quiet = (): Promise<void> => new Promise((r) => setTimeout(r, 50));
/** Wait for an assertion about messages that should arrive. */
const until = (check: () => void): Promise<void> => vi.waitFor(check, { timeout: 2_000, interval: 5 });

/** The frame's window, as the frame sees it: the document, its parent, its events. */
function frameWindow(): { win: EventTarget & { document: Document; parent: object }; parent: object; other: object } {
  const parent = {};
  const target = new EventTarget();
  const add = target.addEventListener.bind(target);
  const remove = target.removeEventListener.bind(target);
  // The runtime dispatches its diagnostics on the global window, which in the
  // frame is this window: their listener goes there, the rest on the stand-in.
  const on = (type: string, fn: EventListener): void => {
    if (type === 'formajs:diagnostic') window.addEventListener(type, fn);
    else add(type, fn);
    if (type === 'formajs:diagnostic') cleanups.push(() => window.removeEventListener(type, fn));
  };
  const win = Object.assign(target, {
    document,
    parent,
    addEventListener: on,
    removeEventListener: (type: string, fn: EventListener) => remove(type, fn),
  });
  return { win, parent, other: {} };
}

/** A port the host keeps, recording what the frame sends on it. */
function hostPort(): { channel: MessageChannel; received: FrameMessage[] } {
  const channel = new MessageChannel();
  const received: FrameMessage[] = [];
  channel.port1.onmessage = (e) => received.push(e.data as FrameMessage);
  cleanups.push(() => { channel.port1.close(); });
  return { channel, received };
}

function handOver(win: EventTarget, source: object, ports: MessagePort[]): void {
  win.dispatchEvent(new MessageEvent('message', { source: source as never, ports, data: 'forma-frame' }));
}

let cleanups: Array<() => void> = [];
let requests = 0;

beforeEach(() => {
  document.body.innerHTML = `<div id="${FRAME_ROOT_ID}"></div>`;
  vi.stubGlobal('origin', 'null');
  vi.stubGlobal('fetch', async () => {
    requests++;
    return new Response('"secret"');
  });
  requests = 0;
  clearDiagnostics();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  for (const c of cleanups) c();
  cleanups = [];
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const frameRoot = (): HTMLElement => document.getElementById(FRAME_ROOT_ID)!;

describe('the frame protocol', () => {
  it('takes one port from its parent, renders each module in tier (c) and answers only ready, resize and error', async () => {
    const { win, parent } = frameWindow();
    connectFrame(win as never);
    const { channel, received } = hostPort();
    handOver(win, parent, [channel.port2]);
    await until(() => expect(received).toEqual([{ type: 'ready' }, { type: 'resize', height: expect.any(Number) }]));

    channel.port1.postMessage({
      type: 'module',
      html:
        `<div data-forma-state='{"n":1}'><p id="v" data-text="{n}">-</p>` +
        `<div data-fetch="GET /api/me → me |error:failed"></div><p id="failed" data-text="{failed}">-</p>` +
        `<p id="reach" data-text="{$el.closest('body') ? 'reached' : 'confined'}">initial</p>` +
        `<p id="asks" data-text="{$el.matches('body *') ? 'read' : 'not read'}">initial</p></div>`,
    });
    const errors = (): Array<{ code: string }> => received.filter((m) => m.type === 'error') as Array<{ code: string }>;
    await until(() => expect(errors().map((e) => e.code).sort()).toEqual(['FORMA_E_GRANT_DOM', 'FORMA_E_GRANT_FETCH']));
    expect(document.getElementById('v')!.textContent).toBe('1');
    // Tier (c), no grants: nothing sent, nothing outside the root reached.
    expect(requests).toBe(0);
    expect(document.getElementById('failed')!.textContent).toBe('data-fetch denied: the mount grants no fetch');
    expect(document.getElementById('reach')!.textContent).toBe('confined');
    expect(document.getElementById('asks')!.textContent).toBe('initial');

    // A later module updates the same mount.
    channel.port1.postMessage({ type: 'module', html: `<div data-forma-state='{"m":2}'><p id="v" data-text="{m}">-</p></div>` });
    await until(() => expect(document.getElementById('v')!.textContent).toBe('2'));
    expect(new Set(received.map((m) => m.type))).toEqual(new Set(['ready', 'resize', 'error']));
    expect(received.filter((m) => m.type === 'ready')).toHaveLength(1);
  });

  it("forwards the runtime's diagnostics, never a module's own formajs:diagnostic", async () => {
    const { win, parent } = frameWindow();
    connectFrame(win as never);
    const { channel, received } = hostPort();
    handOver(win, parent, [channel.port2]);
    await until(() => expect(received[0]).toEqual({ type: 'ready' }));
    channel.port1.postMessage({
      type: 'module',
      html:
        `<div data-forma-state='{}'><button id="spoof" data-on:mouseover="{$dispatch('formajs:diagnostic', ` +
        `{code: 'HOST_PLEASE_RELOAD', reason: 'spoofed', expr: 'x'})}">s</button>` +
        `<p data-text="{nope.x}">-</p></div>`,
    });
    const errors = (): Array<{ code: string }> => received.filter((m) => m.type === 'error') as Array<{ code: string }>;
    await until(() => expect(errors().map((e) => e.code)).toEqual(['FORMA_E_UNRESOLVED']));
    document.getElementById('spoof')!.dispatchEvent(new Event('mouseover'));
    await quiet();
    expect(errors().map((e) => e.code)).toEqual(['FORMA_E_UNRESOLVED']);
  });

  it('ignores a port from any window but its parent, and every port after the first', async () => {
    const { win, parent, other } = frameWindow();
    connectFrame(win as never);

    const stranger = hostPort();
    handOver(win, other, [stranger.channel.port2]);
    const twoPorts = hostPort();
    handOver(win, parent, [twoPorts.channel.port2, new MessageChannel().port2]);
    handOver(win, parent, []);
    await quiet();
    expect(stranger.received).toEqual([]);
    expect(twoPorts.received).toEqual([]);

    const host = hostPort();
    handOver(win, parent, [host.channel.port2]);
    const late = hostPort();
    handOver(win, parent, [late.channel.port2]);
    await until(() => expect(host.received[0]).toEqual({ type: 'ready' }));
    await quiet();
    expect(late.received).toEqual([]);

    // A module on a port the frame never took renders nothing.
    stranger.channel.port1.postMessage({ type: 'module', html: '<p id="x">stranger</p>' });
    late.channel.port1.postMessage({ type: 'module', html: '<p id="x">late</p>' });
    await quiet();
    expect(frameRoot().innerHTML).toBe('');
    host.channel.port1.postMessage({ type: 'module', html: '<p id="x">host</p>' });
    await until(() => expect(frameRoot().textContent).toBe('host'));
  });

  it('refuses every message but the module, and changes nothing', async () => {
    const { win, parent } = frameWindow();
    connectFrame(win as never);
    const { channel, received } = hostPort();
    handOver(win, parent, [channel.port2]);
    await until(() => expect(received[0]).toEqual({ type: 'ready' }));
    const refused: unknown[] = [
      '<p>a string</p>',
      null,
      { type: 'module' },
      { type: 'module', html: 7 },
      { type: 'module', html: '<p>x</p>', script: 'alert(1)' },
      { type: 'render', html: '<p>x</p>' },
      { type: 'ready' },
    ];
    for (const message of refused) channel.port1.postMessage(message);
    const errors = (): Array<{ code: string }> => received.filter((m) => m.type === 'error') as Array<{ code: string }>;
    await until(() => expect(errors().map((e) => e.code)).toEqual(refused.map(() => 'FRAME_E_MESSAGE')));
    expect(frameRoot().innerHTML).toBe('');

    channel.port1.postMessage({ type: 'module', html: '<p>rendered</p>' });
    await until(() => expect(frameRoot().textContent).toBe('rendered'));
  });

  it('on an origin that is not opaque it renders nothing and says so', async () => {
    vi.stubGlobal('origin', 'https://studio.example');
    const { win, parent } = frameWindow();
    connectFrame(win as never);
    const { channel, received } = hostPort();
    handOver(win, parent, [channel.port2]);
    channel.port1.postMessage({ type: 'module', html: `<div data-forma-state='{}'><p data-text="{1}">-</p></div>` });
    await until(() => expect(received.filter((m) => m.type === 'error')).toEqual([
      { type: 'error', code: 'FRAME_E_RENDER', message: expect.stringContaining('FORMA_E_MOUNT_ORIGIN') },
    ]));
    expect(frameRoot().innerHTML).toBe('');
  });
});

// ---------------------------------------------------------------------------

const configs = rawConfig as Options[];

/** Build the real frame runtime config, with `overrides`, and return its bytes. */
async function buildFrame(overrides: Options = {}): Promise<string> {
  const base = configs.find((c) => Object.keys(c.entry as Record<string, string>).includes('formajs-frame'));
  if (!base) throw new Error('no tsup config emits formajs-frame');
  const outDir = mkdtempSync(join(tmpdir(), 'forma-frame-'));
  try {
    await build({ ...base, config: false, silent: true, outDir, ...overrides });
    return readFileSync(join(outDir, 'formajs-frame.global.js'), 'utf8');
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

describe('the frame runtime build (the real tsup config)', () => {
  // One production build serves the first and the last test; the last builds
  // once more to compare.
  let first: Promise<string> | null = null;
  const production = (): Promise<string> => (first ??= buildFrame());

  it('the frame runtime is one classic script a server can inline as it is', { timeout: 120_000 }, async () => {
    const code = await production();
    const lower = code.toLowerCase();
    // forma-server refuses to inline either (FRAME-103), and rewrites nothing.
    expect(lower).not.toContain('</script');
    expect(lower).not.toContain('<!--');
    // Nothing to fetch, nothing to resolve.
    expect(code).not.toMatch(/sourceMappingURL/);
    expect(parseImportSpecifiers(code)).toEqual([]);
    expect(code).not.toMatch(/^\s*(?:import|export)\b/m);
    // It makes no script of its own, and no code from text.
    expect(code).not.toMatch(/createElement\(\s*["']script["']\s*\)/);
    expect(code).not.toMatch(/\bnew Function\b|\beval\(/);
    // It never mounts the page on load or watches body: no tierless path.
    expect(code).not.toContain('DOMContentLoaded');
    expect(code).not.toContain('MutationObserver');
    // What it is: the frame's connection, mounting in tier (c).
    expect(code).toContain('connectFrame(window)');
    expect(code).toContain('"unreviewed"');
  });

  it('without the frame flag the same entry would auto-mount the page', { timeout: 120_000 }, async () => {
    // The control for the test above: the flag, not the entry, keeps the
    // tierless path out.
    const code = await buildFrame({ define: { ...FRAME_DEFINE, [FRAME_BUILD_FLAG]: 'false' } });
    expect(code).toContain('DOMContentLoaded');
    expect(code).not.toContain('connectFrame(window)');
  });

  it('two builds of the frame runtime are byte-identical', { timeout: 120_000 }, async () => {
    // A policy allows the inline runtime by its SHA-256 hash.
    const digest = (s: string): string => createHash('sha256').update(s).digest('base64');
    expect(digest(await production())).toBe(digest(await buildFrame()));
  });
});
