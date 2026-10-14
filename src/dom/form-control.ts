/** Shared live-property writes for client construction and SSR adoption. */
export function isFormControlProperty(el: Element, key: string): boolean {
  if (key === 'value') {
    return el instanceof HTMLInputElement
      || el instanceof HTMLTextAreaElement
      || el instanceof HTMLSelectElement
      || el instanceof HTMLOptionElement;
  }
  return (key === 'checked' && el instanceof HTMLInputElement)
    || (key === 'selected' && el instanceof HTMLOptionElement);
}

/**
 * Attributes represent defaults, not the live state after user interaction.
 * Compare against the actual property rather than an attribute cache: a user
 * may have edited it even when the next binding result equals its last result.
 */
export function writeFormControlProperty(el: Element, key: string, value: unknown): void {
  if (key === 'value') {
    const control = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLOptionElement;
    if (control instanceof HTMLSelectElement && control.multiple && Array.isArray(value)) {
      const selected = new Set(value.map(String));
      for (const option of Array.from(control.options)) {
        const next = selected.has(option.value);
        if (option.selected !== next) option.selected = next;
      }
      return;
    }
    const next = value == null ? '' : String(value);
    // Browsers only allow clearing a file input programmatically.
    if (control instanceof HTMLInputElement && control.type === 'file' && next !== '') return;
    // Keep the existing markup/default-value contract; it is not a substitute
    // for the live-property write below once the browser's dirty flag is set.
    if (value == null) el.removeAttribute('value');
    else if (el.getAttribute('value') !== next) el.setAttribute('value', next);
    // An option has no live value apart from its attribute: its `value` setter
    // writes the attribute, so assigning '' for null would make it submit ''
    // instead of its text.
    // Verified by: src/dom/__tests__/form-control-adoption.test.ts > "an option bound to undefined or null submits its text, client-rendered and adopted"
    if (control instanceof HTMLOptionElement) return;
    if (control.value !== next) control.value = next;
    return;
  }

  const next = Boolean(value);
  if (key === 'checked') {
    const input = el as HTMLInputElement;
    if (input.checked !== next) input.checked = next;
  } else {
    const option = el as HTMLOptionElement;
    if (option.selected !== next) option.selected = next;
  }
  // Preserve the boolean-attribute contract for markup/default state as well.
  const attribute = key === 'checked' ? 'checked' : 'selected';
  if (next) el.setAttribute(attribute, '');
  else el.removeAttribute(attribute);
}

// ---------------------------------------------------------------------------
// Adoption: the first write of a server-rendered control's binding
// ---------------------------------------------------------------------------

/**
 * Input types whose value is not typed by the user: it is the `value`
 * attribute (or "on"), so comparing it with `defaultValue` says nothing about
 * an edit.
 */
const FIXED_VALUE_INPUT_TYPES = new Set(['hidden', 'checkbox', 'radio', 'submit', 'reset', 'button', 'image']);

function isDisabledOption(option: HTMLOptionElement): boolean {
  if (option.disabled) return true;
  const parent = option.parentElement;
  return parent != null && parent.localName === 'optgroup' && (parent as HTMLOptGroupElement).disabled;
}

/**
 * Whether the user changed a select's selection, judged against the selection
 * its markup alone produces (each option's `selected` attribute, which is what
 * `defaultSelected` reflects). A single-line select with no `selected` option
 * shows its first enabled option (the HTML selectedness rules), so that option
 * being selected is not an edit; with several `selected` options the last wins.
 */
function selectEditedByUser(select: HTMLSelectElement): boolean {
  const options = select.options;
  if (select.multiple) {
    for (let i = 0; i < options.length; i++) {
      if (options[i]!.selected !== options[i]!.hasAttribute('selected')) return true;
    }
    return false;
  }
  let initial = -1;
  for (let i = 0; i < options.length; i++) {
    if (options[i]!.hasAttribute('selected')) initial = i;
  }
  if (initial < 0 && !(select.size > 1)) {
    for (let i = 0; i < options.length; i++) {
      if (!isDisabledOption(options[i]!)) {
        initial = i;
        break;
      }
    }
  }
  return select.selectedIndex !== initial;
}

/**
 * Whether the user changed this control before its island activated: its live
 * state differs from the default its markup gives it (`value` against
 * `defaultValue`, `checked` against the `checked` attribute that
 * `defaultChecked` reflects, a select's selection against its `selected`
 * options).
 */
export function isEditedByUser(el: Element, key: string): boolean {
  if (el instanceof HTMLInputElement) {
    if (key === 'checked') return el.checked !== el.hasAttribute('checked');
    return !FIXED_VALUE_INPUT_TYPES.has(el.type) && el.value !== el.defaultValue;
  }
  if (el instanceof HTMLTextAreaElement) return el.value !== el.defaultValue;
  if (el instanceof HTMLSelectElement) return selectEditedByUser(el);
  if (el instanceof HTMLOptionElement && key === 'selected') {
    const select = el.closest('select');
    return select != null && selectEditedByUser(select);
  }
  return false;
}

