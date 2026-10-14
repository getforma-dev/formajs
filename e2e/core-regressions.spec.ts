import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Optional installed Chrome is useful on machines without Playwright's bundle.
test.use({ channel: process.env.FORMA_TEST_BROWSER_CHANNEL || undefined });

test.beforeEach(async ({ page }) => {
  await page.route('**/core-regression.mjs', (route) => route.fulfill({
    path: fileURLToPath(new URL('../dist/forma.esm.js', import.meta.url)),
    contentType: 'text/javascript',
  }));
  await page.route('**/core-regression.html', (route) => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html><body><main id="app"></main></body></html>',
  }));
  await page.goto('/core-regression.html');
});

test('controlled input, textarea, checkbox and non-first selections survive real user edits', async ({ page }) => {
  await page.evaluate(async () => {
    const coreUrl = '/core-regression.mjs';
    const { h, mount, createSignal } = await import(coreUrl);
    const [state, setState] = createSignal({ value: 'Saved notes', checked: true, cycle: 'yearly' });
    (window as any).resetControls = () => setState({ value: 'Saved notes', checked: true, cycle: 'yearly' });
    mount(() => h('form', null,
      h('input', { id: 'text', value: () => state().value }),
      h('textarea', { id: 'notes', value: () => state().value }),
      h('input', { id: 'checked', checked: () => state().checked, type: 'checkbox' }),
      h('select', { id: 'cycle', value: () => state().cycle },
        h('option', { value: 'monthly' }, 'Monthly'), h('option', { value: 'yearly' }, 'Yearly')),
      h('select', { id: 'month', value: 9 },
        h('option', { value: 1 }, 'January'), h('option', { value: 9 }, 'September')),
    ), '#app');
  });
  await expect(page.locator('#cycle')).toHaveValue('yearly');
  await expect(page.locator('#month')).toHaveValue('9');
  await expect(page.locator('#notes')).toHaveValue('Saved notes');
  await page.locator('#text').fill('User changed this');
  await page.locator('#notes').fill('User changed these notes');
  await page.locator('#checked').uncheck();
  await page.locator('#cycle').selectOption('monthly');
  await page.evaluate(() => (window as any).resetControls());
  await expect(page.locator('#text')).toHaveValue('Saved notes');
  await expect(page.locator('#notes')).toHaveValue('Saved notes');
  await expect(page.locator('#checked')).toBeChecked();
  await expect(page.locator('#cycle')).toHaveValue('yearly');
});

test('multiple select changes update the browser live selection collection', async ({ page }) => {
  await page.evaluate(async () => {
    const coreUrl = '/core-regression.mjs';
    const { h, mount, createSignal } = await import(coreUrl);
    const [values, setValues] = createSignal(['b', 'c']);
    (window as any).clearSelection = () => setValues([]);
    mount(() => h('select', { id: 'multi', value: values, multiple: true },
      ['a', 'b', 'c'].map((value) => h('option', { value }, value))), '#app');
  });
  await expect(page.locator('#multi')).toHaveValues(['b', 'c']);
  await page.evaluate(() => (window as any).clearSelection());
  await expect(page.locator('#multi')).toHaveValues([]);
});

test('same-key rerenders dispose old reactive generations; unchanged objects retain focused DOM', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const coreUrl = '/core-regression.mjs';
    const { h, mount, createSignal, createEffect, createList } = await import(coreUrl);
    const original = { id: 1, label: 'A' };
    const [items, setItems] = createSignal([original]);
    const [tick, setTick] = createSignal(0);
    let created = 0;
    let disposed = 0;
    const spans: HTMLElement[] = [];
    const unmount = mount(() => h('div', null, createList(items, (item: any) => item.id, (item: any) => {
      createEffect(() => { created++; return () => disposed++; });
      const span = h('span', null, () => `${item.label}:${tick()}`);
      spans.push(span);
      return h('button', { onClick: () => {} }, span);
    }, { updateOnItemChange: 'rerender' })), '#app');
    const button = document.querySelector('button')!;
    button.focus();
    setItems([original]);
    const focusPreserved = document.activeElement === button;
    setItems([{ id: 1, label: 'B' }]);
    setItems([{ id: 1, label: 'C' }]);
    setTick(1);
    const generations = spans.map((span) => span.textContent);
    unmount();
    setTick(2);
    return { created, disposed, generations, focusPreserved, after: spans.map((span) => span.textContent) };
  });
  expect(result).toEqual({ created: 3, disposed: 3, focusPreserved: true,
    generations: ['A:0', 'B:0', 'C:1'], after: ['A:0', 'B:0', 'C:1'] });
});

test('SSR adoption restores form properties and keeps them controlled', async ({ page }) => {
  await page.evaluate(async () => {
    const coreUrl = '/core-regression.mjs';
    const { h, mount, createSignal } = await import(coreUrl);
    const root = document.querySelector('#app')!;
    root.setAttribute('data-forma-ssr', '');
    root.innerHTML = '<form><textarea id="notes" value="Saved notes"></textarea><select id="cycle" value="yearly"><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></form>';
    const [value, setValue] = createSignal('yearly');
    (window as any).selectMonthly = () => setValue('monthly');
    mount(() => h('form', null,
      h('textarea', { id: 'notes', value: 'Saved notes' }),
      h('select', { id: 'cycle', value },
        h('option', { value: 'monthly' }, 'Monthly'), h('option', { value: 'yearly' }, 'Yearly')),
    ), root);
  });
  await expect(page.locator('#notes')).toHaveValue('Saved notes');
  await expect(page.locator('#cycle')).toHaveValue('yearly');
  await page.evaluate(() => (window as any).selectMonthly());
  await expect(page.locator('#cycle')).toHaveValue('monthly');
});
