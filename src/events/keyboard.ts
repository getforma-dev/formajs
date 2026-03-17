// Keyboard shortcut handler

type KeyCombo = string; // e.g., 'ctrl+s', 'shift+enter', 'escape', 'ctrl+shift+z'

/** Options for the {@link onKey} keyboard shortcut handler. */
export interface KeyOptions {
  /** Element or document to listen on. Defaults to `document`. */
  target?: EventTarget;
  /** Whether to call `e.preventDefault()`. Defaults to `true`. */
  preventDefault?: boolean;
}

interface ParsedCombo {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: string;
}

function parseCombo(combo: KeyCombo): ParsedCombo {
  const parts = combo.toLowerCase().split('+').map((p) => p.trim());
  const modifiers: ParsedCombo = {
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
    key: '',
  };

  for (const part of parts) {
    switch (part) {
      case 'ctrl':
      case 'control':
        modifiers.ctrl = true;
        break;
      case 'shift':
        modifiers.shift = true;
        break;
      case 'alt':
        modifiers.alt = true;
        break;
      case 'meta':
      case 'cmd':
      case 'command':
        modifiers.meta = true;
        break;
      default:
        modifiers.key = part;
    }
  }

  return modifiers;
}

function matchesCombo(e: KeyboardEvent, parsed: ParsedCombo): boolean {
  if (e.ctrlKey !== parsed.ctrl) return false;
  if (e.shiftKey !== parsed.shift) return false;
  if (e.altKey !== parsed.alt) return false;
  if (e.metaKey !== parsed.meta) return false;
  return e.key.toLowerCase() === parsed.key;
}

/**
 * Listen for a keyboard shortcut and invoke a handler when it fires.
 *
 * Supports modifier keys: `ctrl`, `shift`, `alt`, `meta`/`cmd`.
 *
 * ```ts
 * const unsub = onKey('ctrl+s', (e) => save());
 * const unsub2 = onKey('escape', () => close(), { target: modal });
 * ```
 *
 * @param combo    Key combination string (e.g. `'ctrl+s'`, `'shift+enter'`).
 * @param handler  Called when the combo is pressed.
 * @param options  Optional target element and preventDefault behavior.
 * @returns An unsubscribe function that removes the listener.
 */
export function onKey(
  combo: KeyCombo,
  handler: (e: KeyboardEvent) => void,
  options?: KeyOptions,
): () => void {
  const target: EventTarget = options?.target ?? document;
  const shouldPreventDefault = options?.preventDefault ?? true;
  const parsed = parseCombo(combo);

  const listener = (e: Event) => {
    if (!(e instanceof KeyboardEvent)) return;
    if (matchesCombo(e, parsed)) {
      if (shouldPreventDefault) {
        e.preventDefault();
      }
      handler(e);
    }
  };

  target.addEventListener('keydown', listener);

  return () => {
    target.removeEventListener('keydown', listener);
  };
}
