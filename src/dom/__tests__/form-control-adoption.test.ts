/**
 * Form controls at adoption (FORMA-003, decision brief DR-5 and DR-7 (b), (c)).
 *
 * The first write of an adopted control's binding must not destroy what the
 * user entered between first paint and activation, and must write nothing when
 * the server already rendered the client's value. Later updates still go
 * through the live-property writer (the checkpoint fix 042e353).
 *
 * `textarea` and `title` are RCDATA elements: a hydration marker the server
 * writes inside one is text, not a comment. Servers on forma-ir 0.2.1 or later
 * (FORMA-002) write none; older ones do. happy-dom parses markers inside these
 * elements as comments, unlike a browser, so the older output is reproduced
 * here the way a browser parses it: one text node holding the marker text.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createRoot, createSignal } from 'forma/reactive';
import { h } from '../element';
import { mount } from '../mount';

afterEach(() => {
  document.body.innerHTML = '';
});

/** Put server HTML into a `data-forma-ssr` container and return it. */
function serve(html: string): HTMLElement {
  document.body.innerHTML = `<div id="app" data-forma-ssr>${html}</div>`;
  return document.getElementById('app')!;
}

/** What a browser parses from `<textarea><!--f:t0-->x<!--/f:t0--></textarea>`: the markers are text. */
const legacy = (text: string) => `<!--f:t0-->${text}<!--/f:t0-->`;

/** Record every DOM mutation under `root` from now on. */
function recordMutations(root: Node): () => MutationRecord[] {
  const records: MutationRecord[] = [];
  const observer = new MutationObserver((batch) => records.push(...batch));
  observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
  return () => {
    records.push(...observer.takeRecords());
    observer.disconnect();
    return records;
  };
}

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

