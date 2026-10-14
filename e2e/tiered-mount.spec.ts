import { test, expect, type Page } from '@playwright/test';

/**
 * The tiered mount (FORMA-128) in real browsers, on the production CDN build:
 * what happy-dom cannot show. An event from a light-DOM child slotted into a
 * mount reaches the mount's handler with a target outside the root; a browser
 * matches a selector's combinators against the whole document; and a
 * production build has no grant report. The page is the application's: `#app`
 * carries a secret in an attribute, and the mount root sits inside it.
 */

type Runtime = {
  mountMarkup(root: Element, markup: string, options: unknown): { grantsUsed(): unknown; unmount(): void };
  getDiagnostics(): Array<{ kind: string; code: string; grant?: string }>;
  reconcile(container: Element, html: string): void;
};

async function bare(page: Page): Promise<void> {
  await page.goto('/runtime-bare.html');
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      'afterbegin',
      '<section id="app" data-secret="s3cret"><div id="root"></div><aside id="sib">aside</aside></section>',
    );
  });
}

const denials = (page: Page) => page.evaluate(() =>
  (window as unknown as { FormaRuntime: Runtime }).FormaRuntime.getDiagnostics()
    .filter((d) => d.kind === 'grant-denied').map((d) => d.code));

test("an event's target outside the root is refused: a light-DOM child slotted into the mount", async ({ page }) => {
  await bare(page);
  await page.evaluate(() => {
    const { FormaRuntime } = window as unknown as { FormaRuntime: Runtime };
    document.body.insertAdjacentHTML('beforeend', '<x-host id="host"><button id="light" data-secret="s3cret">light</button></x-host>');
    const shadow = document.getElementById('host')!.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<div id="shadow-root"></div>';
    FormaRuntime.mountMarkup(
      shadow.getElementById('shadow-root')!,
      `<div data-forma-state='{"seen":"none"}'>` +
        `<div data-on:click="{seen = $event.target.getAttribute('data-secret') ?? 'no secret'}"><slot></slot>` +
        `<button id="own">own</button></div><p id="seen" data-text="{seen}">-</p></div>`,
      { tier: 'reviewed', grants: {} },
    );
  });
  const seen = page.locator('#host p#seen');
  await page.locator('#host #own').click();
  await expect(seen).toHaveText('no secret');
  // The light-DOM child's click passes through the slot inside the mount.
  await page.locator('#light').click();
  await expect(seen).toHaveText('no secret');
  expect(await denials(page)).toEqual(['FORMA_E_GRANT_DOM']);
});

test('a selector that reads past the element needs dom: the browser matches it against the page', async ({ page }) => {
  await bare(page);
  const run = (grants: unknown) => page.evaluate((g) => {
    const { FormaRuntime } = window as unknown as { FormaRuntime: Runtime };
    const root = document.getElementById('root')!;
    const handle = FormaRuntime.mountMarkup(
      root,
      `<div data-forma-state='{}'>` +
        `<p id="q" data-text="{$el.closest('div').querySelector('[data-secret^=&quot;s3&quot;] span') ? 'read' : 'none'}">initial</p>` +
        `<p id="local" data-text="{$el.closest('div').querySelectorAll('span').length}">initial</p><p><span></span></p></div>`,
      { tier: 'reviewed', grants: g },
    );
    const out = [document.getElementById('q')!.textContent, document.getElementById('local')!.textContent];
    handle.unmount();
    return out;
  }, grants);

  expect(await run({})).toEqual(['initial', '1']);
  expect(await denials(page)).toEqual(['FORMA_E_GRANT_DOM']);
  // With dom, a browser answers from the page outside the root.
  expect(await run({ dom: true })).toEqual(['read', '1']);
});

