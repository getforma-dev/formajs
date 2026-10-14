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