describe('adoption keeps what the user entered before activation', () => {
  it('keeps text typed into an input before activation, then follows later updates', () => {
    const app = serve('<form><input id="t" name="t" value="Saved"><input id="s" value="Static"></form>');
    byId<HTMLInputElement>('t').value = 'Typed';
    byId<HTMLInputElement>('s').value = 'Typed too';
    const [value, setValue] = createSignal('Saved');

    mount(() => h('form', null,
      h('input', { id: 't', name: 't', value: () => value() }),
      h('input', { id: 's', value: 'Static' }),
    ), app);

    const input = byId<HTMLInputElement>('t');
    expect(input.value).toBe('Typed');
    expect(byId<HTMLInputElement>('s').value).toBe('Typed too');
    expect(new FormData(app.querySelector('form')!).get('t')).toBe('Typed');
    // After activation the binding is live again: updates are written.
    setValue('Reset');
    expect(input.value).toBe('Reset');
    setValue('Again');
    expect(input.value).toBe('Again');
    input.value = 'Typed later';
    setValue('Saved');
    expect(input.value).toBe('Saved');
  });

  it('keeps a checkbox and a radio choice the user changed before activation', () => {
    const app = serve(
      '<div><input type="checkbox" id="c" checked>' +
      '<input type="radio" name="r" value="x" id="rx" checked><input type="radio" name="r" value="y" id="ry"></div>',
    );
    byId<HTMLInputElement>('c').checked = false;
    byId<HTMLInputElement>('ry').checked = true;
    byId<HTMLInputElement>('rx').checked = false;
    const [agree, setAgree] = createSignal(true);
    const [choice, setChoice] = createSignal('x');

    mount(() => h('div', null,
      h('input', { type: 'checkbox', id: 'c', checked: () => agree() }),
      h('input', { type: 'radio', name: 'r', value: 'x', id: 'rx', checked: () => choice() === 'x' }),
      h('input', { type: 'radio', name: 'r', value: 'y', id: 'ry', checked: () => choice() === 'y' }),
    ), app);

    const checks = () => ['c', 'rx', 'ry'].map((id) => byId<HTMLInputElement>(id).checked);
    expect(checks()).toEqual([false, false, true]);
    setAgree(false);
    setAgree(true);
    expect(checks()).toEqual([true, false, true]);
    setChoice('y');
    setChoice('x');
    expect(checks()).toEqual([true, true, false]);
  });

  it('keeps a select option the user picked before activation, with or without selected in the server HTML', () => {
    for (const html of [
      // forma-ir 0.2.1 (FORMA-002): `selected` on the matching option.
      '<select id="s" name="s"><option value="a">A</option><option value="b" selected>B</option><option value="c">C</option></select>',
      // Older servers: a `value` attribute on the select, which selects nothing.
      '<select id="s" name="s" value="b"><option value="a">A</option><option value="b">B</option><option value="c">C</option></select>',
    ]) {
      const app = serve(`<form>${html}</form>`);
      byId<HTMLSelectElement>('s').value = 'c';
      const [choice, setChoice] = createSignal('b');

      const unmount = mount(() => h('form', null,
        h('select', { id: 's', name: 's', value: () => choice() },
          h('option', { value: 'a' }, 'A'), h('option', { value: 'b' }, 'B'), h('option', { value: 'c' }, 'C')),
      ), app);

      const select = byId<HTMLSelectElement>('s');
      expect(select.value).toBe('c');
      expect(new FormData(app.querySelector('form')!).get('s')).toBe('c');
      setChoice('a');
      expect(select.value).toBe('a');
      setChoice('b');
      expect(select.value).toBe('b');
      unmount();
    }
  });

  it('selects the bound option of an untouched select from an older server', () => {
    const app = serve('<form><select id="s" name="s" value="b"><option value="a">A</option><option value="b">B</option></select></form>');
    // An older server's HTML selects the first option: the bug FORMA-002 fixes on the server.
    expect(byId<HTMLSelectElement>('s').value).toBe('a');

    mount(() => h('form', null,
      h('select', { id: 's', name: 's', value: () => 'b' },
        h('option', { value: 'a' }, 'A'), h('option', { value: 'b' }, 'B')),
    ), app);

    expect(byId<HTMLSelectElement>('s').value).toBe('b');
    expect(new FormData(app.querySelector('form')!).get('s')).toBe('b');
  });

  it("keeps a multiple select's edited selection and an option's selected binding", () => {
    const app = serve(
      '<div><select id="m" multiple><option value="a" selected>A</option><option value="b">B</option><option value="c" selected>C</option></select>' +
      '<select id="o"><option value="x" id="ox" selected>X</option><option value="y" id="oy">Y</option></select></div>',
    );
    const multi = byId<HTMLSelectElement>('m');
    multi.options[1]!.selected = true;
    multi.options[2]!.selected = false;
    byId<HTMLSelectElement>('o').value = 'y';
    const [values, setValues] = createSignal(['a', 'c']);
    const [pick, setPick] = createSignal('x');

    mount(() => h('div', null,
      h('select', { id: 'm', multiple: true, value: () => values() },
        h('option', { value: 'a' }, 'A'), h('option', { value: 'b' }, 'B'), h('option', { value: 'c' }, 'C')),
      h('select', { id: 'o' },
        h('option', { value: 'x', id: 'ox', selected: () => pick() === 'x' }, 'X'),
        h('option', { value: 'y', id: 'oy', selected: () => pick() === 'y' }, 'Y')),
    ), app);

    const chosen = () => Array.from(multi.options).filter((o) => o.selected).map((o) => o.value);
    expect(chosen()).toEqual(['a', 'b']);
    expect(byId<HTMLSelectElement>('o').value).toBe('y');
    setValues(['c']);
    expect(chosen()).toEqual(['c']);
    setPick('y');
    setPick('x');
    expect(byId<HTMLSelectElement>('o').value).toBe('x');
  });

  it("keeps text typed into a textarea's value form before activation, from either server output", () => {
    for (const html of ['<textarea id="n" value="Saved"></textarea>', '<textarea id="n">Saved</textarea>']) {
      const app = serve(html);
      byId<HTMLTextAreaElement>('n').value = 'Typed';
      const [notes, setNotes] = createSignal('Saved');

      const unmount = mount(() => h('textarea', { id: 'n', value: () => notes() }), app);

      const textarea = byId<HTMLTextAreaElement>('n');
      expect(textarea.value).toBe('Typed');
      setNotes('Cleared');
      expect(textarea.value).toBe('Cleared');
      setNotes('Saved');
      expect(textarea.value).toBe('Saved');
      unmount();
    }
  });
});

