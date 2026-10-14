import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/**
 * Core under Trusted Types, in a real browser (FORMA-126, FORMA-127; decision
 * brief DR-19, DR-20).
 *
 * forma-server 0.2.2 sends `require-trusted-types-for 'script'; trusted-types
 * forma forma-runtime` as Content-Security-Policy-Report-Only, and the release
 * after enforces it. Every page here is served with exactly that policy, once
 * Report-Only and once enforced, and every `securitypolicyviolation` the page
 * fires is collected. Core's own test pages, and every raw sink given
 * `trustedHtml()`, must raise none: core writes no string to an HTML sink of
 * its own. The controls prove the policy is live in this engine: a string
 * written to `innerHTML` raises one report and still renders under
 * Report-Only, and is refused when enforced.
 *
 * The header is attached by route-fulfilling each response, as csp.spec.ts
 * does, not by a `<meta>` tag, which cannot carry Report-Only.
 */

const POLICY = "require-trusted-types-for 'script'; trusted-types forma forma-runtime";

const MODES = [
  { mode: 'Report-Only', header: 'content-security-policy-report-only', disposition: 'report' },
  { mode: 'enforced', header: 'content-security-policy', disposition: 'enforce' },
] as const;

/** Core's browser ESM bundle (self-contained), served to the sink page as a module. */
const CORE_BUNDLE = fileURLToPath(new URL('../dist/forma.esm.js', import.meta.url));

/**
 * A page holding core's ESM bundle (imported by the test) and the runtime's
 * IIFE, two copies of core on one page, as a page with an island and a
 * runtime widget has. Nothing in it writes HTML until the test does.
 */
