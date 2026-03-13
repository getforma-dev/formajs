import { createSignal, h, mount } from 'formajs';

const [count, setCount] = createSignal(0);

mount(() =>
  h('div', { style: 'font-family: system-ui; padding: 2rem;' },
    h('h1', null, 'FormaJS Counter'),
    h('p', null, () => `Count: ${count()}`),
    h('button', { onClick: () => setCount(count() + 1) }, 'Increment'),
    h('button', { onClick: () => setCount(0), style: 'margin-left: 8px;' }, 'Reset'),
  ),
  '#app'
);
