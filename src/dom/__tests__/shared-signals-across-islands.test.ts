/**
 * Shared signals across islands — proves the store pattern works with activateIslands().
 *
 * With mount(), everything is one createRoot scope. With activateIslands(), each island
 * gets its own createRoot. This test verifies that signals created at module level (the
 * store pattern) work reactively across island boundaries.
 *
 * If this fails, the benchmark page rebuild (FilterBar + DataTable + PerfPanel sharing
 * sortCol, rows, etc.) will not work.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSignal } from 'forma/reactive';
import { activateIslands } from '../activate';
import { h } from '../element';
import { createShow } from '../show';
import { createList } from '../list';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('shared signals across islands', () => {
  it('signal change in island A causes reactive update in island B', () => {
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="Counter" data-forma-status="pending">
        <span><!--f:t0-->0<!--/f:t0--></span>
        <button>+</button>
      </div>
      <div data-forma-island="1" data-forma-component="Display" data-forma-status="pending">
        <span><!--f:t0-->0<!--/f:t0--></span>
      </div>
    `;

    // Shared signal — the store pattern
    const [count, setCount] = createSignal(0);

    activateIslands({
      Counter: () => {
        return h('div', null,
          h('span', null, () => String(count())),
          h('button', { onClick: () => setCount(count() + 1) }, '+'),
        );
      },
      Display: () => {
        return h('div', null,
          h('span', null, () => String(count())),
        );
      },
    });

    // Both islands active
    expect(document.querySelector('[data-forma-island="0"]')!
      .getAttribute('data-forma-status')).toBe('active');
    expect(document.querySelector('[data-forma-island="1"]')!
      .getAttribute('data-forma-status')).toBe('active');

    // Initial state: both show 0
    expect(document.querySelector('[data-forma-island="0"] span')!.textContent).toBe('0');
    expect(document.querySelector('[data-forma-island="1"] span')!.textContent).toBe('0');

    // Click increment in island 0
    document.querySelector('[data-forma-island="0"] button')!
      .dispatchEvent(new Event('click'));

    // Both islands reactively update
    expect(document.querySelector('[data-forma-island="0"] span')!.textContent).toBe('1');
    expect(document.querySelector('[data-forma-island="1"] span')!.textContent).toBe('1');

    // Update via setter directly — both islands still track
    setCount(42);
    expect(document.querySelector('[data-forma-island="0"] span')!.textContent).toBe('42');
    expect(document.querySelector('[data-forma-island="1"] span')!.textContent).toBe('42');
  });

  it('shared store with multiple signals across three islands', () => {
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="FilterBar" data-forma-status="pending">
        <select><option>id</option></select>
        <span><!--f:t0-->1000<!--/f:t0--></span>
      </div>
      <div data-forma-island="1" data-forma-component="DataTable" data-forma-status="pending">
        <table><thead><tr><th><!--f:t0-->id<!--/f:t0--></th></tr></thead></table>
      </div>
      <div data-forma-island="2" data-forma-component="PerfPanel" data-forma-status="pending">
        <span><!--f:t0-->1000<!--/f:t0--></span>
      </div>
    `;

    // Shared store — multiple signals
    const [sortCol, setSortCol] = createSignal('id');
    const [rowCount, setRowCount] = createSignal(1000);

    activateIslands({
      FilterBar: () => {
        return h('div', null,
          h('select', { onChange: (e: Event) => setSortCol((e.target as HTMLSelectElement).value) },
            h('option', null, 'id'),
          ),
          h('span', null, () => String(rowCount())),
        );
      },
      DataTable: () => {
        return h('div', null,
          h('table', null,
            h('thead', null,
              h('tr', null,
                h('th', null, () => sortCol()),
              ),
            ),
          ),
        );
      },
      PerfPanel: () => {
        return h('div', null,
          h('span', null, () => String(rowCount())),
        );
      },
    });

    // All three active
    expect(document.querySelectorAll('[data-forma-status="active"]').length).toBe(3);

    // Change sortCol from FilterBar's perspective — DataTable updates
    setSortCol('name');
    expect(document.querySelector('[data-forma-island="1"] th')!.textContent).toBe('name');

    // Change rowCount — FilterBar and PerfPanel both update
    setRowCount(5000);
    expect(document.querySelector('[data-forma-island="0"] span')!.textContent).toBe('5000');
    expect(document.querySelector('[data-forma-island="2"] span')!.textContent).toBe('5000');
  });

  it('shared signal with createShow across islands', () => {
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="Toggle" data-forma-status="pending">
        <button>toggle</button>
      </div>
      <div data-forma-island="1" data-forma-component="Panel" data-forma-status="pending">
        <!--f:s0--><p>visible</p><!--/f:s0-->
      </div>
    `;

    const [visible, setVisible] = createSignal(true);

    activateIslands({
      Toggle: () => {
        return h('div', null,
          h('button', { onClick: () => setVisible(!visible()) }, 'toggle'),
        );
      },
      Panel: () => {
        return h('div', null,
          createShow(visible, () => h('p', null, 'visible')),
        );
      },
    });

    expect(document.querySelectorAll('[data-forma-status="active"]').length).toBe(2);

    // Initial: panel shows content
    expect(document.querySelector('[data-forma-island="1"] p')).toBeTruthy();

    // Click toggle in island 0 — panel in island 1 hides
    document.querySelector('[data-forma-island="0"] button')!
      .dispatchEvent(new Event('click'));
    expect(document.querySelector('[data-forma-island="1"] p')).toBeNull();

    // Click toggle again — panel shows
    document.querySelector('[data-forma-island="0"] button')!
      .dispatchEvent(new Event('click'));
    expect(document.querySelector('[data-forma-island="1"] p')).toBeTruthy();
  });

  it('shared signal with createList across islands', () => {
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="AddItem" data-forma-status="pending">
        <button>add</button>
      </div>
      <div data-forma-island="1" data-forma-component="ItemList" data-forma-status="pending">
        <!--f:l0-->
        <div data-forma-key="1">Item 1</div>
        <div data-forma-key="2">Item 2</div>
        <!--/f:l0-->
      </div>
    `;

    const [items, setItems] = createSignal([
      { id: '1', text: 'Item 1' },
      { id: '2', text: 'Item 2' },
    ]);

    activateIslands({
      AddItem: () => {
        return h('div', null,
          h('button', {
            onClick: () => setItems([...items(), { id: String(items().length + 1), text: `Item ${items().length + 1}` }]),
          }, 'add'),
        );
      },
      ItemList: () => {
        return h('div', null,
          createList(
            items,
            (i: { id: string }) => i.id,
            (item: { id: string; text: string }) =>
              h('div', { 'data-forma-key': item.id }, item.text),
          ),
        );
      },
    });

    expect(document.querySelectorAll('[data-forma-status="active"]').length).toBe(2);

    // Initial: 2 items
    expect(document.querySelectorAll('[data-forma-island="1"] div[data-forma-key]').length).toBe(2);

    // Click add in island 0 — list in island 1 grows
    document.querySelector('[data-forma-island="0"] button')!
      .dispatchEvent(new Event('click'));
    expect(document.querySelectorAll('[data-forma-island="1"] div[data-forma-key]').length).toBe(3);

    // Add another
    document.querySelector('[data-forma-island="0"] button')!
      .dispatchEvent(new Event('click'));
    expect(document.querySelectorAll('[data-forma-island="1"] div[data-forma-key]').length).toBe(4);
  });

  it('dispose of one island does not break shared signal in sibling', () => {
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="Writer" data-forma-status="pending">
        <span><!--f:t0-->0<!--/f:t0--></span>
      </div>
      <div data-forma-island="1" data-forma-component="Reader" data-forma-status="pending">
        <span><!--f:t0-->0<!--/f:t0--></span>
      </div>
    `;

    const [count, setCount] = createSignal(0);

    activateIslands({
      Writer: () => {
        return h('div', null,
          h('span', null, () => String(count())),
        );
      },
      Reader: () => {
        return h('div', null,
          h('span', null, () => String(count())),
        );
      },
    });

    // Both track
    setCount(10);
    expect(document.querySelector('[data-forma-island="0"] span')!.textContent).toBe('10');
    expect(document.querySelector('[data-forma-island="1"] span')!.textContent).toBe('10');

    // Dispose island 0
    const writer = document.querySelector('[data-forma-island="0"]') as any;
    writer.__formaDispose();

    // Update signal — island 1 still reactive
    setCount(20);
    expect(document.querySelector('[data-forma-island="1"] span')!.textContent).toBe('20');
  });
});
