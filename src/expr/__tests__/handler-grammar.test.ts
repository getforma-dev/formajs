/**
 * The `data-on:*` statement grammar, over real host values.
 *
 * Two shapes here were missing from the engine this replaces, and their absence
 * is why three rows of the README's directive table were documented as broken:
 *
 *   P2 — a statement that is only a method call (`$el.classList.toggle('x')`,
 *        `$refs.myInput.focus()`, `$dispatch('selected', {id})`). The regex
 *        handler compiler had no branch for it except one hardcoded
 *        `$refetch('literal-id')` special case, which is the tell that the
 *        general form was missing rather than declined.
 *   P4 — assignment to a property path (`item.done = !item.done`, `obj.n += 1`,
 *        `$el.style.color = 'red'`). The assignment regex required a bare
 *        identifier target, so the runtime could two-way-bind `{item.name}` but
 *        could not write `item.name = x`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { compileHandler, isExprError, runHandler, type FormaExprError } from '../index';
import { hostFn, hostObject } from '../host';
import type { ScopeLike } from '../interp';
import { scopeOf } from './helpers';

interface Harness {
  scope: ScopeLike;
  state: Record<string, unknown>;
  el: HTMLDivElement;
  input: HTMLInputElement;
  dispatched: Array<{ name: string; detail: unknown }>;
}

const mounted: Element[] = [];

afterEach(() => {
  for (const el of mounted.splice(0)) el.remove();
});

/** A state scope plus the three element magics the runtime injects. */
function harness(state: Record<string, unknown> = {}): Harness {
  const el = document.createElement('div');
  const input = document.createElement('input');
  el.appendChild(input);
  // In the document, because `focus()` is a no-op on a detached element and a
  // test that cannot observe the effect proves nothing about the call.
  document.body.appendChild(el);
  mounted.push(el);
  const dispatched: Array<{ name: string; detail: unknown }> = [];

  const scope = scopeOf(state);
  scope.getters.$el = () => hostObject('element', el, '$el');
  scope.getters.$refs = () => hostObject('refs', new Map([['myInput', input]]), '$refs');
  scope.getters.$dispatch = () => hostFn(
    '$dispatch',
    (name: unknown, detail?: unknown) => { dispatched.push({ name: String(name), detail }); },
    2,
  );

  return { scope, state: scope.state, el, input, dispatched };
}

function run(h: Harness, src: string): void {
  runHandler(compileHandler(src), h.scope);
}

function denied(h: Harness, src: string): FormaExprError {
  try {
    run(h, src);
  } catch (e) {
    if (isExprError(e)) return e;
    throw e;
  }
  throw new Error(`expected ${src} to be denied`);
}

describe('expression statements (P2)', () => {
  it('a handler statement may be a bare method call', () => {
    const h = harness();
    run(h, "$el.classList.toggle('active')");
    expect(h.el.classList.contains('active')).toBe(true);
    run(h, "$el.classList.toggle('active')");
    expect(h.el.classList.contains('active')).toBe(false);

    run(h, "$el.setAttribute('aria-expanded', 'true')");
    expect(h.el.getAttribute('aria-expanded')).toBe('true');

    run(h, '$refs.myInput.focus()');
    expect(document.activeElement).toBe(h.input);
  });

  it('$dispatch carries an object-literal payload', () => {
    // `{$dispatch('selected', {id})}` needed BOTH the statement form and object
    // literals; shipping either alone would have left the documented line broken.
    const h = harness({ id: 7 });
    run(h, "$dispatch('selected', {id})");
    run(h, "$dispatch('picked', { id: id, label: 'x' })");
    expect(h.dispatched).toEqual([
      { name: 'selected', detail: { id: 7 } },
      { name: 'picked', detail: { id: 7, label: 'x' } },
    ]);
  });

  it('a statement sequence mixes calls, assignments and if/else', () => {
    const h = harness({ open: false, count: 0 });
    run(h, "open = true; count++; if (open) { $el.classList.add('open') } else { count = 0 }");
    expect(h.state).toEqual({ open: true, count: 1 });
    expect(h.el.classList.contains('open')).toBe(true);
  });

  it('a statement that computes nothing is rejected, not silently discarded', () => {
    // `count` or `a + b` as a statement does nothing at all and is far more
    // likely to be a typo for `count++` than intent.
    const h = harness({ count: 1 });
    for (const src of ['count', 'count + 1', "'x'"]) {
      expect(denied(h, src).code, src).toBe('FORMA_E_UNSUPPORTED');
    }
  });
});

describe('member and computed assignment (P4)', () => {
  it('writes through a property path', () => {
    const h = harness({ item: { done: false, count: 1 }, obj: { n: 1 }, k: 'a', map: { a: 0 } });
    run(h, 'item.done = !item.done');
    run(h, 'obj.n += 1');
    run(h, 'item.count++');
    run(h, 'map[k] = 9');
    expect(h.state.item).toEqual({ done: true, count: 2 });
    expect(h.state.obj).toEqual({ n: 2 });
    expect(h.state.map).toEqual({ a: 9 });
  });

  it('writes an allowlisted element property, a style and a dataset key', () => {
    const h = harness();
    run(h, "$el.style.color = 'red'");
    run(h, "$el.dataset.state = 'ready'");
    run(h, "$el.textContent = 'hi'");
    run(h, '$refs.myInput.value = "typed"');
    expect(h.el.style.color).toBe('red');
    expect(h.el.dataset.state).toBe('ready');
    expect(h.el.textContent).toBe('hi');
    expect(h.input.value).toBe('typed');
  });

  it('a write outside the element allowlist is denied', () => {
    const h = harness();
    for (const src of ["$el.innerHTML = '<img>'", "$el.outerHTML = 'x'", "$el.onclick = 'x'"]) {
      expect(denied(h, src).code, src).toBe('FORMA_E_ASSIGN_DENIED');
    }
    expect(h.el.innerHTML).toBe('<input>');
  });

  it('an unknown assignment target reports instead of silently doing nothing', () => {
    // The old compiler ran `scope.setters[name]?.(val)`, so a typo in a state
    // key was a no-op with no diagnostic — the exact failure mode this whole
    // change exists to remove.
    const h = harness({ count: 0 });
    expect(denied(h, 'coutn = 1').code).toBe('FORMA_E_ASSIGN_DENIED');
    expect(denied(h, 'coutn++').code).toBe('FORMA_E_ASSIGN_DENIED');
    expect(h.state).toEqual({ count: 0 });
  });

  it('a denied key cannot be an assignment target, in any spelling', () => {
    const h = harness({ obj: {}, k: 'constructor' });
    try {
      expect(denied(h, 'obj.__proto__.x = 1').code).toBe('FORMA_E_KEY_DENIED');
      expect(denied(h, 'obj[k] = 1').code).toBe('FORMA_E_KEY_DENIED');
      expect(denied(h, "obj['pro' + 'totype'] = 1").code).toBe('FORMA_E_KEY_DENIED');
      expect(Object.prototype).not.toHaveProperty('x');
    } finally {
      delete (Object.prototype as Record<string, unknown>).x;
    }
  });

  it('an arrow cannot be smuggled in through an assignment', () => {
    const h = harness({ fn: null, list: [] });
    expect(denied(h, 'fn = i => i').code).toBe('FORMA_E_UNSUPPORTED');
    expect(denied(h, 'list = [i => i]').code).toBe('FORMA_E_UNSUPPORTED');
    expect(h.state.fn).toBeNull();
  });
});