describe('adoption writes nothing the server already rendered', () => {
  it('adoption writes nothing when the server and the client agree', async () => {
    const app = serve(
      '<form>' +
      '<input id="t" value="Saved"><input type="checkbox" id="c" checked>' +
      '<select id="s"><option value="a">A</option><option value="b" selected>B</option></select>' +
      '<textarea id="v">Saved notes</textarea><textarea id="ta">hello</textarea>' +
      '<div><title id="tt">Page</title></div>' +
      '</form>',
    );
    const done = recordMutations(app);
    const [value, setValue] = createSignal('Saved');

    mount(() => h('form', null,
      h('input', { id: 't', value: () => value() }),
      h('input', { type: 'checkbox', id: 'c', checked: () => true }),
      h('select', { id: 's', value: () => 'b' }, h('option', { value: 'a' }, 'A'), h('option', { value: 'b' }, 'B')),
      h('textarea', { id: 'v', value: () => 'Saved notes' }),
      h('textarea', { id: 'ta' }, () => 'hello'),
      h('div', null, h('title', { id: 'tt' }, () => 'Page')),
    ), app);
    await Promise.resolve();

    // Only the container's own data-forma-ssr removal.
    const records = done();
    expect(records.map((r) => `${r.type}:${(r.target as Element).id}:${r.attributeName ?? ''}`)).toEqual(['attributes:app:data-forma-ssr']);
    expect(byId<HTMLInputElement>('t').value).toBe('Saved');
    expect(byId<HTMLSelectElement>('s').value).toBe('b');
    expect(byId<HTMLTextAreaElement>('ta').value).toBe('hello');

    // The observer sees binding writes: a later update is one.
    const again = recordMutations(app);
    setValue('Changed');
    await Promise.resolve();
    expect(again().some((r) => r.type === 'attributes' && (r.target as Element).id === 't')).toBe(true);
  });

  it('repairs an untouched control the server rendered with another value', () => {
    const app = serve('<div><input id="t" value="Old"><input type="checkbox" id="c"><textarea id="ta">old</textarea><div><title id="tt">Old</title></div></div>');

    mount(() => h('div', null,
      h('input', { id: 't', value: () => 'New' }),
      h('input', { type: 'checkbox', id: 'c', checked: () => true }),
      h('textarea', { id: 'ta' }, () => 'new'),
      h('div', null, h('title', { id: 'tt' }, () => 'New')),
    ), app);

    expect(byId<HTMLInputElement>('t').value).toBe('New');
    expect(byId<HTMLInputElement>('t').getAttribute('value')).toBe('New');
    expect(byId<HTMLInputElement>('c').checked).toBe(true);
    expect(byId<HTMLTextAreaElement>('ta').value).toBe('new');
    expect(byId('tt').textContent).toBe('New');
  });
});

