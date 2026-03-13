// DOM mutation helpers

export function addClass(el: HTMLElement, ...classes: string[]): void {
  el.classList.add(...classes);
}

export function removeClass(el: HTMLElement, ...classes: string[]): void {
  el.classList.remove(...classes);
}

export function toggleClass(
  el: HTMLElement,
  className: string,
  force?: boolean,
): boolean {
  return el.classList.toggle(className, force);
}

export function setStyle(
  el: HTMLElement,
  styles: Partial<CSSStyleDeclaration>,
): void {
  for (const [key, value] of Object.entries(styles)) {
    if (value !== undefined) {
      (el.style as any)[key] = value;
    }
  }
}

export function setAttr(
  el: HTMLElement,
  attrs: Record<string, string | boolean | null>,
): void {
  for (const [name, value] of Object.entries(attrs)) {
    if (value === false || value === null) {
      el.removeAttribute(name);
    } else if (value === true) {
      el.setAttribute(name, '');
    } else {
      el.setAttribute(name, value);
    }
  }
}

export function setText(el: HTMLElement, text: string): void {
  el.textContent = text;
}

export function setHTML(el: HTMLElement, html: string): void {
  el.innerHTML = html;
}
