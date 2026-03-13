/**
 * Multi-island integration tests — full-page scenarios.
 *
 * Tests the complete activateIslands → hydrateIsland → adoptNode pipeline
 * with real component functions, reactive signals, and SSR HTML.
 *
 * Covers:
 * 1. Two islands: both interactive, handlers fire, reactive text updates
 * 2. Island with list + show: adoption + subsequent reconciliation
 * 3. Island failure recovery: broken island, page remains usable
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSignal } from 'forma/reactive';
import { activateIslands } from '../activate';
import { h } from '../element';
import { createShow } from '../show';
import { createList } from '../list';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('multi-island integration', () => {
  // -------------------------------------------------------------------------
  // Test 1: Two islands both interactive
  // -------------------------------------------------------------------------
  it('two islands: both interactive, handlers fire, reactive text updates', () => {
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="Counter" data-forma-status="pending">
        <button>Click</button>
        <span><!--f:t0-->0<!--/f:t0--></span>
      </div>
      <div data-forma-island="1" data-forma-component="Greeting" data-forma-status="pending">
        <p><!--f:t0-->Hello<!--/f:t0--></p>
      </div>
    `;

    let setCount!: (v: number) => void;
    let setName!: (v: string) => void;

    activateIslands({
      Counter: () => {
        const [count, _setCount] = createSignal(0);
        setCount = _setCount;
        return h('div', null,
          h('button', { onClick: () => _setCount(count() + 1) }, 'Click'),
          h('span', null, () => String(count())),
        );
      },
      Greeting: () => {
        const [name, _setName] = createSignal('Hello');
        setName = _setName;
        return h('div', null,
          h('p', null, () => name()),
        );
      },
    });

    // Both islands activated
    expect(document.querySelectorAll('[data-forma-status="active"]').length).toBe(2);

    // Counter updates reactively
    setCount(5);
    expect(document.querySelector('[data-forma-island="0"] span')!.textContent).toBe('5');

    // Greeting updates reactively
    setName('World');
    expect(document.querySelector('[data-forma-island="1"] p')!.textContent).toBe('World');
  });

  it('single island: click handler fires and updates reactive text', () => {
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="Counter" data-forma-status="pending">
        <button>Click</button>
        <span><!--f:t0-->0<!--/f:t0--></span>
      </div>
    `;

    activateIslands({
      Counter: () => {
        const [count, setCount] = createSignal(0);
        return h('div', null,
          h('button', { onClick: () => setCount(count() + 1) }, 'Click'),
          h('span', null, () => String(count())),
        );
      },
    });

    expect(document.querySelector('[data-forma-status="active"]')).toBeTruthy();

    // Simulate click
    const button = document.querySelector('[data-forma-island="0"] button')!;
    button.dispatchEvent(new Event('click'));

    expect(document.querySelector('[data-forma-island="0"] span')!.textContent).toBe('1');

    // Click again
    button.dispatchEvent(new Event('click'));
    expect(document.querySelector('[data-forma-island="0"] span')!.textContent).toBe('2');
  });

  // -------------------------------------------------------------------------
  // Test 2: Island with list + show
  // -------------------------------------------------------------------------
  it('island with list + show: adoption + subsequent reconciliation', () => {
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="TodoList" data-forma-status="pending">
        <!--f:s0-->
        <ul>
          <!--f:l0-->
          <li data-forma-key="1">Task 1</li>
          <li data-forma-key="2">Task 2</li>
          <!--/f:l0-->
        </ul>
        <!--/f:s0-->
      </div>
    `;

    let setItems!: (v: { id: string; text: string }[]) => void;
    let setShow!: (v: boolean) => void;

    activateIslands({
      TodoList: () => {
        const [items, _setItems] = createSignal([
          { id: '1', text: 'Task 1' },
          { id: '2', text: 'Task 2' },
        ]);
        setItems = _setItems;
        const [show, _setShow] = createSignal(true);
        setShow = _setShow;

        return h('div', null,
          createShow(show, () =>
            h('ul', null,
              createList(
                items,
                (i: { id: string }) => i.id,
                (item: { id: string; text: string }, index: () => number) =>
                  h('li', { 'data-forma-key': item.id }, item.text),
              ),
            ),
          ),
        );
      },
    });

    expect(document.querySelector('[data-forma-status="active"]')).toBeTruthy();

    // Initial state: 2 items
    expect(document.querySelectorAll('li').length).toBe(2);

    // Add item
    setItems([
      { id: '1', text: 'Task 1' },
      { id: '2', text: 'Task 2' },
      { id: '3', text: 'Task 3' },
    ]);
    expect(document.querySelectorAll('li').length).toBe(3);

    // Toggle show off
    setShow(false);
    expect(document.querySelectorAll('li').length).toBe(0);

    // Toggle show back on
    setShow(true);
    expect(document.querySelectorAll('li').length).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Test 3: Error recovery
  // -------------------------------------------------------------------------
  it('island failure recovery: broken island, page remains usable', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="Broken" data-forma-status="pending">
        <p>SSR content stays</p>
      </div>
      <div data-forma-island="1" data-forma-component="Working" data-forma-status="pending">
        <p><!--f:t0-->OK<!--/f:t0--></p>
      </div>
    `;

    let setMsg!: (v: string) => void;

    activateIslands({
      Broken: () => { throw new Error('intentional'); },
      Working: () => {
        const [msg, _setMsg] = createSignal('OK');
        setMsg = _setMsg;
        return h('div', null, h('p', null, () => msg()));
      },
    });

    // Broken island shows SSR content with error status
    expect(document.querySelector('[data-forma-island="0"]')!
      .getAttribute('data-forma-status')).toBe('error');
    expect(document.querySelector('[data-forma-island="0"] p')!.textContent)
      .toBe('SSR content stays');

    // Working island is interactive
    expect(document.querySelector('[data-forma-island="1"]')!
      .getAttribute('data-forma-status')).toBe('active');
    setMsg('Updated');
    expect(document.querySelector('[data-forma-island="1"] p')!.textContent)
      .toBe('Updated');

    errorSpy.mockRestore();
  });

  it('broken island preserves SSR content while sibling gets dispose function', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="Broken" data-forma-status="pending">
        <p>Preserved content</p>
      </div>
      <div data-forma-island="1" data-forma-component="Good" data-forma-status="pending">
        <span>OK</span>
      </div>
    `;

    activateIslands({
      Broken: () => { throw new Error('boom'); },
      Good: () => {
        return h('div', null, h('span', null, 'OK'));
      },
    });

    // Broken island: error status, no dispose, SSR content intact
    const broken = document.querySelector('[data-forma-island="0"]') as any;
    expect(broken.getAttribute('data-forma-status')).toBe('error');
    expect(broken.__formaDispose).toBeUndefined();
    expect(broken.querySelector('p')!.textContent).toBe('Preserved content');

    // Good island: active, has dispose
    const good = document.querySelector('[data-forma-island="1"]') as any;
    expect(good.getAttribute('data-forma-status')).toBe('active');
    expect(typeof good.__formaDispose).toBe('function');

    errorSpy.mockRestore();
  });
});
