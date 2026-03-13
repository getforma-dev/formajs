import { createSignal, h, mount, createList } from 'formajs';

// Generate 50K rows of mock data
const rows = Array.from({ length: 50_000 }, (_, i) => ({
  id: i + 1,
  name: `Item ${i + 1}`,
  value: Math.round(Math.random() * 10000) / 100,
}));

const [data] = createSignal(rows);

mount(() =>
  h('div', { style: 'font-family: system-ui; padding: 2rem;' },
    h('h1', null, 'FormaJS Data Table — 50K Rows'),
    h('p', null, () => `${data().length} rows`),
    h('div', { style: 'height: 600px; overflow: auto;' },
      h('table', { style: 'width: 100%; border-collapse: collapse;' },
        h('thead', null,
          h('tr', null,
            h('th', { style: 'padding: 8px; text-align: left; border-bottom: 2px solid #333;' }, 'ID'),
            h('th', { style: 'padding: 8px; text-align: left; border-bottom: 2px solid #333;' }, 'Name'),
            h('th', { style: 'padding: 8px; text-align: right; border-bottom: 2px solid #333;' }, 'Value'),
          ),
        ),
        h('tbody', null,
          createList(
            data,
            (r) => r.id,
            (r) => h('tr', null,
              h('td', { style: 'padding: 8px;' }, String(r.id)),
              h('td', { style: 'padding: 8px;' }, r.name),
              h('td', { style: 'padding: 8px; text-align: right;' }, r.value.toFixed(2)),
            ),
          ),
        ),
      ),
    ),
  ),
  '#app'
);
