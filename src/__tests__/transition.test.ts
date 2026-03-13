import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, setUnsafeEval } from '../runtime';

describe('data-transition', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    setUnsafeEval(true);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    unmount(container);
    container.remove();
    vi.useRealTimers();
  });

  it('keeps existing immediate data-show behavior when no transition attrs are present', () => {
    container.innerHTML = `
      <div data-forma-state='{"open": false}'>
        <div id="panel" data-show="{open}">Panel</div>
      </div>
    `;
    mount(container);

    const root = container.querySelector('[data-forma-state]') as any;
    const panel = container.querySelector('#panel') as HTMLElement;

    expect(panel.style.display).toBe('none');

    root.__formaScope.setters.open(true);
    expect(panel.style.display).toBe('');
  });

  it('animates leave for data-show and hides only after transition duration', async () => {
    vi.useFakeTimers();
    container.innerHTML = `
      <div data-forma-state='{"open": true}'>
        <div
          id="panel"
          data-show="{open}"
          data-transition:enter="fade-in 40ms"
          data-transition:enter-from="opacity-0"
          data-transition:enter-to="opacity-100"
          data-transition:leave="fade-out 30ms"
          data-transition:leave-from="opacity-100"
          data-transition:leave-to="opacity-0"
        >Panel</div>
      </div>
    `;
    mount(container);

    const root = container.querySelector('[data-forma-state]') as any;
    const panel = container.querySelector('#panel') as HTMLElement;

    root.__formaScope.setters.open(false);

    // Leave starts immediately, display should still be visible until timeout completes.
    expect(panel.style.display).toBe('');
    expect(panel.classList.contains('fade-out')).toBe(true);

    await vi.advanceTimersByTimeAsync(120);

    expect(panel.style.display).toBe('none');
    expect(panel.classList.contains('fade-out')).toBe(false);
    expect(panel.classList.contains('opacity-0')).toBe(false);
    expect(panel.classList.contains('opacity-100')).toBe(false);
  });

  it('cancels an in-flight leave transition when toggled back to visible', async () => {
    vi.useFakeTimers();
    container.innerHTML = `
      <div data-forma-state='{"open": true}'>
        <div
          id="panel"
          data-show="{open}"
          data-transition:enter="fade-in 30ms"
          data-transition:leave="fade-out 80ms"
        >Panel</div>
      </div>
    `;
    mount(container);

    const root = container.querySelector('[data-forma-state]') as any;
    const panel = container.querySelector('#panel') as HTMLElement;

    root.__formaScope.setters.open(false);
    root.__formaScope.setters.open(true);

    await vi.advanceTimersByTimeAsync(200);

    expect(panel.style.display).toBe('');
    expect(panel.classList.contains('fade-out')).toBe(false);
  });

  it('data-if sets data-forma-leaving during leave animation and removes after', async () => {
    vi.useFakeTimers();
    container.innerHTML = `
      <div data-forma-state='{"show": true}'>
        <div id="target"
          data-if="show"
          data-transition:leave="fade-out 50ms"
          data-transition:leave-from="opacity-100"
          data-transition:leave-to="opacity-0"
        >Content</div>
      </div>
    `;
    mount(container);
    const root = container.querySelector('[data-forma-state]') as any;
    const target = container.querySelector('#target') as HTMLElement;

    root.__formaScope.setters.show(false);

    expect(target.hasAttribute('data-forma-leaving')).toBe(true);
    expect(target.parentElement).not.toBeNull();

    await vi.advanceTimersByTimeAsync(200);

    expect(container.querySelector('#target')).toBeNull();
  });

  it('data-if enter animation applies classes on insert', async () => {
    vi.useFakeTimers();
    container.innerHTML = `
      <div data-forma-state='{"show": false}'>
        <div id="target"
          data-if="show"
          data-transition:enter="fade-in 50ms"
          data-transition:enter-from="opacity-0"
          data-transition:enter-to="opacity-100"
        >Content</div>
      </div>
    `;
    mount(container);

    expect(container.querySelector('#target')).toBeNull();

    const root = container.querySelector('[data-forma-state]') as any;
    root.__formaScope.setters.show(true);

    const target = container.querySelector('#target') as HTMLElement;
    expect(target).not.toBeNull();
    expect(target.classList.contains('fade-in')).toBe(true);

    await vi.advanceTimersByTimeAsync(200);
    expect(target.classList.contains('fade-in')).toBe(false);
  });

  it('data-if cancels leave when toggled back before duration completes', async () => {
    vi.useFakeTimers();
    container.innerHTML = `
      <div data-forma-state='{"show": true}'>
        <div id="target"
          data-if="show"
          data-transition:leave="fade-out 100ms"
        >Content</div>
      </div>
    `;
    mount(container);
    const root = container.querySelector('[data-forma-state]') as any;

    root.__formaScope.setters.show(false);
    expect(container.querySelector('#target')!.hasAttribute('data-forma-leaving')).toBe(true);

    root.__formaScope.setters.show(true);

    await vi.advanceTimersByTimeAsync(200);

    const target = container.querySelector('#target') as HTMLElement;
    expect(target).not.toBeNull();
    expect(target.hasAttribute('data-forma-leaving')).toBe(false);
  });

  it('data-if without transition attrs behaves identically to before (instant)', () => {
    container.innerHTML = `
      <div data-forma-state='{"show": true}'>
        <div id="target" data-if="show">Content</div>
      </div>
    `;
    mount(container);
    const root = container.querySelector('[data-forma-state]') as any;

    expect(container.querySelector('#target')).not.toBeNull();
    root.__formaScope.setters.show(false);
    expect(container.querySelector('#target')).toBeNull();
    root.__formaScope.setters.show(true);
    expect(container.querySelector('#target')).not.toBeNull();
  });
});