describe('textarea and title text is bound by the element', () => {
  it('binds a marker-free textarea by the element and writes nothing when it agrees', async () => {
    const app = serve('<form><textarea id="ta" name="ta">hello</textarea></form>');
    const done = recordMutations(app.querySelector('form')!);
    const [text, setText] = createSignal('hello');

    mount(() => h('form', null, h('textarea', { id: 'ta', name: 'ta' }, () => text())), app);
    await Promise.resolve();

    const textarea = byId<HTMLTextAreaElement>('ta');
    expect(done()).toEqual([]);
    expect(textarea.value).toBe('hello');
    setText('updated');
    expect(textarea.value).toBe('updated');
    expect(new FormData(app.querySelector('form')!).get('ta')).toBe('updated');
    textarea.value = 'typed';
    setText('reset');
    expect(textarea.value).toBe('typed');
    expect(textarea.defaultValue).toBe('reset');
  });

  it('accepts a textarea with marker text from an older server and removes the markers', () => {
    const app = serve('<form><textarea id="ta" name="ta"></textarea></form>');
    const textarea = byId<HTMLTextAreaElement>('ta');
    textarea.textContent = legacy('hello');
    // The defect FORMA-002 fixes on the server: the marker text is the value.
    expect(textarea.value).toBe(legacy('hello'));
    const [text, setText] = createSignal('hello');

    mount(() => h('form', null, h('textarea', { id: 'ta', name: 'ta' }, () => text())), app);

    expect(textarea.value).toBe('hello');
    expect(textarea.defaultValue).toBe('hello');
    expect(new FormData(app.querySelector('form')!).get('ta')).toBe('hello');
    setText('updated');
    expect(textarea.value).toBe('updated');
    setText('hello');
    expect(textarea.value).toBe('hello');
  });

  it('keeps text typed into a marker-carrying textarea before activation', () => {
    const app = serve('<textarea id="ta"></textarea>');
    const textarea = byId<HTMLTextAreaElement>('ta');
    textarea.textContent = legacy('hello');
    textarea.value = 'typed';
    const [text, setText] = createSignal('hello');

    mount(() => h('textarea', { id: 'ta' }, () => text()), app);

    expect(textarea.value).toBe('typed');
    // The default (what a form reset restores) no longer carries marker text.
    expect(textarea.defaultValue).toBe('hello');
    setText('updated');
    expect(textarea.value).toBe('typed');
    expect(textarea.defaultValue).toBe('updated');
  });

  it('keeps server text that only looks like marker text, edited or not, without a write', async () => {
    // A marker-free server whose text documents Forma's own markers.
    const literal = 'Docs say <!--f:t0--> is a marker';
    const app = serve('<div><textarea id="edited"></textarea><textarea id="untouched"></textarea></div>');
    const edited = byId<HTMLTextAreaElement>('edited');
    const untouched = byId<HTMLTextAreaElement>('untouched');
    edited.textContent = literal;
    untouched.textContent = literal;
    edited.value = 'typed';
    const done = recordMutations(app.firstElementChild!);

    mount(() => h('div', null,
      h('textarea', { id: 'edited' }, () => literal),
      h('textarea', { id: 'untouched' }, () => literal),
    ), app);
    await Promise.resolve();

    expect(done()).toEqual([]);
    expect(edited.value).toBe('typed');
    expect(edited.defaultValue).toBe(literal);
    expect(untouched.value).toBe(literal);
  });

  it("cleans an older server's markers around a literal marker exactly, and leaves a disagreeing edited default alone", () => {
    const literal = 'Docs say <!--f:t0--> is a marker';
    const app = serve('<div><textarea id="legacy"></textarea><textarea id="disagree"></textarea></div>');
    const legacyArea = byId<HTMLTextAreaElement>('legacy');
    const disagree = byId<HTMLTextAreaElement>('disagree');
    // An older server escapes the user's `<!--`, which parses to the same text as a marker.
    legacyArea.textContent = legacy(literal);
    disagree.textContent = 'Server text';
    legacyArea.value = 'typed';
    disagree.value = 'typed too';

    mount(() => h('div', null,
      h('textarea', { id: 'legacy' }, () => literal),
      h('textarea', { id: 'disagree' }, () => 'Client text'),
    ), app);

    expect(legacyArea.value).toBe('typed');
    expect(legacyArea.defaultValue).toBe(literal);
    expect(disagree.value).toBe('typed too');
    expect(disagree.defaultValue).toBe('Server text');
  });

  it('adopts an empty value from an older server, written as a zero-width space between markers, as empty', () => {
    const app = serve('<textarea id="ta"></textarea>');
    const textarea = byId<HTMLTextAreaElement>('ta');
    textarea.textContent = legacy('\u200B');
    textarea.value = 'typed';
    const [text, setText] = createSignal('');

    mount(() => h('textarea', { id: 'ta' }, () => text()), app);

    expect(textarea.value).toBe('typed');
    expect(textarea.defaultValue).toBe('');
    setText('later');
    expect(textarea.defaultValue).toBe('later');
    setText('');
    expect(textarea.defaultValue).toBe('');
  });

  it('binds a textarea with static and reactive text, from either server output', () => {
    for (const serverText of ['Note: v', `Note: ${legacy('v')}`]) {
      const app = serve('<textarea id="ta"></textarea>');
      byId<HTMLTextAreaElement>('ta').textContent = serverText;
      const [x, setX] = createSignal('v');

      const unmount = mount(() => h('textarea', { id: 'ta' }, 'Note: ', () => x()), app);

      const textarea = byId<HTMLTextAreaElement>('ta');
      expect(textarea.value).toBe('Note: v');
      expect(textarea.childNodes).toHaveLength(1);
      setX('w');
      expect(textarea.value).toBe('Note: w');
      setX('v');
      expect(textarea.value).toBe('Note: v');
      unmount();
    }
  });

  it("binds a title's reactive text by the element, with or without marker text", () => {
    for (const serverText of ['Docs: Page', `Docs: ${legacy('Page')}`]) {
      const app = serve('<div><title id="tt"></title></div>');
      byId('tt').textContent = serverText;
      const [title, setTitle] = createSignal('Page');

      const unmount = mount(() => h('div', null, h('title', { id: 'tt' }, 'Docs: ', () => title())), app);

      const el = byId('tt');
      expect(el.textContent).toBe('Docs: Page');
      setTitle('Next');
      expect(el.textContent).toBe('Docs: Next');
      setTitle('Page');
      expect(el.textContent).toBe('Docs: Page');
      expect(el.childNodes).toHaveLength(1);
      unmount();
    }
  });

  it("after the user types, a textarea's reactive text changes only its default, client-rendered and adopted alike", () => {
    // Client-rendered (Phase 1)
    createRoot((dispose) => {
      const [text, setText] = createSignal('Hello Ann');
      const textarea = h('textarea', null, () => text()) as HTMLTextAreaElement;
      expect(textarea.value).toBe('Hello Ann');
      textarea.value = 'Hello Ann, my long message';
      setText('Hello Bob');
      expect(textarea.value).toBe('Hello Ann, my long message');
      expect(textarea.defaultValue).toBe('Hello Bob');
      setText('Hello Cy');
      expect(textarea.defaultValue).toBe('Hello Cy');
      dispose();
    });

    // Server-rendered and adopted (Phase 2)
    const app = serve('<textarea id="ta">Hello Ann</textarea>');
    const [text, setText] = createSignal('Hello Ann');
    mount(() => h('textarea', { id: 'ta' }, () => text()), app);
    const textarea = byId<HTMLTextAreaElement>('ta');
    setText('Hello Bo');
    // Untouched, the value follows its default.
    expect(textarea.value).toBe('Hello Bo');
    textarea.value = 'Hello Bo, my long message';
    setText('Hello Bob');
    expect(textarea.value).toBe('Hello Bo, my long message');
    expect(textarea.defaultValue).toBe('Hello Bob');
  });
});