const SINK_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>raw sinks</title></head>
<body><main id="app"><p>server content</p></main><div id="live"></div>
<script src="/formajs-runtime.global.js"></script></body></html>`;

interface Violation { directive: string; disposition: string; sample: string }

/** Serve every response with the Trusted Types policy in `header`, and record its violations. */
async function underTrustedTypes(page: Page, header: string): Promise<{ errors: string[] }> {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.addInitScript(() => {
    const seen: Violation[] = [];
    (window as unknown as { __tt: Violation[] }).__tt = seen;
    document.addEventListener('securitypolicyviolation', (e) => {
      seen.push({ directive: e.effectiveDirective, disposition: e.disposition, sample: e.sample });
    });
  });
  await page.route('**/*', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/tt-sinks.html') {
      await route.fulfill({ contentType: 'text/html', body: SINK_PAGE, headers: { [header]: POLICY } });
      return;
    }
    if (path === '/tt-core.mjs') {
      await route.fulfill({ path: CORE_BUNDLE, contentType: 'text/javascript' });
      return;
    }
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), [header]: POLICY } });
  });
  return { errors };
}

/**
 * The violations the page has fired, read after a task has passed, since the
 * browser queues the event rather than firing it during the write.
 */
const violations = (page: Page) => page.evaluate(
  () => new Promise<Violation[]>((resolve) => {
    setTimeout(() => resolve((window as unknown as { __tt: Violation[] }).__tt), 100);
  }),
);

for (const { mode, header, disposition } of MODES) {
  test.describe(`core under Trusted Types, ${mode}`, () => {
    test(`flagship.html renders, filters and reacts with no Trusted Types violation (${mode})`, async ({ page }) => {
      const { errors } = await underTrustedTypes(page, header);
      await page.goto('/flagship.html');
      await expect(page.locator('#count')).toHaveText('Found 5 results');
      await page.fill('#query', 'apple');
      await expect(page.locator('#list li')).toHaveCount(1);
      await page.fill('#query', 'zzz');
      await expect(page.locator('#empty')).toBeVisible();
      await page.fill('#query', '');
      await expect(page.locator('#list li')).toHaveCount(5);
      await page.click('#toggle');
      await expect(page.locator('#themed')).toHaveAttribute('data-theme', 'dark');

      expect(await violations(page)).toEqual([]);
      expect(errors).toEqual([]);
    });

    test(`runtime.html's every directive runs with no Trusted Types violation (${mode})`, async ({ page }) => {
      const { errors } = await underTrustedTypes(page, header);
      await page.goto('/runtime.html');
      await expect(page.locator('#text-name')).toHaveText('Alice');
      await page.click('#text-btn');
      await expect(page.locator('#text-name')).toHaveText('Bob');
      for (let i = 0; i < 3; i++) await page.click('#show-toggle');
      await expect(page.locator('#show-target')).toBeHidden();
      for (let i = 0; i < 3; i++) await page.click('#if-toggle');
      await expect(page.locator('#if-target')).toHaveCount(1);
      await page.fill('#model-input', 'a@b.c');
      await expect(page.locator('#model-output')).toHaveText('a@b.c');
      await page.click('#class-toggle');
      await expect(page.locator('#class-target')).toHaveClass(/active/);
      await page.click('#bind-toggle');
      await expect(page.locator('#bind-disabled')).toBeEnabled();
      await page.click('#computed-inc');
      await expect(page.locator('#computed-total')).toHaveText('40');
      await page.click('#list-add');
      await page.click('#list-add');
      await expect(page.locator('#list-container li')).toHaveCount(5);
      await page.fill('#persist-input', 'kept');
      await expect(page.locator('#persist-output')).toHaveText('kept');
      await page.click('#scope-a-btn');
      await expect(page.locator('#scope-a')).toHaveText('2');
      await expect(page.locator('#scope-b')).toHaveText('100');

      expect(await violations(page)).toEqual([]);
      expect(errors).toEqual([]);
    });

    test(`runtime-bare.html mounts and unmounts a widget with no Trusted Types violation (${mode})`, async ({ page }) => {
      const { errors } = await underTrustedTypes(page, header);
      await page.goto('/runtime-bare.html');
      const texts = await page.evaluate(async () => {
        const w = window as unknown as { FormaRuntime: { mount(el: Element): void; unmount(el: Element): void } };
        // Built with DOM calls: a string written to innerHTML here would be the
        // test's own violation, not core's.
        const root = document.createElement('div');
        root.setAttribute('data-forma-state', '{"items":["a","b"],"open":true}');
        const list = document.createElement('ul');
        list.setAttribute('data-list', '{items}');
        const row = document.createElement('li');
        row.setAttribute('data-text', '{item}');
        list.append(row);
        const shown = document.createElement('p');
        shown.setAttribute('data-if', '{open}');
        shown.textContent = 'open';
        const toggle = document.createElement('button');
        toggle.setAttribute('data-on:click', "{open = !open; items = items.concat('c')}");
        root.append(list, shown, toggle);
        document.body.append(root);
        w.FormaRuntime.mount(root);
        toggle.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        const after = [...root.querySelectorAll('li')].map((li) => li.textContent).join(',');
        const open = root.querySelectorAll('p').length;
        w.FormaRuntime.unmount(root);
        root.remove();
        return { after, open };
      });
      expect(texts).toEqual({ after: 'a,b,c', open: 0 });

      expect(await violations(page)).toEqual([]);
      expect(errors).toEqual([]);
    });

    test(`expr-cost.html refuses its hostile binding with no Trusted Types violation (${mode})`, async ({ page }) => {
      const { errors } = await underTrustedTypes(page, header);
      await page.goto('/expr-cost.html');
      await expect(page.locator('#control')).toHaveText('1000');
      await expect(page.locator('#hostile')).not.toHaveText('12000000');

      expect(await violations(page)).toEqual([]);
      expect(errors).toEqual([]);
    });

    test(`every raw sink given trustedHtml(), and core's own clears, raise no violation (${mode})`, async ({ page }) => {
      const { errors } = await underTrustedTypes(page, header);
      await page.goto('/tt-sinks.html');
      const result = await page.evaluate(async () => {
        const core = await import('/tt-core.mjs' as string);
        const runtime = (window as unknown as {
          FormaRuntime: { reconcile(el: Element, html: unknown): void; trustedHtml(markup: string): unknown };
        }).FormaRuntime;
        const { h, mount, createSignal, setHTMLUnsafe, template, templateMany, trustedHtml } = core;
        const out: Record<string, unknown> = {};

        // mount() replaces the server content; the reactive raw bindings go
        // through three transitions each, the null clear among them.
        const [html, setHtml] = createSignal({ __html: trustedHtml('<b>one</b>') });
        const [doc, setDoc] = createSignal(trustedHtml('<p>a</p>'));
        const app = document.getElementById('app')!;
        const unmount = mount(() => h('section', null,
          h('div', { id: 'box', dangerouslySetInnerHTML: () => html() }),
          h('div', { id: 'static', dangerouslySetInnerHTML: { __html: trustedHtml('<em>static</em>') } }),
          h('iframe', { id: 'frame', sandbox: '', srcdoc: () => doc() }),
          h('iframe', { id: 'frame2', sandbox: '', srcdoc: trustedHtml('<p>static doc</p>') }),
        ), app);
        const box = document.getElementById('box')!;
        out.mounted = [app.textContent?.includes('server content'), box.innerHTML, document.getElementById('static')!.innerHTML,
          document.getElementById('frame2')!.getAttribute('srcdoc')];
        setHtml(null);
        setDoc(trustedHtml('<p>b</p>'));
        out.cleared = [box.childNodes.length, document.getElementById('frame')!.getAttribute('srcdoc')];
        setHtml({ __html: trustedHtml('<i>two</i>') });
        setDoc(trustedHtml('<p>c</p>'));
        out.again = [box.innerHTML, document.getElementById('frame')!.getAttribute('srcdoc')];

        const target = document.createElement('div');
        setHTMLUnsafe(target, trustedHtml('<u>u</u>'));
        out.others = [
          target.innerHTML,
          (template(trustedHtml('<p class="t">t</p>')).cloneNode(true) as Element).className,
          templateMany(trustedHtml('<a></a><b></b>')).childNodes.length,
        ];
        unmount();
        out.unmounted = app.childNodes.length;

        // The runtime's parser, on its three paths: an empty container, a diff
        // of keyed children, a full replacement. The runtime's own copy of
        // trustedHtml() shares the page's `forma` policy with core's.
        const live = document.getElementById('live')!;
        const state = (n: number) => `data-forma-state='{"n":${n}}'`;
        runtime.reconcile(live, runtime.trustedHtml(`<div data-forma-id="a" ${state(1)}><span data-text="{n}"></span></div>`));
        out.empty = live.textContent;
        runtime.reconcile(live, runtime.trustedHtml(`<div data-forma-id="a" ${state(1)}><span data-text="{n}"></span></div><p data-forma-id="b">b</p>`));
        out.diff = live.textContent;
        runtime.reconcile(live, runtime.trustedHtml('<p data-forma-id="c">c</p>'));
        out.replaced = live.innerHTML;
        return out;
      });

      expect(result).toEqual({
        mounted: [false, '<b>one</b>', '<em>static</em>', '<p>static doc</p>'],
        cleared: [0, '<p>b</p>'],
        again: ['<i>two</i>', '<p>c</p>'],
        others: ['<u>u</u>', 't', 2],
        unmounted: 0,
        empty: '1',
        diff: '1b',
        replaced: '<p data-forma-id="c">c</p>',
      });
      expect(await violations(page)).toEqual([]);
      expect(errors).toEqual([]);
    });
  });
}

