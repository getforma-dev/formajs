import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
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

// FORMA-020: inline SVG and MathML (decision brief DR-5, DR-9, R7). Chromium's
// parser puts them in their own namespaces, where `tagName` is not upper-cased.
const NS = { html: 'http://www.w3.org/1999/xhtml', svg: 'http://www.w3.org/2000/svg', mathml: 'http://www.w3.org/1998/Math/MathML' };

test('an inline SVG icon is adopted without one DOM write; its title stays SVG and a bound path updates in place', async ({ page }) => {
  await serve(page, '<div id="app" data-forma-ssr><button id="close"><svg viewBox="0 0 10 10"><title>Close</title><path d="M0 0L10 10"/></svg></button></div>');
  await expect(page.locator('#close')).toHaveAccessibleName('Close');

  const adopted = await page.evaluate(async () => {
    const app = document.getElementById('app')!;
    const server = Array.from(app.querySelectorAll('*'));
    const seen: string[] = [];
    const observer = new MutationObserver((batch) => {
      for (const r of batch) seen.push(`${r.type}:${(r.target as Element).id || (r.target as Node).nodeName}:${r.attributeName ?? ''}`);
    });
    observer.observe(app, { subtree: true, childList: true, attributes: true, characterData: true });
    const { h, mount, createSignal } = await import('/adoption-core.mjs' as string);
    const [d, setD] = createSignal('M0 0L10 10');
    (window as any).setD = setD;
    mount(() => h('button', { id: 'close' },
      h('svg', { viewBox: '0 0 10 10' }, h('title', null, 'Close'), h('path', { d: () => d() }))), '#app');
    await new Promise((resolve) => setTimeout(resolve, 0));
    seen.push(...observer.takeRecords().map((r) => `${r.type}:${(r.target as Element).id}:${r.attributeName ?? ''}`));
    observer.disconnect();
    const now = Array.from(app.querySelectorAll('*'));
    return {
      seen,
      sameNodes: now.length === server.length && now.every((el, i) => el === server[i]),
      namespaces: now.map((el) => `${el.localName}:${el.namespaceURI}`),
    };
  });

  expect(adopted.seen).toEqual(['attributes:app:data-forma-ssr']);
  expect(adopted.sameNodes).toBe(true);
  expect(adopted.namespaces).toEqual([`button:${NS.html}`, `svg:${NS.svg}`, `title:${NS.svg}`, `path:${NS.svg}`]);
  await expect(page.locator('#close')).toHaveAccessibleName('Close');

  for (const next of ['M10 0L0 10', 'M0 5L10 5', 'M0 0L10 10']) {
    const updated = await page.evaluate(async (d) => {
      const path = document.querySelector('#app path')!;
      const seen: string[] = [];
      const observer = new MutationObserver(() => {});
      observer.observe(document.getElementById('app')!, { subtree: true, childList: true, attributes: true, characterData: true });
      (window as any).setD(d);
      seen.push(...observer.takeRecords().map((r) => `${r.type}:${(r.target as Element).localName}:${r.attributeName ?? ''}`));
      observer.disconnect();
      return { seen, same: document.querySelector('#app path') === path, d: path.getAttribute('d') };
    }, next);
    expect(updated).toEqual({ seen: ['attributes:path:d'], same: true, d: next });
  }
});

test('SVG and MathML are adopted in place, and what adoption must create inside them gets their namespace', async ({ page }) => {
  await serve(page,
    '<div id="app" data-forma-ssr><div><p id="formula"><math><mi>x</mi></math></p>' +
    '<svg id="icon" viewBox="0 0 10 10"><circle r="1"/></svg></div></div>');
  const page1 = await page.evaluate(async () => {
    const math = document.querySelector('math')!;
    const mi = document.querySelector('mi')!;
    const icon = document.getElementById('icon')!;
    const originalWarn = console.warn;
    console.warn = () => {};
    const { h, mount, createSignal } = await import('/adoption-core.mjs' as string);
    const [x, setX] = createSignal('x');
    (window as any).setX = setX;
    try {
      mount(() => h('div', null,
        h('p', { id: 'formula' }, h('math', null, h('mi', null, () => x()), h('mo', null, '+'), h('mn', null, '1'))),
        // The server rendered a circle; the client wants a titled link.
        h('svg', { id: 'icon', viewBox: '0 0 10 10' }, h('title', null, 'Close'), h('a', { href: '#close' }, h('path', { d: 'M0 0L10 10' }))),
      ), '#app');
    } finally {
      console.warn = originalWarn;
    }
    const ns = (sel: string) => Array.from(document.querySelectorAll(sel), (el) => `${el.localName}:${el.namespaceURI}`);
    return {
      kept: document.querySelector('math') === math && document.querySelector('mi') === mi && document.getElementById('icon') === icon,
      math: ns('#formula *'),
      svg: ns('#icon *'),
    };
  });
  expect(page1.kept).toBe(true);
  expect(page1.math).toEqual([`math:${NS.mathml}`, `mi:${NS.mathml}`, `mo:${NS.mathml}`, `mn:${NS.mathml}`]);
  expect(page1.svg).toEqual([`title:${NS.svg}`, `a:${NS.svg}`, `path:${NS.svg}`]);
  await expect(page.locator('#formula')).toHaveText('x+1');
  await page.evaluate(() => (window as any).setX('y'));
  await expect(page.locator('#formula')).toHaveText('y+1');
});

