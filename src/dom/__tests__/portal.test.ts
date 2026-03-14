import { describe, it, expect } from 'vitest';
import { createPortal } from '../portal';
import { createRoot } from '../../reactive/root';

describe('createPortal', () => {
  it('returns a comment placeholder', () => {
    createRoot(() => {
      const target = document.createElement('div');
      document.body.appendChild(target);

      const placeholder = createPortal(
        () => document.createTextNode('portal content'),
        target,
      );
      expect(placeholder).toBeInstanceOf(Comment);
      expect(placeholder.textContent).toBe('forma-portal');

      document.body.removeChild(target);
    });
  });

  it('renders children into the target container', () => {
    createRoot(() => {
      const target = document.createElement('div');
      document.body.appendChild(target);

      createPortal(
        () => {
          const el = document.createElement('span');
          el.textContent = 'teleported';
          return el;
        },
        target,
      );

      expect(target.querySelector('span')!.textContent).toBe('teleported');
      document.body.removeChild(target);
    });
  });

  it('accepts string selector as target', () => {
    createRoot(() => {
      const target = document.createElement('div');
      target.id = 'portal-target';
      document.body.appendChild(target);

      createPortal(
        () => document.createTextNode('hello'),
        '#portal-target',
      );

      expect(target.textContent).toBe('hello');
      document.body.removeChild(target);
    });
  });

  it('throws on invalid selector', () => {
    createRoot(() => {
      expect(() => {
        createPortal(
          () => document.createTextNode('x'),
          '#nonexistent-target-xyz',
        );
      }).toThrow('target not found');
    });
  });
});