test.describe('the controls: the policy is live in this engine', () => {
  test('under Report-Only a string written to innerHTML raises one report and still renders', async ({ page }) => {
    const { errors } = await underTrustedTypes(page, MODES[0].header);
    await page.goto('/tt-sinks.html');
    await page.evaluate(() => {
      const el = document.createElement('div');
      document.body.append(el);
      el.innerHTML = '<b id="plain">a string</b>';
    });
    await expect(page.locator('#plain')).toHaveText('a string');
    await expect.poll(() => violations(page)).toEqual([
      { directive: 'require-trusted-types-for', disposition: 'report', sample: expect.stringContaining('<b id="plain">') },
    ]);
    expect(errors).toEqual([]);
  });

  test("under Report-Only a string given to core's raw sink is reported and still renders, as 2.x promises", async ({ page }) => {
    await underTrustedTypes(page, MODES[0].header);
    await page.goto('/tt-sinks.html');
    await page.evaluate(async () => {
      const core = await import('/tt-core.mjs' as string);
      const el = document.createElement('div');
      document.body.append(el);
      core.setHTMLUnsafe(el, '<i id="legacy">legacy</i>');
    });
    await expect(page.locator('#legacy')).toHaveText('legacy');
    await expect.poll(() => violations(page)).toEqual([
      { directive: 'require-trusted-types-for', disposition: 'report', sample: expect.stringContaining('<i id="legacy">') },
    ]);
  });

  test('enforced, a string written to innerHTML is refused and raises one violation', async ({ page }) => {
    await underTrustedTypes(page, MODES[1].header);
    await page.goto('/tt-sinks.html');
    const threw = await page.evaluate(() => {
      const el = document.createElement('div');
      document.body.append(el);
      try {
        el.innerHTML = '<b id="plain">a string</b>';
        return null;
      } catch (err) {
        return (err as Error).name;
      }
    });
    expect(threw).toBe('TypeError');
    await expect(page.locator('#plain')).toHaveCount(0);
    await expect.poll(() => violations(page)).toEqual([
      { directive: 'require-trusted-types-for', disposition: 'enforce', sample: expect.stringContaining('<b id="plain">') },
    ]);
  });
});
