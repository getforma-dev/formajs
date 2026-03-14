import { describe, it, expect } from 'vitest';
import { createText } from '../text';
import { createSignal } from '../../reactive/signal';
import { createRoot } from '../../reactive/root';

describe('createText', () => {
  it('creates static text node from string', () => {
    const node = createText('hello');
    expect(node).toBeInstanceOf(Text);
    expect(node.data).toBe('hello');
  });

  it('creates reactive text node from signal', () => {
    createRoot(() => {
      const [name, setName] = createSignal('Alice');
      const node = createText(name);
      expect(node.data).toBe('Alice');

      setName('Bob');
      expect(node.data).toBe('Bob');
    });
  });

  it('reactive text updates on every signal change', () => {
    createRoot(() => {
      const [count, setCount] = createSignal(0);
      const node = createText(() => `Count: ${count()}`);
      expect(node.data).toBe('Count: 0');

      setCount(1);
      expect(node.data).toBe('Count: 1');

      setCount(99);
      expect(node.data).toBe('Count: 99');
    });
  });
});
