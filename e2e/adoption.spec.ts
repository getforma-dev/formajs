import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Adoption in a real browser (FORMA-003; decision brief DR-5 and DR-7). The
// server HTML is served as the page, so Chromium's parser handles it (markers
// inside a textarea or title are text there, as they are for users), and the
// user's typing happens before the core module is even requested.

// Optional installed Chrome is useful on machines without Playwright's bundle.
test.use({ channel: process.env.FORMA_TEST_BROWSER_CHANNEL || undefined });

async function serve(page: Page, body: string): Promise<void> {
  await page.route('**/adoption-core.mjs', (route) => route.fulfill({
    path: fileURLToPath(new URL('../dist/forma.esm.js', import.meta.url)),
    contentType: 'text/javascript',
  }));
  await page.route('**/adoption.html', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><head><title>Adoption</title></head><body>${body}</body></html>`,
  }));
  await page.goto('/adoption.html');
}

/** What a form submitted now would send. */
const formData = (page: Page, selector = 'form') =>
  page.evaluate((sel) => [...new FormData(document.querySelector(sel) as HTMLFormElement)], selector);

test('a root Fragment from the server is interactive after mount() adoption', async ({ page }) => {
  await serve(page, '<div id="app" data-forma-ssr><span id="note"><!--f:t0-->hello<!--/f:t0--></span><button id="go">go</button></div>');
  await page.evaluate(async () => {
    const { h, Fragment, mount, createSignal } = await import('/adoption-core.mjs' as string);
    const [note, setNote] = createSignal('hello');
    (window as any).serverSpan = document.getElementById('note');
    mount(() => h(Fragment, null,
      h('span', { id: 'note' }, () => note()),
      h('button', { id: 'go', onClick: () => setNote(note() === 'bye' ? 'hello' : 'bye') }, 'go'),
    ), '#app');
  });
  await expect(page.locator('#app')).not.toHaveAttribute('data-forma-ssr');
  await page.locator('#go').click();
  await expect(page.locator('#note')).toHaveText('bye');
  await page.locator('#go').click();
  await expect(page.locator('#note')).toHaveText('hello');
  await page.locator('#go').click();
  await expect(page.locator('#note')).toHaveText('bye');
  expect(await page.evaluate(() => document.getElementById('note') === (window as any).serverSpan)).toBe(true);
  await expect(page.locator('#app span')).toHaveCount(1);
});

test('what the user entered before activation survives adoption, and later updates still apply', async ({ page }) => {
  await serve(page,
    '<div id="app" data-forma-ssr><form>' +
    '<input id="text" name="text" value="Saved">' +
    '<input id="agree" name="agree" type="checkbox" checked>' +
    '<select id="cycle" name="cycle"><option value="monthly">Monthly</option><option value="yearly" selected>Yearly</option><option value="weekly">Weekly</option></select>' +
    '<textarea id="notes" name="notes">Saved notes</textarea>' +
    // An older server (before FORMA-002): marker text inside the textarea.
    '<textarea id="legacy" name="legacy"><!--f:t0-->hello<!--/f:t0--></textarea>' +
    '</form></div>');

  // The user acts before the module loads.
  await page.locator('#text').fill('Typed');
  await page.locator('#agree').uncheck();
  await page.locator('#cycle').selectOption('weekly');
  await page.locator('#notes').fill('Typed notes');
  await page.locator('#legacy').fill('Typed legacy');
  await page.locator('#text').focus();

  await page.evaluate(async () => {
    const { h, mount, createSignal } = await import('/adoption-core.mjs' as string);
    const [state, setState] = createSignal({ text: 'Saved', agree: true, cycle: 'yearly', notes: 'Saved notes', legacy: 'hello' });
    (window as any).setState = setState;
    mount(() => h('form', null,
      h('input', { id: 'text', name: 'text', value: () => state().text }),
      h('input', { id: 'agree', name: 'agree', type: 'checkbox', checked: () => state().agree }),
      h('select', { id: 'cycle', name: 'cycle', value: () => state().cycle },
        h('option', { value: 'monthly' }, 'Monthly'), h('option', { value: 'yearly' }, 'Yearly'), h('option', { value: 'weekly' }, 'Weekly')),
      h('textarea', { id: 'notes', name: 'notes', value: () => state().notes }),
      h('textarea', { id: 'legacy', name: 'legacy' }, () => state().legacy),
    ), '#app');
  });

  await expect(page.locator('#app')).not.toHaveAttribute('data-forma-ssr');
  await expect(page.locator('#text')).toHaveValue('Typed');
  await expect(page.locator('#text')).toBeFocused();
  await expect(page.locator('#agree')).not.toBeChecked();
  await expect(page.locator('#cycle')).toHaveValue('weekly');
  await expect(page.locator('#notes')).toHaveValue('Typed notes');
  await expect(page.locator('#legacy')).toHaveValue('Typed legacy');
  // The legacy textarea's default (what a form reset restores) lost its marker text.
  expect(await page.locator('#legacy').evaluate((el: HTMLTextAreaElement) => el.defaultValue)).toBe('hello');
  expect(await formData(page)).toEqual([
    ['text', 'Typed'], ['cycle', 'weekly'], ['notes', 'Typed notes'], ['legacy', 'Typed legacy'],
  ]);

  // After activation the controls are controlled again.
  await page.evaluate(() => (window as any).setState({ text: 'Reset', agree: true, cycle: 'monthly', notes: 'Reset notes', legacy: 'reset' }));
  await expect(page.locator('#text')).toHaveValue('Reset');
  await expect(page.locator('#agree')).toBeChecked();
  await expect(page.locator('#cycle')).toHaveValue('monthly');
  await expect(page.locator('#notes')).toHaveValue('Reset notes');
  // Reactive children are the textarea's default: an update after the user
  // typed changes what a form reset restores, not their text.
  await expect(page.locator('#legacy')).toHaveValue('Typed legacy');
  expect(await page.locator('#legacy').evaluate((el: HTMLTextAreaElement) => el.defaultValue)).toBe('reset');
});

test('an untouched page whose server agrees with the client is adopted without one DOM write', async ({ page }) => {
  // forma-ir 0.2.1 output (FORMA-002): no markers in textarea or title, `selected` on the option.
  await serve(page,
    '<div id="app" data-forma-ssr><form>' +
    '<input id="text" name="text" value="Saved"><input id="agree" name="agree" type="checkbox" checked>' +
    '<select id="cycle" name="cycle"><option value="monthly">Monthly</option><option value="yearly" selected>Yearly</option></select>' +
    '<textarea id="notes" name="notes">hello</textarea><div><title id="tt">Page</title></div>' +
    '</form></div>');
  const before = await formData(page);

  const records = await page.evaluate(async () => {
    const seen: string[] = [];
    const observer = new MutationObserver((batch) => {
      for (const r of batch) seen.push(`${r.type}:${(r.target as Element).id || (r.target as Node).nodeName}:${r.attributeName ?? ''}`);
    });
    observer.observe(document.getElementById('app')!, { subtree: true, childList: true, attributes: true, characterData: true });
    const { h, mount } = await import('/adoption-core.mjs' as string);
    mount(() => h('form', null,
      h('input', { id: 'text', name: 'text', value: () => 'Saved' }),
      h('input', { id: 'agree', name: 'agree', type: 'checkbox', checked: () => true }),
      h('select', { id: 'cycle', name: 'cycle', value: () => 'yearly' },
        h('option', { value: 'monthly' }, 'Monthly'), h('option', { value: 'yearly' }, 'Yearly')),
      h('textarea', { id: 'notes', name: 'notes' }, () => 'hello'),
      h('div', null, h('title', { id: 'tt' }, () => 'Page')),
    ), '#app');
    await new Promise((resolve) => setTimeout(resolve, 0));
    seen.push(...observer.takeRecords().map((r) => `${r.type}:${(r.target as Element).id}:${r.attributeName ?? ''}`));
    observer.disconnect();
    return seen;
  });

  expect(records).toEqual(['attributes:app:data-forma-ssr']);
  expect(await formData(page)).toEqual(before);
  expect(before).toEqual([['text', 'Saved'], ['agree', 'on'], ['cycle', 'yearly'], ['notes', 'hello']]);
});

test("an older server's marker text and unselected select are repaired at adoption", async ({ page }) => {
  // forma-ir 0.2.0 output: markers inside RCDATA, `value=` on the select.
  await serve(page,
    '<div id="app" data-forma-ssr><form>' +
    '<textarea id="ta" name="ta"><!--f:t0-->hello<!--/f:t0--></textarea>' +
    '<select id="choice" name="choice" value="b"><option value="a">A</option><option value="b">B</option><option value="c">C</option></select>' +
    '<div><title id="tt"><!--f:t0-->hello<!--/f:t0--></title></div>' +
    '</form></div>');
  // The defects as served (verification run 2 and run 3).
  expect(await formData(page)).toEqual([['ta', '<!--f:t0-->hello<!--/f:t0-->'], ['choice', 'a']]);
  await expect(page.locator('#tt')).toHaveText('<!--f:t0-->hello<!--/f:t0-->');

  await page.evaluate(async () => {
    const { h, mount, createSignal } = await import('/adoption-core.mjs' as string);
    const [text, setText] = createSignal('hello');
    const [choice, setChoice] = createSignal('b');
    Object.assign(window as any, { setText, setChoice });
    mount(() => h('form', null,
      h('textarea', { id: 'ta', name: 'ta' }, () => text()),
      h('select', { id: 'choice', name: 'choice', value: () => choice() },
        h('option', { value: 'a' }, 'A'), h('option', { value: 'b' }, 'B'), h('option', { value: 'c' }, 'C')),
      h('div', null, h('title', { id: 'tt' }, () => text())),
    ), '#app');
  });

  expect(await formData(page)).toEqual([['ta', 'hello'], ['choice', 'b']]);
  await expect(page.locator('#tt')).toHaveText('hello');
  await page.evaluate(() => { (window as any).setText('updated'); (window as any).setChoice('c'); });
  expect(await formData(page)).toEqual([['ta', 'updated'], ['choice', 'c']]);
  await expect(page.locator('#tt')).toHaveText('updated');
});

test("after the user types, a textarea's reactive text changes only its default, client-rendered and adopted alike", async ({ page }) => {
  await serve(page, '<div id="csr"></div><div id="ssr" data-forma-ssr><textarea id="adopted">Hello Ann</textarea></div>');
  await page.evaluate(async () => {
    const { h, mount, createSignal } = await import('/adoption-core.mjs' as string);
    const [text, setText] = createSignal('Hello Ann');
    (window as any).setText = setText;
    mount(() => h('textarea', { id: 'rendered' }, () => text()), '#csr');
    mount(() => h('textarea', { id: 'adopted' }, () => text()), '#ssr');
  });
  for (const id of ['#rendered', '#adopted']) {
    await expect(page.locator(id)).toHaveValue('Hello Ann');
    await page.locator(id).fill('Hello Ann, my long message');
  }
  await page.evaluate(() => (window as any).setText('Hello Bob'));
  for (const id of ['#rendered', '#adopted']) {
    await expect(page.locator(id)).toHaveValue('Hello Ann, my long message');
    expect(await page.locator(id).evaluate((el: HTMLTextAreaElement) => el.defaultValue)).toBe('Hello Bob');
  }
});

test('a component that returns a DOM node is adopted as itself or reported, and never aborts the module', async ({ page }) => {
  await serve(page,
    '<div id="app" data-forma-ssr><p>static</p></div>' +
    '<div data-forma-island="0" data-forma-component="Imp"><button id="imp">0</button></div>' +
    '<div data-forma-island="1" data-forma-component="Detached"><span>server</span></div>');
  const errors: string[] = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(`uncaught: ${err.message}`));

  await page.evaluate(async () => {
    const { mount, activateIslands, createSignal, createEffect, template } = await import('/adoption-core.mjs' as string);
    mount(() => template('<p>static</p>'), '#app');
    (window as any).afterMount = true;
    activateIslands({
      Imp: (el: HTMLElement) => {
        const [n, setN] = createSignal(0);
        const button = el.querySelector('button')!;
        button.addEventListener('click', () => setN(n() + 1));
        createEffect(() => { button.textContent = String(n()); });
        return el;
      },
      Detached: () => document.createElement('span'),
    });
  });

  expect(await page.evaluate(() => (window as any).afterMount)).toBe(true);
  await expect(page.locator('#app')).toHaveAttribute('data-forma-ssr', '');
  await expect(page.locator('#app')).toHaveText('static');
  await expect(page.locator('[data-forma-island="0"]')).toHaveAttribute('data-forma-status', 'active');
  await page.locator('#imp').click();
  await page.locator('#imp').click();
  await expect(page.locator('#imp')).toHaveText('2');
  await expect(page.locator('[data-forma-island="1"]')).toHaveAttribute('data-forma-status', 'error');
  await expect(page.locator('[data-forma-island="1"]')).toHaveText('server');
  expect(errors.filter((e) => e.startsWith('uncaught'))).toEqual([]);
  expect(errors.filter((e) => e.includes('FORMA_E_HYDRATE_NODE'))).toHaveLength(2);
});

test('an option bound to undefined submits its text, client-rendered and adopted', async ({ page }) => {
  await serve(page,
    '<form id="csr"></form>' +
    '<div id="ssr" data-forma-ssr><form id="adopted"><select name="s"><option>Alpha</option><option>Beta</option></select></form></div>');
  await page.evaluate(async () => {
    const { h, mount } = await import('/adoption-core.mjs' as string);
    mount(() => h('select', { name: 'c' }, h('option', { value: undefined }, 'Alpha'), h('option', { value: null }, 'Beta')), '#csr');
    mount(() => h('form', { id: 'adopted' },
      h('select', { name: 's' }, h('option', { value: () => undefined }, 'Alpha'), h('option', { value: () => null }, 'Beta'))), '#ssr');
  });
  expect(await formData(page, '#csr')).toEqual([['c', 'Alpha']]);
  expect(await formData(page, '#adopted')).toEqual([['s', 'Alpha']]);
  await page.locator('#csr select').selectOption({ index: 1 });
  expect(await formData(page, '#csr')).toEqual([['c', 'Beta']]);
});