test("SR16 and SR31 in a browser: $el.closest('body') reaches nothing, and an ungranted data-fetch sends nothing", async ({ page }) => {
  let requests = 0;
  await page.route('**/api/**', (route) => {
    requests++;
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"missing"}' });
  });
  await bare(page);
  await page.evaluate(() => {
    const { FormaRuntime } = window as unknown as { FormaRuntime: Runtime };
    FormaRuntime.mountMarkup(
      document.getElementById('root')!,
      `<div data-forma-state='{}'><div data-fetch="POST /api/transfer → done |error:failed"></div>` +
        `<p id="reach" data-text="{$el.closest('body') ? 'reached' : 'confined'}">initial</p>` +
        `<p id="failed" data-text="{failed}">-</p></div>`,
      { tier: 'reviewed', grants: {} },
    );
  });
  await expect(page.locator('#failed')).toHaveText('data-fetch denied: the mount grants no fetch');
  await expect(page.locator('#reach')).toHaveText('initial');

  // Granted, the request goes, and its 404 is an error, not data.
  await page.evaluate(() => {
    const { FormaRuntime } = window as unknown as { FormaRuntime: Runtime };
    const second = document.createElement('div');
    document.body.appendChild(second);
    FormaRuntime.mountMarkup(
      second,
      `<div data-forma-state='{}'><div data-fetch="GET /api/items → items |error:failed2"></div>` +
        `<p id="items" data-text="{items?.error}">-</p><p id="failed2" data-text="{failed2}">-</p></div>`,
      { tier: 'reviewed', grants: { fetch: { paths: ['/api/'] } } },
    );
  });
  await expect(page.locator('#failed2')).toHaveText('data-fetch answered HTTP 404');
  await expect(page.locator('#items')).toHaveText('');
  expect(requests).toBe(1);
});

test('the production build has no grant report and reconcile() warns nothing', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (msg) => { if (msg.type() === 'warning') warnings.push(msg.text()); });
  await bare(page);
  const report = await page.evaluate(() => {
    const { FormaRuntime } = window as unknown as { FormaRuntime: Runtime };
    const handle = FormaRuntime.mountMarkup(document.getElementById('root')!,
      `<div data-forma-state='{}'><p data-text="{$el.closest('section').id}">-</p></div>`, { tier: 'reviewed' });
    const other = document.createElement('div');
    document.body.appendChild(other);
    FormaRuntime.reconcile(other, `<div data-forma-state='{"n":1}'><p id="n" data-text="{n}">-</p></div>`);
    return handle.grantsUsed();
  });
  expect(report).toBeNull();
  await expect(page.locator('#n')).toHaveText('1');
  expect(warnings.filter((w) => w.includes('FORMA_W_'))).toEqual([]);
});

test("SR16 in 2.x: with data-forma-mount=\"manual\" on the runtime's script, only mountMarkup binds", async ({ page }) => {
  await page.route('**/manual-mount.html', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html><head><meta charset="utf-8"><title>manual</title></head><body>' +
      `<div data-forma-state='{"n":1}'><p id="served" data-text="{n}">raw</p></div><div id="root"></div>` +
      '<script src="/formajs-runtime.global.js" data-forma-mount="manual"></script></body></html>',
  }));
  await page.goto('/manual-mount.html');
  const result = await page.evaluate(async () => {
    const { FormaRuntime } = window as unknown as { FormaRuntime: Runtime & { mount(el: Element): void } };
    FormaRuntime.mountMarkup(document.getElementById('root')!,
      `<div data-forma-state='{"w":3}'><p id="inside" data-text="{w}">-</p></div>`, { tier: 'reviewed', grants: {} });
    const inject = (id: string) => document.body.insertAdjacentHTML('beforeend',
      `<div data-forma-state='{"n":2}'><p id="${id}" data-text="{n}">raw</p></div>`);
    inject('outside');
    // The switch is read once: removing it later turns nothing back on.
    document.querySelector('script[data-forma-mount]')!.removeAttribute('data-forma-mount');
    inject('later');
    await new Promise((r) => setTimeout(r, 100));
    const refused: string[] = [];
    for (const call of [() => FormaRuntime.mount(document.body), () => FormaRuntime.reconcile(document.createElement('div'), '<p></p>')]) {
      try { call(); } catch (err) { refused.push(String((err as { code?: string }).code)); }
    }
    const text = (id: string) => document.getElementById(id)!.textContent;
    return { inside: text('inside'), served: text('served'), outside: text('outside'), later: text('later'), refused };
  });
  expect(result).toEqual({
    inside: '3',
    served: 'raw',
    outside: 'raw',
    later: 'raw',
    refused: ['FORMA_E_MOUNT_MANUAL', 'FORMA_E_MOUNT_MANUAL'],
  });
});
