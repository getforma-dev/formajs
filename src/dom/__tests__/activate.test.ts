/**
 * activateIslands — multi-island activation tests.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { activateIslands } from '../activate';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('activateIslands', () => {
  it('discovers all [data-forma-island] elements and activates them', () => {
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="FormA" data-forma-status="pending">
        <p>Island 0</p>
      </div>
      <footer>Static</footer>
      <div data-forma-island="1" data-forma-component="FormB" data-forma-status="pending">
        <p>Island 1</p>
      </div>
    `;

    const hydrateFnA = vi.fn();
    const hydrateFnB = vi.fn();

    activateIslands({ FormA: hydrateFnA, FormB: hydrateFnB });

    // Both hydrate functions called
    expect(hydrateFnA).toHaveBeenCalledTimes(1);
    expect(hydrateFnB).toHaveBeenCalledTimes(1);

    // Status updated to 'active'
    const islands = document.querySelectorAll('[data-forma-island]');
    expect(islands[0]?.getAttribute('data-forma-status')).toBe('active');
    expect(islands[1]?.getAttribute('data-forma-status')).toBe('active');
  });

  it('passes null props when no props sources exist', () => {
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="Simple" data-forma-status="pending">
        <span>No props</span>
      </div>
    `;

    const hydrateFn = vi.fn();
    activateIslands({ Simple: hydrateFn });

    const island = document.querySelector('[data-forma-island]') as HTMLElement;
    expect(hydrateFn).toHaveBeenCalledWith(island, null);
  });

  it('loads inline props from data-forma-props attribute', () => {
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="WithProps"
           data-forma-props='{"name":"test","count":42}'
           data-forma-status="pending">
        <span>Has props</span>
      </div>
    `;

    const hydrateFn = vi.fn();
    activateIslands({ WithProps: hydrateFn });

    const island = document.querySelector('[data-forma-island]') as HTMLElement;
    expect(hydrateFn).toHaveBeenCalledWith(island, { name: 'test', count: 42 });
  });

  it('loads props from shared script block', () => {
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="ScriptProps" data-forma-status="pending">
        <span>Script props</span>
      </div>
      <script id="__forma_islands" type="application/json">{"0":{"title":"hello"}}</script>
    `;

    const hydrateFn = vi.fn();
    activateIslands({ ScriptProps: hydrateFn });

    const island = document.querySelector('[data-forma-island]') as HTMLElement;
    expect(hydrateFn).toHaveBeenCalledWith(island, { title: 'hello' });
  });

  it('error in island 0 does not prevent island 1 from activating', () => {
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="Broken" data-forma-status="pending">
        <p>Broken</p>
      </div>
      <div data-forma-island="1" data-forma-component="Working" data-forma-status="pending">
        <p>Working</p>
      </div>
    `;

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const workingFn = vi.fn();

    activateIslands({
      Broken: () => { throw new Error('kaboom'); },
      Working: workingFn,
    });

    const islands = document.querySelectorAll('[data-forma-island]');
    expect(islands[0]?.getAttribute('data-forma-status')).toBe('error');
    expect(islands[1]?.getAttribute('data-forma-status')).toBe('active');
    expect(workingFn).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it('missing registry entry sets status to error and warns', () => {
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="Missing" data-forma-status="pending">
        <p>No handler</p>
      </div>
    `;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    activateIslands({});

    expect(document.querySelector('[data-forma-island]')?.getAttribute('data-forma-status')).toBe('error');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Missing'));
    warnSpy.mockRestore();
  });

  it('stores dispose function on island root element', () => {
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="Disposable" data-forma-status="pending">
        <span>Content</span>
      </div>
    `;

    activateIslands({ Disposable: vi.fn() });

    const root = document.querySelector('[data-forma-island]') as any;
    expect(typeof root.__formaDispose).toBe('function');
  });

  it('transitions status through pending -> hydrating -> active', () => {
    const statusLog: string[] = [];

    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="StatusTrack" data-forma-status="pending">
        <span>Track</span>
      </div>
    `;

    const island = document.querySelector('[data-forma-island]')!;

    // Use MutationObserver-like approach: capture status inside hydrate fn
    const hydrateFn = vi.fn(() => {
      statusLog.push(island.getAttribute('data-forma-status')!);
    });

    activateIslands({ StatusTrack: hydrateFn });

    // During hydration, status was 'hydrating'
    expect(statusLog).toContain('hydrating');
    // After completion, status is 'active'
    expect(island.getAttribute('data-forma-status')).toBe('active');
  });

  it('handles no islands gracefully', () => {
    document.body.innerHTML = `<div>No islands here</div>`;

    // Should not throw
    expect(() => activateIslands({ SomeComponent: vi.fn() })).not.toThrow();
  });
});

describe('activateIslands prop sanitization', () => {
  it('strips __proto__ from inline island props', () => {
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="Test"
           data-forma-props='{"__proto__":{"polluted":true},"safe":"ok"}'
           data-forma-status="pending">
        <span>Test</span>
      </div>
    `;
    const hydrateFn = vi.fn();
    activateIslands({ Test: hydrateFn });

    const receivedProps = hydrateFn.mock.calls[0]![1];
    expect(receivedProps.safe).toBe('ok');
    expect(receivedProps).not.toHaveProperty('__proto__', { polluted: true });
    expect(({} as any).polluted).toBeUndefined(); // no global pollution
  });

  it('strips constructor from inline island props', () => {
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="Test"
           data-forma-props='{"constructor":{"bad":true},"ok":1}'
           data-forma-status="pending">
        <span>Test</span>
      </div>
    `;
    const hydrateFn = vi.fn();
    activateIslands({ Test: hydrateFn });

    const receivedProps = hydrateFn.mock.calls[0]![1];
    expect(receivedProps.ok).toBe(1);
    expect(receivedProps).not.toHaveProperty('constructor', { bad: true });
  });

  it('strips prototype from shared script block props', () => {
    document.body.innerHTML = `
      <div data-forma-island="0" data-forma-component="Test" data-forma-status="pending">
        <span>Test</span>
      </div>
      <script id="__forma_islands" type="application/json">{"0":{"prototype":{"x":1},"valid":"yes"}}</script>
    `;
    const hydrateFn = vi.fn();
    activateIslands({ Test: hydrateFn });

    const receivedProps = hydrateFn.mock.calls[0]![1];
    expect(receivedProps.valid).toBe('yes');
    expect(receivedProps).not.toHaveProperty('prototype', { x: 1 });
  });
});

describe('activateIslands barrel export', () => {
  it('exports activateIslands from dom/index', async () => {
    const domIndex = await import('../index');
    expect(typeof domIndex.activateIslands).toBe('function');
  });
});
