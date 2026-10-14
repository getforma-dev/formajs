import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The preview frame's runtime (FORMA-128, tier (c)) in a real sandboxed
 * iframe, in three engines.
 *
 * The frame document is what forma-server's `PageResponse::frame` (FORMA-125)
 * writes: `<div id="forma-frame">` and the runtime inline, under an enforced
 * policy with `sandbox allow-scripts` (no `allow-same-origin`),
 * `connect-src 'none'`, `frame-ancestors` the host's origin, and scripts
 * allowed by the runtime's SHA-256 hash, so the runtime runs only if its
 * bytes are the ones hashed. The host page is the application's half (L-12,
 * L-33): an `iframe sandbox="allow-scripts"`, one `MessageChannel` port
 * handed over at the first load, the module sent on it, the frame torn down on
 * any later load.
 */

const RUNTIME = readFileSync(resolve(process.cwd(), 'dist/formajs-frame.global.js'), 'utf8');
const HASH = createHash('sha256').update(RUNTIME).digest('base64');
const ORIGIN = 'http://localhost:3456';

type Received = { type: string; code?: string; message?: string; height?: number };

async function host(page: Page): Promise<void> {
  await page.route('**/preview-frame.html', (route) => route.fulfill({
    contentType: 'text/html',
    headers: {
      'content-security-policy':
        `default-src 'none'; script-src 'sha256-${HASH}'; connect-src 'none'; ` +
        `frame-ancestors ${ORIGIN}; sandbox allow-scripts`,
    },
    body: '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Preview</title>\n</head>\n' +
      `<body>\n<div id="forma-frame"></div>\n<script>${RUNTIME}</script>\n</body>\n</html>`,
  }));
  await page.route('**/frame-host.html', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Host</title></head><body>
      <iframe id="preview" sandbox="allow-scripts" src="/preview-frame.html" title="Preview"></iframe>
      <script>
        window.received = [];
        const frame = document.getElementById('preview');
        let channel = null;
        let loads = 0;
        frame.addEventListener('load', () => {
          loads++;
          if (loads > 1) { channel && channel.port1.close(); frame.remove(); window.tornDown = true; return; }
          channel = new MessageChannel();
          channel.port1.onmessage = (e) => window.received.push(e.data);
          frame.contentWindow.postMessage('forma-frame', '*', [channel.port2]);
        });
        window.send = (message) => channel.port1.postMessage(message);
      </script></body></html>`,
  }));
  await page.goto('/frame-host.html');
  await expect.poll(() => received(page)).toContainEqual({ type: 'ready' });
}

const received = (page: Page): Promise<Received[]> =>
  page.evaluate(() => (window as unknown as { received: Received[] }).received);

const send = (page: Page, message: unknown): Promise<void> =>
  page.evaluate((m) => (window as unknown as { send(m: unknown): void }).send(m), message);

const frameOf = (page: Page) => page.frames().find((f) => f.url().endsWith('/preview-frame.html'))!;

test('the frame renders a module in tier (c), with an opaque origin, and answers only ready, resize and error', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (msg) => { if (/Content.Security.Policy|CSP/i.test(msg.text())) violations.push(msg.text()); });
  await host(page);
  await send(page, {
    type: 'module',
    html: `<div data-forma-state='{"n":0}'><button id="inc" data-on:click="{n++}">+</button><p id="n" data-text="{n}">-</p></div>`,
  });
  const preview = page.frameLocator('#preview');
  await expect(preview.locator('#n')).toHaveText('0');
  await preview.locator('#inc').click();
  await expect(preview.locator('#n')).toHaveText('1');

  // A later module updates it, reconciled.
  await send(page, { type: 'module', html: `<div data-forma-state='{"m":7}'><p id="n" data-text="{m}">-</p></div>` });
  await expect(preview.locator('#n')).toHaveText('7');

  expect(await frameOf(page).evaluate(() => self.origin)).toBe('null');
  const messages = await received(page);
  expect(messages.filter((m) => m.type === 'ready')).toHaveLength(1);
  expect(messages.some((m) => m.type === 'resize' && typeof m.height === 'number' && m.height > 0)).toBe(true);
  expect(new Set(messages.map((m) => m.type))).toEqual(new Set(['ready', 'resize']));
  expect(violations).toEqual([]);
});

test("a module's data-fetch to the application's API sends no request, and $el stops at the root", async ({ page }) => {
  let requests = 0;
  await page.route('**/api/**', (route) => { requests++; return route.fulfill({ body: '"secret"' }); });
  await host(page);
  await send(page, {
    type: 'module',
    html: `<div data-forma-state='{}'><div data-fetch="GET /api/me → me |error:failed"></div>` +
      `<p id="failed" data-text="{failed}">-</p>` +
      `<p id="reach" data-text="{$el.closest('body') ? 'reached' : 'confined'}">initial</p></div>`,
  });
  const preview = page.frameLocator('#preview');
  await expect(preview.locator('#failed')).toHaveText('data-fetch denied: the mount grants no fetch');
  await expect(preview.locator('#reach')).toHaveText('initial');
  await expect.poll(async () => (await received(page)).filter((m) => m.type === 'error').map((m) => m.code).sort())
    .toEqual(['FORMA_E_GRANT_DOM', 'FORMA_E_GRANT_FETCH']);
  expect(requests).toBe(0);
});

test('markup injected outside the root stays unbound: the frame never watches body', async ({ page }) => {
  await host(page);
  await send(page, { type: 'module', html: `<div data-forma-state='{"n":1}'><p id="in" data-text="{n}">-</p></div>` });
  const preview = page.frameLocator('#preview');
  await expect(preview.locator('#in')).toHaveText('1');
  await frameOf(page).evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', `<div data-forma-state='{"n":2}'><p id="out" data-text="{n}">raw</p></div>`);
  });
  await page.waitForTimeout(100);
  await expect(preview.locator('#out')).toHaveText('raw');
});

test('a message of any other type changes nothing, and a port posted later is ignored', async ({ page }) => {
  await host(page);
  await send(page, { type: 'module', html: '<p id="p">first</p>' });
  const preview = page.frameLocator('#preview');
  await expect(preview.locator('#p')).toHaveText('first');
  await send(page, { type: 'eval', html: '<p id="p">second</p>' });
  await send(page, { type: 'module', html: '<p id="p">third</p>', extra: true });
  await expect.poll(async () => (await received(page)).filter((m) => m.code === 'FRAME_E_MESSAGE').length).toBe(2);
  await expect(preview.locator('#p')).toHaveText('first');

  // A second port, even from the parent, is not taken: nothing answers on it.
  const answered = await page.evaluate(async () => {
    const extra = new MessageChannel();
    const got: unknown[] = [];
    extra.port1.onmessage = (e) => got.push(e.data);
    (document.getElementById('preview') as HTMLIFrameElement).contentWindow!.postMessage('forma-frame', '*', [extra.port2]);
    extra.port1.postMessage({ type: 'module', html: '<p id="p">stolen</p>' });
    await new Promise((r) => setTimeout(r, 200));
    return got;
  });
  expect(answered).toEqual([]);
  await expect(preview.locator('#p')).toHaveText('first');
});