test("a bound iframe src the server already rendered is not set again, so the frame is not reloaded", async ({ page }) => {
  await page.route(/\/frame\.html/, (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><p>frame ${new URL(route.request().url()).search}</p>`,
  }));
  await serve(page, '<div id="app" data-forma-ssr><iframe id="frame" src="/frame.html" title="frame"></iframe></div>');
  await page.waitForFunction(() => (document.getElementById('frame') as HTMLIFrameElement).contentDocument?.readyState === 'complete');

  const result = await page.evaluate(async () => {
    const frame = document.getElementById('frame') as HTMLIFrameElement;
    let loads = 0;
    frame.addEventListener('load', () => loads++);
    (frame.contentWindow as any).state = 'kept';
    const { h, mount, createSignal } = await import('/adoption-core.mjs' as string);
    const [src, setSrc] = createSignal('/frame.html');
    (window as any).setSrc = setSrc;
    mount(() => h('iframe', { id: 'frame', src: () => src(), title: 'frame' }), '#app');
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { loads, state: (frame.contentWindow as any).state ?? null };
  });
  expect(result).toEqual({ loads: 0, state: 'kept' });

  // A real change still navigates the frame.
  await page.evaluate(() => (window as any).setSrc('/frame.html?next'));
  await expect(page.frameLocator('#frame').locator('p')).toHaveText('frame ?next');
});

// FORMA-026 (decision brief DR-9): the shared namespace vectors through each
// engine's parser. src/__tests__/renderer-contract.test.ts runs the same file
// through h() and renderToString; here the browser parses the server markup,
// h() builds the tree, and adoption binds the parsed markup.
type NsTree = [string, Record<string, unknown> | null, ...unknown[]];
const NS_VECTORS = (JSON.parse(readFileSync(new URL('../src/__tests__/vectors/namespaces.json', import.meta.url), 'utf8')) as {
  vectors: Array<{ name: string; server: string; tree: NsTree; namespaces: string[] }>;
}).vectors;

test('the namespace vectors: the parser, h() and adoption agree on every element and on the markup', async ({ page }) => {
  await serve(page, NS_VECTORS.map((v, i) => `<div class="ssr" id="ssr${i}" data-forma-ssr>${v.server}</div><div id="csr${i}"></div>`).join(''));
  const results = await page.evaluate(async (vectors) => {
    const { h, mount } = await import('/adoption-core.mjs' as string);
    const short: Record<string, string> = {
      'http://www.w3.org/1999/xhtml': 'html', 'http://www.w3.org/2000/svg': 'svg', 'http://www.w3.org/1998/Math/MathML': 'mathml',
    };
    const build = ([tag, props, ...children]: NsTree): unknown =>
      h(tag, props, ...children.map((c) => (typeof c === 'string' ? c : build(c as NsTree))));
    const namespaces = (root: Element) =>
      [root, ...Array.from(root.querySelectorAll('*'))].map((el) => `${el.localName}:${short[el.namespaceURI ?? ''] ?? el.namespaceURI}`);
    return vectors.map((v, i) => {
      const ssr = document.getElementById(`ssr${i}`)!;
      const parsedRoot = ssr.firstElementChild!;
      const parsed = namespaces(parsedRoot);
      const parsedHtml = parsedRoot.outerHTML;
      mount(() => build(v.tree), `#csr${i}`);
      const built = document.getElementById(`csr${i}`)!.firstElementChild!;
      const writes: string[] = [];
      const observer = new MutationObserver(() => {});
      observer.observe(ssr, { subtree: true, childList: true, attributes: true, characterData: true });
      mount(() => build(v.tree), `#ssr${i}`);
      for (const r of observer.takeRecords()) writes.push(`${r.type}:${(r.target as Element).id || (r.target as Element).localName}:${r.attributeName ?? ''}`);
      observer.disconnect();
      return {
        name: v.name, parsed, built: namespaces(built), adopted: namespaces(ssr.firstElementChild!),
        sameNode: ssr.firstElementChild === parsedRoot, parsedHtml, builtHtml: built.outerHTML, writes,
      };
    });
  }, NS_VECTORS);

  for (const [i, r] of results.entries()) {
    const v = NS_VECTORS[i]!;
    expect({ name: r.name, parsed: r.parsed }).toEqual({ name: v.name, parsed: v.namespaces });
    expect({ name: r.name, built: r.built }).toEqual({ name: v.name, built: v.namespaces });
    expect({ name: r.name, html: r.builtHtml }).toEqual({ name: v.name, html: r.parsedHtml });
    expect({ name: r.name, html: r.builtHtml }).toEqual({ name: v.name, html: v.server });
    expect({ name: r.name, adopted: r.adopted, sameNode: r.sameNode, writes: r.writes }).toEqual({
      name: v.name, adopted: v.namespaces, sameNode: true, writes: [`attributes:ssr${i}:data-forma-ssr`],
    });
  }
});