/**
 * Whether the control already holds what the writer would set: the `value`
 * attribute of an option (its only value), the live value plus the `value`
 * attribute (the default its markup carries) of an input, and the live state
 * of anything else (a select's or textarea's `value` attribute means nothing
 * to the browser).
 */
function holdsValue(el: Element, key: string, value: unknown): boolean {
  if (key === 'value') {
    if (el instanceof HTMLSelectElement && el.multiple && Array.isArray(value)) {
      const wanted = new Set(value.map(String));
      for (const option of Array.from(el.options)) {
        if (option.selected !== wanted.has(option.value)) return false;
      }
      return true;
    }
    const next = value == null ? '' : String(value);
    const attributeHolds = value == null ? !el.hasAttribute('value') : el.getAttribute('value') === next;
    if (el instanceof HTMLOptionElement) return attributeHolds;
    if ((el as HTMLInputElement).value !== next) return false;
    return el instanceof HTMLInputElement ? attributeHolds : true;
  }
  const next = Boolean(value);
  return key === 'checked'
    ? (el as HTMLInputElement).checked === next
    : (el as HTMLOptionElement).selected === next;
}

/**
 * The first write of a server-rendered control's binding, at adoption.
 *
 * - A control the user edited before activation keeps what they entered.
 * - A control that already holds the client's value is not written at all,
 *   attributes included.
 * - Otherwise (the server and the client disagree on an untouched control) the
 *   client's value is written by {@link writeFormControlProperty}, which also
 *   performs every later update.
 *
 * Verified by: src/dom/__tests__/form-control-adoption.test.ts > "keeps text typed into an input before activation, then follows later updates"
 * Verified by: src/dom/__tests__/form-control-adoption.test.ts > "adoption writes nothing when the server and the client agree"
 * Verified by: src/dom/__tests__/form-control-adoption.test.ts > "repairs an untouched control the server rendered with another value"
 */
export function adoptFormControlProperty(el: Element, key: string, value: unknown): void {
  if (isEditedByUser(el, key) || holdsValue(el, key, value)) return;
  writeFormControlProperty(el, key, value);
}

// ---------------------------------------------------------------------------
// A textarea's reactive text: bound by the element, as its default value
// ---------------------------------------------------------------------------

/**
 * Whether `children` are text the element should bind as one value: at least
 * one reactive function, and otherwise only strings, numbers, booleans and
 * nullish holes. Anything else (an element, a show or list region) is left to
 * the ordinary child walk.
 */
export function isReactiveTextOnly(children: unknown[]): boolean {
  let reactive = false;
  for (const child of children) {
    if (typeof child === 'function') reactive = true;
    else if (child != null && typeof child !== 'string' && typeof child !== 'number' && typeof child !== 'boolean') return false;
  }
  return reactive;
}

/** The text of `children`: a function's current result, nothing for nullish and booleans. */
export function childText(children: unknown[]): string {
  let text = '';
  for (const child of children) {
    const value = typeof child === 'function' ? (child as () => unknown)() : child;
    if (value != null && typeof value !== 'boolean') text += String(value);
  }
  return text;
}

/**
 * Hydration markers as forma-ir wrote them around dynamic text inside a
 * `textarea` or `title` before FORMA-002: `<!--f:t0-->value<!--/f:t0-->`, with
 * a zero-width space for an empty value. In those elements the HTML parser
 * keeps them as literal text, so they reach the control's value and
 * `FormData`. Each opening marker is matched with its own closing one.
 */
const RCDATA_MARKED_TEXT = /<!--f:([ts])(\d+)-->([\s\S]*?)<!--\/f:\1\2-->/g;

/** The text a pre-FORMA-002 server meant, with its marker text removed. */
export function stripMarkerText(text: string): string {
  return text.replace(RCDATA_MARKED_TEXT, (_, _kind, _index, inner: string) => (inner === '\u200B' ? '' : inner));
}

/**
 * The first write of an adopted textarea's reactive text.
 *
 * - When the server's text (the default value) already equals the client's,
 *   nothing is written, whatever the user typed.
 * - When removing an older server's marker text makes it equal, the markers
 *   explain the whole difference: the default is cleaned. A value the user
 *   typed stays, since the browser no longer moves it with the default.
 * - Otherwise the server and the client disagree. An untouched textarea gets
 *   the client's text; one the user typed into is left alone, default included.
 *
 * Later runs write the default value only: after the user types, an update
 * changes what a form reset restores and leaves their text, as on 2.0.1. The
 * `value` prop is the controlled form.
 *
 * Verified by: src/dom/__tests__/form-control-adoption.test.ts > "keeps text typed into a marker-carrying textarea before activation"
 * Verified by: src/dom/__tests__/form-control-adoption.test.ts > "keeps server text that only looks like marker text, edited or not, without a write"
 */
export function adoptTextareaText(el: HTMLTextAreaElement, text: string): void {
  const server = el.defaultValue;
  if (server === text) return;
  if (stripMarkerText(server) === text || el.value === server) el.defaultValue = text;
}
