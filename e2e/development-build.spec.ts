import { test, expect } from '@playwright/test';
import { build, type Metafile } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// FORMA-169's acceptance test: an application bundled for development from
// the PACKED package logs a known development warning once in a real browser,
// and the same application bundled for production logs nothing. The
// development bundle is what a bundler in development mode makes: esbuild with
// the `development` condition (plus `module`, which listing any condition
// drops), as `@getforma/build` does in watch mode. The production bundle is
// what `@getforma/build` makes for production: no conditions, minified.
//
// `npm run test:e2e` builds dist/ first; this packs it as `npm publish` would,
// so a file the tarball leaves out fails here too.

test.use({ channel: process.env.FORMA_TEST_BROWSER_CHANNEL || undefined });

const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** The warning `h()` logs, in a development build only, when it drops a `javascript:` URL. */
const KNOWN_WARNING = '[forma] Dropped unsafe-URL prop "href" on <a>';

const APP = `
import { h, mount, setHTMLUnsafe, trustedHtml } from '@getforma/core';
mount(() => h('section', null,
  h('a', { id: 'link', href: 'javascript:alert(1)' }, 'unsafe link'),
  h('div', { id: 'typed', dangerouslySetInnerHTML: { __html: trustedHtml('<i>typed</i>') } }),
  h('div', { id: 'raw' }),
), '#app');
// FORMA-126: a plain string at a raw sink, twice; trustedHtml() above, never.
setHTMLUnsafe(document.getElementById('raw'), '<b>first</b>');
setHTMLUnsafe(document.getElementById('raw'), '<b>second</b>');
`;

let scratch: string;
const bundles: Record<'development' | 'production', { code: string; inputs: string[] }> = {} as never;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'forma-e2e-development-')));
  const packed = spawnSync('npm', ['pack', '--pack-destination', scratch, '--silent'], {
    cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32',
  });
  expect(packed.status, packed.stderr).toBe(0);
  const tarball = readdirSync(scratch).find((name) => name.endsWith('.tgz'));
  expect(tarball, 'npm pack wrote a tarball').toMatch(/^getforma-core-.+\.tgz$/);
  const extracted = spawnSync('tar', ['-xzf', join(scratch, tarball!), '-C', scratch]);
  expect(extracted.status).toBe(0);
  mkdirSync(join(scratch, 'node_modules', '@getforma'), { recursive: true });
  renameSync(join(scratch, 'package'), join(scratch, 'node_modules', '@getforma', 'core'));
  // core's one dependency, as `npm install` would have placed it.
  symlinkSync(join(ROOT, 'node_modules', 'alien-signals'), join(scratch, 'node_modules', 'alien-signals'), 'junction');
  writeFileSync(join(scratch, 'app.js'), APP);

  for (const [mode, options] of [
    ['development', { conditions: ['development', 'module'], minify: false }],
    ['production', { minify: true }],
  ] as const) {
    const result = await build({
      entryPoints: [join(scratch, 'app.js')],
      absWorkingDir: scratch,
      bundle: true,
      format: 'esm',
      target: 'es2022',
      write: false,
      metafile: true,
      logLevel: 'silent',
      ...options,
    });
    bundles[mode] = {
      code: result.outputFiles[0]!.text,
      inputs: Object.keys((result.metafile as Metafile).inputs),
    };
  }
});

test.afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

/** Load one bundle into a page and return what it logged. */
async function run(page: import('@playwright/test').Page, mode: 'development' | 'production') {
  const logged: Array<{ type: string; text: string }> = [];
  page.on('console', (message) => logged.push({ type: message.type(), text: message.text() }));
  await page.route('**/development-build.html', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html><body><main id="app"></main><script type="module" src="/development-build-app.js"></script></body></html>',
  }));
  await page.route('**/development-build-app.js', (route) => route.fulfill({
    contentType: 'text/javascript', body: bundles[mode].code,
  }));
  await page.goto('/development-build.html');
  await expect(page.locator('#link')).toHaveText('unsafe link');
  return logged;
}

test('a development bundle of the packed package resolves the development build and logs a known warning once', async ({ page }) => {
  // Every file of core it bundled is a development twin.
  const core = bundles.development.inputs.filter((file) => file.includes('@getforma/core/'));
  expect(core.length).toBeGreaterThan(0);
  expect(core.filter((file) => !file.includes('@getforma/core/dist/dev/'))).toEqual([]);

  const logged = await run(page, 'development');

  expect(logged.filter((m) => m.text.includes(KNOWN_WARNING)).map((m) => m.type)).toEqual(['warning']);
  // The guard behaves as in production: the URL is dropped either way.
  await expect(page.locator('#link')).not.toHaveAttribute('href');
});

test('a development bundle of the packed package logs a string at a raw sink once, with its code, and trustedHtml() never', async ({ page }) => {
  const logged = await run(page, 'development');

  // FORMA-126's bridge (L-18): the string still renders, and says so once.
  await expect(page.locator('#raw')).toHaveText('second');
  await expect(page.locator('#typed')).toHaveText('typed');
  const raw = logged.filter((m) => m.text.includes('FORMA_W_RAW_'));
  expect(raw.map((m) => [m.type, m.text.slice(0, m.text.indexOf(':'))])).toEqual([
    ['warning', '[forma] FORMA_W_RAW_SET_HTML'],
  ]);
  expect(raw[0]!.text).toContain('trustedHtml()');
});

test('a production bundle of the same application resolves the production files and logs nothing', async ({ page }) => {
  const core = bundles.production.inputs.filter((file) => file.includes('@getforma/core/'));
  expect(core.length).toBeGreaterThan(0);
  expect(core.filter((file) => file.includes('@getforma/core/dist/dev/'))).toEqual([]);
  // (The production bundle may still contain the warning's text: where
  // `__DEV__` crosses a chunk boundary of core's code-split build it is a
  // `false` variable the minifier does not propagate, so the call stays,
  // unreachable. See src/reactive/dev.ts. What it logs is the proof.)

  const logged = await run(page, 'production');

  expect(logged).toEqual([]);
  await expect(page.locator('#link')).not.toHaveAttribute('href');
  await expect(page.locator('#raw')).toHaveText('second');
  await expect(page.locator('#typed')).toHaveText('typed');
});