test('content built inside an svg after activation is SVG: a createShow branch, list rows, switch cases, a portal; a foreignObject holds HTML', async ({ page }) => {
  await serve(page, '<div id="app"></div><svg id="target"></svg>' +
    '<div id="adopt" data-forma-ssr><svg viewBox="0 0 10 10"><g id="show"><!--f:s0--><!--/f:s0--></g>' +
    '<g id="rows"><!--f:l0--><a data-forma-key="a" href="#a"><title>a</title></a><!--/f:l0--></g></svg></div>');
  const steps = await page.evaluate(async () => {
    const { h, mount, createSignal, createShow, createList, createSwitch, createPortal } = await import('/adoption-core.mjs' as string);
    const SVG = 'http://www.w3.org/2000/svg';
    const nonSvg = (root: Element) =>
      Array.from(root.querySelectorAll('*')).filter((el) => el.namespaceURI !== SVG && !el.closest('foreignObject')).map((el) => el.localName);
    const [on, setOn] = createSignal(true);
    const [keys, setKeys] = createSignal(['a', 'b']);
    const [tab, setTab] = createSignal('a');
    mount(() => h('svg', { id: 'built', viewBox: '0 0 10 10' },
      h('g', { id: 'g-show' }, createShow(on, () => h('title', null, 'On'), () => h('a', { href: '#off' }, h('circle', { r: '1' })))),
      h('g', { id: 'g-rows' }, createList(keys, (k: string) => k, (k: string) => h('a', { href: `#${k}` }, h('title', null, k)))),
      h('g', { id: 'g-switch' }, createSwitch(tab, [
        { match: 'a', render: () => h('a', { href: '#a' }, 'A') },
        { match: 't', render: () => h('title', null, 'T') },
      ], () => h('style', null, 'circle{}'))),
      h('foreignObject', { width: '10', height: '10' }, h('div', null, h('a', { href: '#html' }, 'html'))),
    ), '#app');
    createPortal(() => h('title', null, 'Portaled'), document.getElementById('target')!);
    const warn = console.warn;
    console.warn = () => {};
    const [aOn, setAOn] = createSignal(true);
    const [aKeys, setAKeys] = createSignal(['a', 'b']);
    mount(() => h('svg', { viewBox: '0 0 10 10' },
      h('g', { id: 'show' }, createShow(aOn, () => h('title', null, 'On'), () => h('a', { href: '#off' }, 'Off'))),
      h('g', { id: 'rows' }, createList(aKeys, (k: string) => k, (k: string) => h('a', { 'data-forma-key': k, href: `#${k}` }, h('title', null, k)))),
    ), '#adopt');
    console.warn = warn;

    const built = document.getElementById('built')!;
    const snapshot = (label: string) => ({
      label,
      nonSvg: [...nonSvg(built), ...nonSvg(document.getElementById('target')!), ...nonSvg(document.querySelector('#adopt svg')!)],
      htmlInForeignObject: Array.from(built.querySelectorAll('foreignObject *'), (el) => `${el.localName}:${el.namespaceURI === SVG ? 'svg' : 'html'}`),
      shown: [built.querySelector('#g-show')!.firstElementChild?.localName, document.querySelector('#adopt #show')!.firstElementChild?.localName],
    });
    const out = [snapshot('first render')];
    setOn(false); setKeys(['c', 'a', 'b']); setTab('t'); setAOn(false); setAKeys(['c', 'a', 'b']);
    out.push(snapshot('after one update'));
    setOn(true); setKeys(['b']); setTab('other'); setAOn(true); setAKeys(['b', 'd']);
    out.push(snapshot('after two'));
    setOn(false); setTab('a'); setAOn(false);
    out.push(snapshot('after three'));
    return out;
  });
  expect(steps.map((s) => s.label)).toEqual(['first render', 'after one update', 'after two', 'after three']);
  for (const s of steps) {
    expect({ label: s.label, nonSvg: s.nonSvg, foreign: s.htmlInForeignObject }).toEqual({
      label: s.label, nonSvg: [], foreign: ['div:html', 'a:html'],
    });
  }
  expect(steps.map((s) => s.shown)).toEqual([['title', 'title'], ['a', 'a'], ['title', 'title'], ['a', 'a']]);
});
