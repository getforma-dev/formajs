/**
 * browserOnly(): a component that renders in the browser alone (DR-1, L-1;
 * FORMA-119).
 *
 * The compiler emits `const X = browserOnly(Impl)` as a registered island whose
 * server output is its empty host element with its declared props. These tests
 * give activation that host, as forma-ir writes it, and check that the
 * component renders there from those props; and that the same component still
 * renders as any component in a client-rendered tree. The full chain (compiler,
 * Rust walker, this runtime in Chromium) is forma-tools' SSR lane case
 * `browser-only`.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { activateIslands } from '../activate';
import { h } from '../element';
import { mount } from '../mount';
import { browserOnly } from '../browser-only';
import { createSignal } from '../../reactive';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function ChartImpl(props: { title?: string; points?: number }) {
  const [points, setPoints] = createSignal(props.points ?? 0);
  return h('figure', { id: 'chart' },
    h('figcaption', null, () => `${props.title ?? 'untitled'}: ${points()} points`),
    h('button', { id: 'add', onClick: () => setPoints(points() + 1) }, 'Add'),
  );
}

/** The host forma-ir renders for a browser-only island: empty, with its props. */
function serverHost(props?: object): void {
  const attr = props ? ` data-forma-props='${JSON.stringify(props)}'` : '';
  document.body.innerHTML = `<main><h1>Report</h1><div data-forma-island="0" data-forma-component="Chart" data-forma-status="pending" data-forma-hydrate="load"${attr}></div></main>`;
}

describe('browserOnly', () => {
  it('registered in activateIslands, renders the component in its empty host, from the server props', () => {
    const Chart = browserOnly(ChartImpl);
    serverHost({ title: 'Sales', points: 3 });

    activateIslands({ Chart });

    const chart = document.getElementById('chart')!;
    expect(chart).not.toBeNull();
    expect(chart.textContent).toContain('Sales: 3 points');
    // The component took the host's place, carrying the island's attributes.
    expect(chart.getAttribute('data-forma-component')).toBe('Chart');
    expect(chart.getAttribute('data-forma-status')).toBe('active');
    expect(document.querySelectorAll('[data-forma-island]')).toHaveLength(1);
    // The server-rendered page around it is untouched.
    expect(document.querySelector('h1')!.textContent).toBe('Report');

    (document.getElementById('add') as HTMLButtonElement).click();
    expect(chart.textContent).toContain('Sales: 4 points');
  });

  it('gives the component empty props when the host carries none', () => {
    const seen: unknown[] = [];
    const Chart = browserOnly((props: { title?: string }) => {
      seen.push(props);
      return h('canvas', { id: 'canvas' });
    });
    serverHost();

    activateIslands({ Chart });

    expect(seen).toEqual([{}]);
    expect(document.getElementById('canvas')).not.toBeNull();
  });

  it('called as a component, renders it as any component in a client-rendered tree', () => {
    const Chart = browserOnly(ChartImpl);
    document.body.innerHTML = '<div id="app"></div>';

    mount(() => h('main', null, h(Chart, { title: 'Sales', points: 2 })), '#app');

    expect(document.getElementById('chart')!.textContent).toContain('Sales: 2 points');
  });

  it('renders nothing where there is no document', () => {
    const impl = vi.fn(() => h('canvas', null));
    const Chart = browserOnly(impl);
    vi.stubGlobal('document', undefined);

    expect(Chart({})).toBeNull();
    expect(impl).not.toHaveBeenCalled();
  });
});
