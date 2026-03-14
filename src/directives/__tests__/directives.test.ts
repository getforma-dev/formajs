import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDirectives, destroyDirectives } from '../index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setup(html: string) {
  document.body.innerHTML = html;
  const scopes = initDirectives();
  return scopes;
}

/** Flush reactive effects — alien-signals are synchronous so no async needed */
function flush() {
  // Effects run synchronously in alien-signals, but the browser
  // might batch DOM updates. A microtask tick is enough.
  return new Promise<void>(resolve => queueMicrotask(resolve));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FormaJS Directives', () => {
  afterEach(() => {
    destroyDirectives();
    document.body.innerHTML = '';
  });

  // -----------------------------------------------------------------------
  // 1. data-forma-state creates reactive scope
  // -----------------------------------------------------------------------
  describe('data-forma-state', () => {
    it('creates a reactive scope from state object', () => {
      const scopes = setup(`
        <div data-forma-state="{ count: 42 }">
          <p data-forma-text="count"></p>
        </div>
      `);

      expect(scopes.length).toBe(1);
      expect(scopes[0]!.signals.has('count')).toBe(true);
      expect(document.querySelector('p')!.textContent).toBe('42');
    });

    it('handles multiple state properties', () => {
      setup(`
        <div data-forma-state="{ a: 1, b: 'hello', c: true }">
          <span id="a" data-forma-text="a"></span>
          <span id="b" data-forma-text="b"></span>
          <span id="c" data-forma-text="c"></span>
        </div>
      `);

      expect(document.getElementById('a')!.textContent).toBe('1');
      expect(document.getElementById('b')!.textContent).toBe('hello');
      expect(document.getElementById('c')!.textContent).toBe('true');
    });
  });

  // -----------------------------------------------------------------------
  // 2. data-forma-text renders and updates reactively
  // -----------------------------------------------------------------------
  describe('data-forma-text', () => {
    it('renders initial value', () => {
      setup(`
        <div data-forma-state="{ name: 'Forma' }">
          <p data-forma-text="name"></p>
        </div>
      `);

      expect(document.querySelector('p')!.textContent).toBe('Forma');
    });

    it('updates reactively when signal changes', () => {
      const scopes = setup(`
        <div data-forma-state="{ count: 0 }">
          <p data-forma-text="count"></p>
          <button data-forma-click="count++">+</button>
        </div>
      `);

      expect(document.querySelector('p')!.textContent).toBe('0');

      // Click to increment
      document.querySelector('button')!.click();
      expect(document.querySelector('p')!.textContent).toBe('1');
    });

    it('handles expressions, not just variable names', () => {
      setup(`
        <div data-forma-state="{ count: 5 }">
          <p data-forma-text="'Count: ' + count"></p>
        </div>
      `);

      expect(document.querySelector('p')!.textContent).toBe('Count: 5');
    });

    it('handles null/undefined gracefully', () => {
      setup(`
        <div data-forma-state="{ val: null }">
          <p data-forma-text="val"></p>
        </div>
      `);

      expect(document.querySelector('p')!.textContent).toBe('');
    });
  });

  // -----------------------------------------------------------------------
  // 3. data-forma-click handles click events
  // -----------------------------------------------------------------------
  describe('data-forma-click', () => {
    it('increments counter on click', () => {
      setup(`
        <div data-forma-state="{ count: 0 }">
          <p data-forma-text="count"></p>
          <button data-forma-click="count++">+</button>
        </div>
      `);

      const btn = document.querySelector('button')!;
      const p = document.querySelector('p')!;

      btn.click();
      expect(p.textContent).toBe('1');

      btn.click();
      btn.click();
      expect(p.textContent).toBe('3');
    });

    it('supports assignment expressions', () => {
      setup(`
        <div data-forma-state="{ count: 10 }">
          <p data-forma-text="count"></p>
          <button data-forma-click="count = 0">Reset</button>
        </div>
      `);

      const btn = document.querySelector('button')!;
      const p = document.querySelector('p')!;

      expect(p.textContent).toBe('10');
      btn.click();
      expect(p.textContent).toBe('0');
    });

    it('supports complex expressions', () => {
      setup(`
        <div data-forma-state="{ count: 0 }">
          <p data-forma-text="count"></p>
          <button data-forma-click="count = count + 5">+5</button>
        </div>
      `);

      document.querySelector('button')!.click();
      expect(document.querySelector('p')!.textContent).toBe('5');
    });
  });

  // -----------------------------------------------------------------------
  // 4. data-forma-show toggles display
  // -----------------------------------------------------------------------
  describe('data-forma-show', () => {
    it('shows element when condition is true', () => {
      setup(`
        <div data-forma-state="{ visible: true }">
          <p data-forma-show="visible">I am visible</p>
        </div>
      `);

      expect((document.querySelector('p') as HTMLElement).style.display).not.toBe('none');
    });

    it('hides element when condition is false', () => {
      setup(`
        <div data-forma-state="{ visible: false }">
          <p data-forma-show="visible">I am hidden</p>
        </div>
      `);

      expect((document.querySelector('p') as HTMLElement).style.display).toBe('none');
    });

    it('toggles reactively', () => {
      setup(`
        <div data-forma-state="{ visible: true }">
          <p data-forma-show="visible">Toggle me</p>
          <button data-forma-click="visible = !visible">Toggle</button>
        </div>
      `);

      const p = document.querySelector('p') as HTMLElement;
      const btn = document.querySelector('button')!;

      expect(p.style.display).not.toBe('none');
      btn.click();
      expect(p.style.display).toBe('none');
      btn.click();
      expect(p.style.display).not.toBe('none');
    });

    it('supports expressions', () => {
      setup(`
        <div data-forma-state="{ count: 3 }">
          <p data-forma-show="count > 0">Positive</p>
          <button data-forma-click="count = 0">Zero</button>
        </div>
      `);

      const p = document.querySelector('p') as HTMLElement;
      expect(p.style.display).not.toBe('none');

      document.querySelector('button')!.click();
      expect(p.style.display).toBe('none');
    });
  });

  // -----------------------------------------------------------------------
  // 5. data-forma-hide (inverse of show)
  // -----------------------------------------------------------------------
  describe('data-forma-hide', () => {
    it('hides element when condition is true', () => {
      setup(`
        <div data-forma-state="{ hidden: true }">
          <p data-forma-hide="hidden">I should be hidden</p>
        </div>
      `);

      expect((document.querySelector('p') as HTMLElement).style.display).toBe('none');
    });

    it('shows element when condition is false', () => {
      setup(`
        <div data-forma-state="{ hidden: false }">
          <p data-forma-hide="hidden">I should be visible</p>
        </div>
      `);

      expect((document.querySelector('p') as HTMLElement).style.display).not.toBe('none');
    });
  });

  // -----------------------------------------------------------------------
  // 6. data-forma-model two-way binding
  // -----------------------------------------------------------------------
  describe('data-forma-model', () => {
    it('binds input value to state', () => {
      setup(`
        <div data-forma-state="{ name: 'hello' }">
          <input data-forma-model="name">
          <p data-forma-text="name"></p>
        </div>
      `);

      const input = document.querySelector('input') as HTMLInputElement;
      expect(input.value).toBe('hello');
    });

    it('updates state on input', () => {
      setup(`
        <div data-forma-state="{ name: '' }">
          <input data-forma-model="name">
          <p data-forma-text="name"></p>
        </div>
      `);

      const input = document.querySelector('input') as HTMLInputElement;
      const p = document.querySelector('p')!;

      input.value = 'world';
      input.dispatchEvent(new Event('input'));

      expect(p.textContent).toBe('world');
    });

    it('handles checkbox', () => {
      setup(`
        <div data-forma-state="{ agreed: false }">
          <input type="checkbox" data-forma-model="agreed">
          <p data-forma-text="agreed"></p>
        </div>
      `);

      const checkbox = document.querySelector('input') as HTMLInputElement;
      expect(checkbox.checked).toBe(false);

      // Simulate checking
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('input'));

      expect(document.querySelector('p')!.textContent).toBe('true');
    });

    it('updates DOM when signal changes programmatically', () => {
      const scopes = setup(`
        <div data-forma-state="{ name: '' }">
          <input data-forma-model="name">
          <button data-forma-click="name = 'programmatic'">Set</button>
        </div>
      `);

      document.querySelector('button')!.click();
      expect((document.querySelector('input') as HTMLInputElement).value).toBe('programmatic');
    });
  });

  // -----------------------------------------------------------------------
  // 7. data-forma-for repeats elements
  // -----------------------------------------------------------------------
  describe('data-forma-for', () => {
    it('renders a list of items', () => {
      setup(`
        <div data-forma-state="{ items: ['a', 'b', 'c'] }">
          <ul>
            <li data-forma-for="item in items" data-forma-text="item"></li>
          </ul>
        </div>
      `);

      const lis = document.querySelectorAll('li');
      expect(lis.length).toBe(3);
      expect(lis[0]!.textContent).toBe('a');
      expect(lis[1]!.textContent).toBe('b');
      expect(lis[2]!.textContent).toBe('c');
    });

    it('updates when array changes', () => {
      setup(`
        <div data-forma-state="{ items: ['x'] }">
          <ul>
            <li data-forma-for="item in items" data-forma-text="item"></li>
          </ul>
          <button data-forma-click="items = ['x', 'y', 'z']">Update</button>
        </div>
      `);

      expect(document.querySelectorAll('li').length).toBe(1);

      document.querySelector('button')!.click();

      const lis = document.querySelectorAll('li');
      expect(lis.length).toBe(3);
      expect(lis[0]!.textContent).toBe('x');
      expect(lis[1]!.textContent).toBe('y');
      expect(lis[2]!.textContent).toBe('z');
    });

    it('handles empty array', () => {
      setup(`
        <div data-forma-state="{ items: [] }">
          <ul>
            <li data-forma-for="item in items" data-forma-text="item"></li>
          </ul>
        </div>
      `);

      expect(document.querySelectorAll('li').length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // 8. data-forma-if conditionally renders
  // -----------------------------------------------------------------------
  describe('data-forma-if', () => {
    it('shows element when condition is true', () => {
      setup(`
        <div data-forma-state="{ show: true }">
          <p data-forma-if="show">Conditional</p>
        </div>
      `);

      expect(document.querySelector('p')).not.toBeNull();
      expect(document.querySelector('p')!.textContent).toBe('Conditional');
    });

    it('removes element when condition is false', () => {
      setup(`
        <div data-forma-state="{ show: false }">
          <p data-forma-if="show">Conditional</p>
        </div>
      `);

      expect(document.querySelector('p')).toBeNull();
    });

    it('toggles element presence reactively', () => {
      setup(`
        <div data-forma-state="{ show: true }">
          <p data-forma-if="show">Conditional</p>
          <button data-forma-click="show = !show">Toggle</button>
        </div>
      `);

      expect(document.querySelector('p')).not.toBeNull();

      document.querySelector('button')!.click();
      expect(document.querySelector('p')).toBeNull();

      document.querySelector('button')!.click();
      expect(document.querySelector('p')).not.toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // 9. data-forma-class adds/removes classes
  // -----------------------------------------------------------------------
  describe('data-forma-class', () => {
    it('adds classes when value is true', () => {
      setup(`
        <div data-forma-state="{ isActive: true }">
          <p data-forma-class="{ active: isActive }">Styled</p>
        </div>
      `);

      expect(document.querySelector('p')!.classList.contains('active')).toBe(true);
    });

    it('removes classes when value is false', () => {
      setup(`
        <div data-forma-state="{ isActive: false }">
          <p data-forma-class="{ active: isActive }">Styled</p>
        </div>
      `);

      expect(document.querySelector('p')!.classList.contains('active')).toBe(false);
    });

    it('toggles classes reactively', () => {
      setup(`
        <div data-forma-state="{ isActive: false }">
          <p data-forma-class="{ active: isActive, highlight: isActive }">Styled</p>
          <button data-forma-click="isActive = !isActive">Toggle</button>
        </div>
      `);

      const p = document.querySelector('p')!;
      expect(p.classList.contains('active')).toBe(false);

      document.querySelector('button')!.click();
      expect(p.classList.contains('active')).toBe(true);
      expect(p.classList.contains('highlight')).toBe(true);

      document.querySelector('button')!.click();
      expect(p.classList.contains('active')).toBe(false);
      expect(p.classList.contains('highlight')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 10. data-forma-attr sets attributes
  // -----------------------------------------------------------------------
  describe('data-forma-attr', () => {
    it('sets attributes from object', () => {
      setup(`
        <div data-forma-state="{ isDisabled: true }">
          <button data-forma-attr="{ disabled: isDisabled }">Click</button>
        </div>
      `);

      expect(document.querySelector('button')!.hasAttribute('disabled')).toBe(true);
    });

    it('removes attributes when value is false', () => {
      setup(`
        <div data-forma-state="{ isDisabled: false }">
          <button data-forma-attr="{ disabled: isDisabled }">Click</button>
        </div>
      `);

      expect(document.querySelector('button')!.hasAttribute('disabled')).toBe(false);
    });

    it('sets string attribute values', () => {
      setup(`
        <div data-forma-state="{ link: 'https://getforma.dev' }">
          <a data-forma-attr="{ href: link }">Link</a>
        </div>
      `);

      expect(document.querySelector('a')!.getAttribute('href')).toBe('https://getforma.dev');
    });

    it('updates attributes reactively', () => {
      setup(`
        <div data-forma-state="{ loading: false }">
          <button data-forma-attr="{ disabled: loading }">Submit</button>
          <button id="toggle" data-forma-click="loading = !loading">Toggle</button>
        </div>
      `);

      const submitBtn = document.querySelector('button:not(#toggle)')!;
      expect(submitBtn.hasAttribute('disabled')).toBe(false);

      document.getElementById('toggle')!.click();
      expect(submitBtn.hasAttribute('disabled')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 11. Nested data-forma-state scopes
  // -----------------------------------------------------------------------
  describe('nested scopes', () => {
    it('child inherits parent state', () => {
      setup(`
        <div data-forma-state="{ name: 'parent' }">
          <div data-forma-state="{ age: 25 }">
            <p id="name" data-forma-text="name"></p>
            <p id="age" data-forma-text="age"></p>
          </div>
        </div>
      `);

      expect(document.getElementById('name')!.textContent).toBe('parent');
      expect(document.getElementById('age')!.textContent).toBe('25');
    });

    it('child can override parent state', () => {
      setup(`
        <div data-forma-state="{ name: 'parent' }">
          <p id="outer" data-forma-text="name"></p>
          <div data-forma-state="{ name: 'child' }">
            <p id="inner" data-forma-text="name"></p>
          </div>
        </div>
      `);

      expect(document.getElementById('outer')!.textContent).toBe('parent');
      expect(document.getElementById('inner')!.textContent).toBe('child');
    });
  });

  // -----------------------------------------------------------------------
  // 12. Multiple data-forma-state on same page (independent scopes)
  // -----------------------------------------------------------------------
  describe('multiple scopes', () => {
    it('creates independent scopes', () => {
      const scopes = setup(`
        <div data-forma-state="{ count: 10 }">
          <p id="a" data-forma-text="count"></p>
          <button id="btn-a" data-forma-click="count++">+</button>
        </div>
        <div data-forma-state="{ count: 20 }">
          <p id="b" data-forma-text="count"></p>
          <button id="btn-b" data-forma-click="count++">+</button>
        </div>
      `);

      expect(scopes.length).toBe(2);
      expect(document.getElementById('a')!.textContent).toBe('10');
      expect(document.getElementById('b')!.textContent).toBe('20');

      // Click first scope
      document.getElementById('btn-a')!.click();
      expect(document.getElementById('a')!.textContent).toBe('11');
      expect(document.getElementById('b')!.textContent).toBe('20'); // Unchanged
    });
  });

  // -----------------------------------------------------------------------
  // 13. data-forma-input with $event
  // -----------------------------------------------------------------------
  describe('data-forma-input', () => {
    it('handles input event with $event available', () => {
      setup(`
        <div data-forma-state="{ value: '' }">
          <input data-forma-input="value = $event.target.value">
          <p data-forma-text="value"></p>
        </div>
      `);

      const input = document.querySelector('input') as HTMLInputElement;
      input.value = 'typed text';
      input.dispatchEvent(new Event('input'));

      expect(document.querySelector('p')!.textContent).toBe('typed text');
    });
  });

  // -----------------------------------------------------------------------
  // 14. data-forma-html sets innerHTML
  // -----------------------------------------------------------------------
  describe('data-forma-html', () => {
    it('sets innerHTML reactively', () => {
      setup(`
        <div data-forma-state="{ content: '<strong>Bold</strong>' }">
          <div data-forma-html="content"></div>
        </div>
      `);

      const div = document.querySelector('[data-forma-html]') as HTMLElement;
      expect(div.innerHTML).toBe('<strong>Bold</strong>');
    });
  });

  // -----------------------------------------------------------------------
  // 15. Cleanup / destroyDirectives
  // -----------------------------------------------------------------------
  describe('destroyDirectives', () => {
    it('disposes all effects and listeners', () => {
      const scopes = setup(`
        <div data-forma-state="{ count: 0 }">
          <p data-forma-text="count"></p>
          <button data-forma-click="count++">+</button>
        </div>
      `);

      const btn = document.querySelector('button')!;
      const p = document.querySelector('p')!;

      btn.click();
      expect(p.textContent).toBe('1');

      destroyDirectives();

      // After destroy, clicking should not update the text
      // (the effect is disposed, but the event listener is also removed)
      btn.click();
      expect(p.textContent).toBe('1'); // Unchanged
    });
  });

  // -----------------------------------------------------------------------
  // 16. Multiple directives on same element
  // -----------------------------------------------------------------------
  describe('multiple directives on same element', () => {
    it('combines text and show directives', () => {
      setup(`
        <div data-forma-state="{ msg: 'hello', visible: true }">
          <p data-forma-text="msg" data-forma-show="visible">placeholder</p>
          <button data-forma-click="visible = false">Hide</button>
        </div>
      `);

      const p = document.querySelector('p') as HTMLElement;
      expect(p.textContent).toBe('hello');
      expect(p.style.display).not.toBe('none');

      document.querySelector('button')!.click();
      expect(p.style.display).toBe('none');
    });

    it('combines class and attr directives', () => {
      setup(`
        <div data-forma-state="{ active: true, url: '/page' }">
          <a data-forma-class="{ active: active }" data-forma-attr="{ href: url }">Link</a>
        </div>
      `);

      const a = document.querySelector('a')!;
      expect(a.classList.contains('active')).toBe(true);
      expect(a.getAttribute('href')).toBe('/page');
    });
  });

  // -----------------------------------------------------------------------
  // 17. Expression with multiple state variables
  // -----------------------------------------------------------------------
  describe('expressions with multiple state vars', () => {
    it('evaluates expressions using multiple state properties', () => {
      setup(`
        <div data-forma-state="{ first: 'John', last: 'Doe' }">
          <p data-forma-text="first + ' ' + last"></p>
        </div>
      `);

      expect(document.querySelector('p')!.textContent).toBe('John Doe');
    });

    it('reactively updates when any used variable changes', () => {
      setup(`
        <div data-forma-state="{ a: 1, b: 2 }">
          <p data-forma-text="a + b"></p>
          <button data-forma-click="a = 10">Update A</button>
        </div>
      `);

      expect(document.querySelector('p')!.textContent).toBe('3');

      document.querySelector('button')!.click();
      expect(document.querySelector('p')!.textContent).toBe('12');
    });
  });

  // -----------------------------------------------------------------------
  // 18. Array state with for + click
  // -----------------------------------------------------------------------
  describe('data-forma-for with click interaction', () => {
    it('renders list and allows adding items', () => {
      setup(`
        <div data-forma-state="{ todos: ['Buy milk', 'Code'] }">
          <ul>
            <li data-forma-for="todo in todos" data-forma-text="todo"></li>
          </ul>
          <button data-forma-click="todos = [...todos, 'New item']">Add</button>
        </div>
      `);

      expect(document.querySelectorAll('li').length).toBe(2);

      document.querySelector('button')!.click();

      const lis = document.querySelectorAll('li');
      expect(lis.length).toBe(3);
      expect(lis[2]!.textContent).toBe('New item');
    });
  });

  // -----------------------------------------------------------------------
  // 19. initDirectives on a subtree
  // -----------------------------------------------------------------------
  describe('initDirectives with custom root', () => {
    it('initializes only within the given root element', () => {
      document.body.innerHTML = `
        <div id="section-a" data-forma-state="{ count: 1 }">
          <p data-forma-text="count"></p>
        </div>
        <div id="section-b" data-forma-state="{ count: 2 }">
          <p data-forma-text="count"></p>
        </div>
      `;

      const sectionA = document.getElementById('section-a')!;
      const scopes = initDirectives(sectionA);

      // Only section-a should be initialized
      expect(scopes.length).toBe(1);
      expect(sectionA.querySelector('p')!.textContent).toBe('1');
    });
  });
});
