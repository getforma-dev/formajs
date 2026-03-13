import { createSignal, h, mount, createList } from '@getforma/core';

interface Todo { id: number; text: string; done: boolean; }

const [todos, setTodos] = createSignal<Todo[]>([]);
const [input, setInput] = createSignal('');
let nextId = 1;

function addTodo() {
  const text = input().trim();
  if (!text) return;
  setTodos([...todos(), { id: nextId++, text, done: false }]);
  setInput('');
}

function toggle(id: number) {
  setTodos(todos().map(t => t.id === id ? { ...t, done: !t.done } : t));
}

mount(() =>
  h('div', { style: 'font-family: system-ui; padding: 2rem; max-width: 400px;' },
    h('h1', null, 'FormaJS Todo'),
    h('form', { onSubmit: (e: Event) => { e.preventDefault(); addTodo(); } },
      h('input', {
        value: input,
        onInput: (e: Event) => setInput((e.target as HTMLInputElement).value),
        placeholder: 'Add a todo...',
        style: 'padding: 8px; width: 240px;',
      }),
      h('button', { type: 'submit', style: 'margin-left: 8px; padding: 8px 16px;' }, 'Add'),
    ),
    h('ul', { style: 'list-style: none; padding: 0; margin-top: 16px;' },
      createList(
        todos,
        (t) => t.id,
        (t) => h('li', {
          style: `padding: 8px; cursor: pointer; ${t.done ? 'text-decoration: line-through; opacity: 0.5;' : ''}`,
          onClick: () => toggle(t.id),
        }, t.text),
        { updateOnItemChange: 'rerender' },
      ),
    ),
    h('p', { style: 'color: #888; font-size: 14px;' },
      () => `${todos().filter(t => !t.done).length} remaining`
    ),
  ),
  '#app'
);