describe('option values', () => {
  it('an option bound to undefined or null submits its text, client-rendered and adopted', () => {
    // Client-rendered
    createRoot((dispose) => {
      const [beta, setBeta] = createSignal<string | null>(null);
      const form = h('form', null,
        h('select', { name: 'c' },
          h('option', { value: undefined }, 'Alpha'),
          h('option', { value: () => beta() }, 'Beta')),
      ) as HTMLFormElement;
      const select = form.querySelector('select')!;
      expect([...new FormData(form)]).toEqual([['c', 'Alpha']]);
      expect(select.options[0]!.hasAttribute('value')).toBe(false);
      select.selectedIndex = 1;
      expect([...new FormData(form)]).toEqual([['c', 'Beta']]);
      setBeta('b');
      expect([...new FormData(form)]).toEqual([['c', 'b']]);
      setBeta(null);
      expect([...new FormData(form)]).toEqual([['c', 'Beta']]);
      dispose();
    });

    // Adopted: the server wrote no value attribute for a nullish value.
    const app = serve('<form><select name="s"><option>Alpha</option><option>Beta</option></select></form>');
    mount(() => h('form', null,
      h('select', { name: 's' },
        h('option', { value: () => undefined }, 'Alpha'),
        h('option', { value: () => null }, 'Beta')),
    ), app);
    const form = app.querySelector('form')!;
    expect([...new FormData(form)]).toEqual([['s', 'Alpha']]);
    expect(form.querySelector('option')!.hasAttribute('value')).toBe(false);
  });
});
