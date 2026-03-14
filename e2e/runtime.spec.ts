import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/runtime.html');
});

test.describe('data-text', () => {
  test('renders initial state values as text', async ({ page }) => {
    await expect(page.locator('#text-name')).toHaveText('Alice');
    await expect(page.locator('#text-count')).toHaveText('0');
  });

  test('evaluates expressions in text bindings', async ({ page }) => {
    await expect(page.locator('#text-expr')).toHaveText('Hello Alice');
  });

  test('updates text when state changes via click handler', async ({ page }) => {
    await page.click('#text-btn');
    await expect(page.locator('#text-name')).toHaveText('Bob');
    await expect(page.locator('#text-expr')).toHaveText('Hello Bob');
  });

  test('counter increments via click', async ({ page }) => {
    await expect(page.locator('#text-count')).toHaveText('0');
    await page.click('#count-btn');
    await expect(page.locator('#text-count')).toHaveText('1');
    await page.click('#count-btn');
    await expect(page.locator('#text-count')).toHaveText('2');
  });
});

test.describe('data-show', () => {
  test('element is visible when condition is true', async ({ page }) => {
    await expect(page.locator('#show-target')).toBeVisible();
  });

  test('element hides when condition becomes false', async ({ page }) => {
    await page.click('#show-toggle');
    await expect(page.locator('#show-target')).toBeHidden();
  });

  test('element reappears when toggled back', async ({ page }) => {
    await page.click('#show-toggle');
    await expect(page.locator('#show-target')).toBeHidden();
    await page.click('#show-toggle');
    await expect(page.locator('#show-target')).toBeVisible();
  });
});

test.describe('data-if', () => {
  test('element is removed from DOM when condition is false', async ({ page }) => {
    // data-if="{loggedIn}" starts false → element should not be in DOM
    await expect(page.locator('#if-target')).toHaveCount(0);
  });

  test('element is added to DOM when condition becomes true', async ({ page }) => {
    await page.click('#if-toggle');
    await expect(page.locator('#if-target')).toHaveCount(1);
    await expect(page.locator('#if-target')).toHaveText('Welcome back!');
  });

  test('element is removed again when toggled back', async ({ page }) => {
    await page.click('#if-toggle');
    await expect(page.locator('#if-target')).toHaveCount(1);
    await page.click('#if-toggle');
    await expect(page.locator('#if-target')).toHaveCount(0);
  });
});

test.describe('data-model', () => {
  test('typing into input updates bound text', async ({ page }) => {
    await page.fill('#model-input', 'alice@example.com');
    await expect(page.locator('#model-output')).toHaveText('alice@example.com');
  });

  test('clearing input clears bound text', async ({ page }) => {
    await page.fill('#model-input', 'test');
    await expect(page.locator('#model-output')).toHaveText('test');
    await page.fill('#model-input', '');
    await expect(page.locator('#model-output')).toHaveText('');
  });
});

test.describe('data-class:name', () => {
  test('class is absent when condition is false', async ({ page }) => {
    const el = page.locator('#class-target');
    await expect(el).not.toHaveClass(/active/);
  });

  test('class is added when condition becomes true', async ({ page }) => {
    await page.click('#class-toggle');
    await expect(page.locator('#class-target')).toHaveClass(/active/);
  });

  test('class is removed when toggled back', async ({ page }) => {
    await page.click('#class-toggle');
    await expect(page.locator('#class-target')).toHaveClass(/active/);
    await page.click('#class-toggle');
    await expect(page.locator('#class-target')).not.toHaveClass(/active/);
  });
});

test.describe('data-bind:attr', () => {
  test('sets href attribute from state', async ({ page }) => {
    await expect(page.locator('#bind-link')).toHaveAttribute('href', 'https://example.com');
  });

  test('sets disabled attribute from state', async ({ page }) => {
    await expect(page.locator('#bind-disabled')).toBeDisabled();
  });

  test('removes disabled when state changes', async ({ page }) => {
    await page.click('#bind-toggle');
    await expect(page.locator('#bind-disabled')).toBeEnabled();
  });
});

test.describe('data-computed', () => {
  test('renders computed value', async ({ page }) => {
    await expect(page.locator('#computed-total')).toHaveText('30');
  });

  test('computed updates when dependency changes', async ({ page }) => {
    await page.click('#computed-inc');
    await expect(page.locator('#computed-total')).toHaveText('40');
  });
});

test.describe('data-on:click', () => {
  test('increments counter on click', async ({ page }) => {
    await expect(page.locator('#event-count')).toHaveText('0');
    await page.click('#event-btn');
    await page.click('#event-btn');
    await page.click('#event-btn');
    await expect(page.locator('#event-count')).toHaveText('3');
  });

  test('reset button sets counter to zero', async ({ page }) => {
    await page.click('#event-btn');
    await page.click('#event-btn');
    await expect(page.locator('#event-count')).toHaveText('2');
    await page.click('#event-reset');
    await expect(page.locator('#event-count')).toHaveText('0');
  });
});

test.describe('data-list', () => {
  test('renders initial list items', async ({ page }) => {
    const items = page.locator('#list-container li');
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toHaveText('Apple');
    await expect(items.nth(1)).toHaveText('Banana');
    await expect(items.nth(2)).toHaveText('Cherry');
  });

  test('adds item to list', async ({ page }) => {
    await page.click('#list-add');
    const items = page.locator('#list-container li');
    await expect(items).toHaveCount(4);
    await expect(items.nth(3)).toHaveText('Date');
  });
});

test.describe('independent scopes', () => {
  test('each scope has its own state', async ({ page }) => {
    await expect(page.locator('#scope-a')).toHaveText('1');
    await expect(page.locator('#scope-b')).toHaveText('100');
  });

  test('clicking one scope does not affect the other', async ({ page }) => {
    await page.click('#scope-a-btn');
    await expect(page.locator('#scope-a')).toHaveText('2');
    await expect(page.locator('#scope-b')).toHaveText('100');

    await page.click('#scope-b-btn');
    await expect(page.locator('#scope-a')).toHaveText('2');
    await expect(page.locator('#scope-b')).toHaveText('101');
  });
});

test.describe('data-persist', () => {
  test('persist syncs value to localStorage', async ({ page }) => {
    await page.fill('#persist-input', 'persisted-value');
    await expect(page.locator('#persist-output')).toHaveText('persisted-value');
    // Runtime stores with 'forma:' prefix
    const stored = await page.evaluate(() => localStorage.getItem('forma:saved'));
    expect(stored).toBeTruthy();
  });
});
