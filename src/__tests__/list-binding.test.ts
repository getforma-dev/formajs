/**
 * List item binding tests.
 *
 * These tests verify that directives (data-on:click, data-show, data-class:, etc.)
 * work on cloned data-list template children. Currently they do NOT work because
 * cloneWithTemplateData() in runtime.ts clones templates and performs {item.prop}
 * interpolation but never calls bindElement() on the clones.
 *
 * ALL 6 TESTS ARE EXPECTED TO FAIL until child scope binding is implemented.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, setUnsafeEval } from '../runtime';

function waitForEffects(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('data-list child binding', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    setUnsafeEval(true);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    unmount(container);
    container.remove();
  });

  // ── Test 1: data-on:click on list item children ──
  it('should handle data-on:click on list item button and update parent scope', async () => {
    container.innerHTML = `
      <div data-forma-state='{"items": [{"id": 1, "label": "A"}, {"id": 2, "label": "B"}], "clicked": ""}'>
        <ul data-list="{items}">
          <li data-key="{item.id}">
            <span data-text="{item.label}"></span>
            <button data-on:click="clicked = item.label">Select</button>
          </li>
        </ul>
        <p id="result" data-text="{clicked}"></p>
      </div>
    `;
    mount(container);
    await waitForEffects();

    // There should be 2 list items rendered
    const buttons = container.querySelectorAll('li button');
    expect(buttons.length).toBe(2);

    // Click the first item's button — should set clicked = "A"
    (buttons[0] as HTMLElement).click();
    await waitForEffects();

    const result = container.querySelector('#result');
    expect(result?.textContent).toBe('A');
  });

  // ── Test 2: data-show on list item children ──
  it('should apply data-show to list item children based on item properties', async () => {
    container.innerHTML = `
      <div data-forma-state='{"items": [{"id": 1, "name": "Visible", "active": true}, {"id": 2, "name": "Hidden", "active": false}]}'>
        <div data-list="{items}">
          <div data-key="{item.id}">
            <span class="label">{item.name}</span>
            <span class="badge" data-show="{item.active}">Active</span>
          </div>
        </div>
      </div>
    `;
    mount(container);
    await waitForEffects();

    const badges = container.querySelectorAll('.badge') as NodeListOf<HTMLElement>;
    expect(badges.length).toBe(2);

    // First item (active: true) — badge should be visible
    expect(badges[0].style.display).not.toBe('none');

    // Second item (active: false) — badge should be hidden
    expect(badges[1].style.display).toBe('none');
  });

  // ── Test 3: data-class on list item children ──
  it('should toggle data-class: on list item children based on expression', async () => {
    container.innerHTML = `
      <div data-forma-state='{"items": [{"id": 1, "name": "One"}, {"id": 2, "name": "Two"}], "activeId": 1}'>
        <div data-list="{items}">
          <div data-key="{item.id}" data-class:selected="activeId === item.id">
            <span>{item.name}</span>
          </div>
        </div>
      </div>
    `;
    mount(container);
    await waitForEffects();

    const items = container.querySelectorAll('[data-key]');
    expect(items.length).toBe(2);

    // First item (id=1, activeId=1) — should have 'selected' class
    expect(items[0].classList.contains('selected')).toBe(true);

    // Second item (id=2, activeId=1) — should NOT have 'selected' class
    expect(items[1].classList.contains('selected')).toBe(false);
  });

  // ── Test 4: write to parent scope from list item handler ──
  it('should write to parent scope from a data-on:click handler in a list item', async () => {
    container.innerHTML = `
      <div data-forma-state='{"items": [{"id": 10, "name": "Alpha"}, {"id": 20, "name": "Beta"}], "activeId": 0}'>
        <div data-list="{items}">
          <div data-key="{item.id}" data-on:click="activeId = item.id">
            <span>{item.name}</span>
          </div>
        </div>
        <p id="active-display" data-text="{activeId}"></p>
      </div>
    `;
    mount(container);
    await waitForEffects();

    const listItems = container.querySelectorAll('[data-key]');
    expect(listItems.length).toBe(2);

    // Click the second item — should set activeId = 20
    (listItems[1] as HTMLElement).click();
    await waitForEffects();

    const display = container.querySelector('#active-display');
    expect(display?.textContent).toBe('20');
  });

  // ── Test 5: dispose list item bindings when items are removed ──
  it('should dispose __formaDisposers on list item clones when items are removed', async () => {
    container.innerHTML = `
      <div data-forma-state='{"items": [{"id": 1, "name": "A"}, {"id": 2, "name": "B"}, {"id": 3, "name": "C"}]}'>
        <div id="list-container" data-list="{items}">
          <div data-key="{item.id}">
            <span data-show="{item.id}">{item.name}</span>
          </div>
        </div>
      </div>
    `;
    mount(container);
    await waitForEffects();

    const listEl = container.querySelector('#list-container')!;
    let clones = listEl.querySelectorAll('[data-key]');
    expect(clones.length).toBe(3);

    // Each clone should have __formaDisposers if bindElement was called on it
    const hasDisposers = Array.from(clones).some(
      (el) => Array.isArray((el as any).__formaDisposers) && (el as any).__formaDisposers.length > 0,
    );
    expect(hasDisposers).toBe(true);

    // Now shrink the array to 1 item by updating scope
    const stateEl = container.querySelector('[data-forma-state]')!;
    const scope = (stateEl as any).__formaScope;
    scope.setters.items([{ id: 1, name: 'A' }]);
    await waitForEffects();

    // After removal, only 1 clone should remain
    clones = listEl.querySelectorAll('[data-key]');
    expect(clones.length).toBe(1);
  });

  // ── Test 6: inner item shadows outer item in nested data-list ──
  it('should shadow outer item with inner item in nested data-list', async () => {
    container.innerHTML = `
      <div data-forma-state='{"groups": [{"id": 1, "label": "G1", "children": [{"id": 10, "label": "C1"}, {"id": 11, "label": "C2"}]}]}'>
        <div data-list="{groups}">
          <div data-key="{item.id}" class="group">
            <h3>{item.label}</h3>
            <div data-list="{item.children}">
              <div data-key="{item.id}" class="child">
                <span class="child-label" data-text="{item.label}"></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    mount(container);
    await waitForEffects();

    // Outer list should render 1 group
    const groups = container.querySelectorAll('.group');
    expect(groups.length).toBe(1);

    // Inner list should render 2 children
    const children = container.querySelectorAll('.child');
    expect(children.length).toBe(2);

    // Inner item.label should shadow outer item.label
    // First child should show "C1", not "G1"
    const childLabels = container.querySelectorAll('.child-label');
    expect(childLabels[0]?.textContent).toBe('C1');
    expect(childLabels[1]?.textContent).toBe('C2');
  });
});

describe('data-list transitions', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    setUnsafeEval(true);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    unmount(container);
    container.remove();
    vi.useRealTimers();
  });

  it('runs enter animation on newly added list items', async () => {
    container.innerHTML = `
      <div data-forma-state='{"items": [{"id":"1","name":"A"}]}'>
        <div data-list="items"
          data-transition:enter="slide-in 50ms"
          data-transition:enter-from="opacity-0"
          data-transition:enter-to="opacity-100">
          <div data-key="{item.id}"><span data-text="item.name">x</span></div>
        </div>
      </div>
    `;
    mount(container);
    const root = container.querySelector('[data-forma-state]') as any;

    root.__formaScope.setters.items([
      {id: '1', name: 'A'},
      {id: '2', name: 'B'},
    ]);

    const items = container.querySelectorAll('[data-key]');
    expect(items.length).toBe(2);
    const newItem = items[1] as HTMLElement;
    expect(newItem.classList.contains('slide-in')).toBe(true);

    await vi.advanceTimersByTimeAsync(200);
    expect(newItem.classList.contains('slide-in')).toBe(false);
  });

  it('runs leave animation on removed list items before removal', async () => {
    container.innerHTML = `
      <div data-forma-state='{"items": [{"id":"1","name":"A"},{"id":"2","name":"B"}]}'>
        <div data-list="items"
          data-transition:leave="fade-out 50ms"
          data-transition:leave-from="opacity-100"
          data-transition:leave-to="opacity-0">
          <div data-key="{item.id}"><span data-text="item.name">x</span></div>
        </div>
      </div>
    `;
    mount(container);
    const root = container.querySelector('[data-forma-state]') as any;

    root.__formaScope.setters.items([{id: '1', name: 'A'}]);

    const leaving = container.querySelector('[data-forma-leaving]');
    expect(leaving).not.toBeNull();

    await vi.advanceTimersByTimeAsync(200);

    expect(container.querySelector('[data-forma-leaving]')).toBeNull();
    expect(container.querySelectorAll('[data-key]').length).toBe(1);
  });

  it('cancels leave animations and removes immediately on re-render', async () => {
    container.innerHTML = `
      <div data-forma-state='{"items": [{"id":"1","name":"A"},{"id":"2","name":"B"}]}'>
        <div data-list="items"
          data-transition:leave="fade-out 100ms">
          <div data-key="{item.id}"><span data-text="item.name">x</span></div>
        </div>
      </div>
    `;
    mount(container);
    const root = container.querySelector('[data-forma-state]') as any;

    root.__formaScope.setters.items([{id: '1', name: 'A'}]);
    expect(container.querySelector('[data-forma-leaving]')).not.toBeNull();

    root.__formaScope.setters.items([{id: '1', name: 'A'}, {id: '3', name: 'C'}]);

    expect(container.querySelector('[data-forma-leaving]')).toBeNull();
    expect(container.querySelectorAll('[data-key]').length).toBe(2);
  });

  it('data-list without transition attrs works identically to before', () => {
    container.innerHTML = `
      <div data-forma-state='{"items": [{"id":"1","name":"A"}]}'>
        <div data-list="items">
          <div data-key="{item.id}"><span data-text="item.name">x</span></div>
        </div>
      </div>
    `;
    mount(container);
    const root = container.querySelector('[data-forma-state]') as any;

    root.__formaScope.setters.items([
      {id: '1', name: 'A'},
      {id: '2', name: 'B'},
    ]);
    expect(container.querySelectorAll('[data-key]').length).toBe(2);

    root.__formaScope.setters.items([{id: '2', name: 'B'}]);
    expect(container.querySelectorAll('[data-key]').length).toBe(1);
  });
});
