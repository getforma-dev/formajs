/**
 * The tiered mount (FORMA-128; decision brief DR-14, DR-15, L-36, L-47; v2
 * SR16, SR31, SR37's runtime half).
 *
 * `mountMarkup(root, markup, { tier, grants, config })` binds only under the
 * root it is handed, takes its configuration only from its call, hands
 * expressions `$el` through a wrapper whose traversal stops at the root, and
 * checks three grants: `fetch`, `dom` beyond the root and `navigate`. Every
 * denial is a coded `formajs:diagnostic`; a development build reports the
 * grants each mount used. The tierless paths (`reconcile()`, the auto-mount,
 * the `body` observer) keep 2.0.x's behaviour and never reach under a tiered
 * root.
 *
 * The page around each root is the application's: `#app` carries a secret in
 * an attribute and a sibling `aside`, so a reach past the root has something
 * to find.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { build, type Options } from 'tsup';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import rawConfig from '../../tsup.config';
import * as runtime from '../runtime';
import type { GrantReport, MountHandle, MountOptions, TrustedHtml } from '../runtime';
import { compileExpression, evaluateExpression, hostObject, isExprError, isHost, type Bound } from '../expr';
import { ELEMENT_HOST_PROPS, ELEMENT_METHOD_RESULT, EVENT_HOST_PROPS } from '../expr/allowlist';
import { DEPRECATIONS } from '../deprecated';

const { mountMarkup } = runtime;

interface Detail {
  kind: string;
  expr: string;
  reason: string;
  code: string;
  count: number;
  grant?: string;
  mount?: string;
  tier?: string;
}

let events: Detail[] = [];
const onDiagnostic = (e: Event): void => { events.push((e as CustomEvent<Detail>).detail); };
let handles: MountHandle[] = [];
let requests: Array<{ url: string; init: RequestInit }> = [];

/** The application's page: the root it hands over, between its own content. */
function page(): HTMLElement {
  document.body.innerHTML =
    '<section id="app" data-secret="s3cret"><h1 id="title">App</h1>' +
    '<div id="root"></div><aside id="sib">aside</aside></section>';
  return document.getElementById('root')!;
}

function mountOn(root: Element, markup: string | TrustedHtml, options: MountOptions): MountHandle {
  const handle = mountMarkup(root, markup, options);
  handles.push(handle);
  return handle;
}

const text = (id: string): string | null => document.getElementById(id)!.textContent;
const click = (id: string): void => { (document.getElementById(id) as HTMLElement).click(); };
const denials = (): Detail[] => events.filter((e) => e.kind === 'grant-denied');
const codes = (): string[] => denials().map((e) => e.code);

/** Let the tierless `body` observer drain what it queued. */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
}

/** A network that answers every request with `status` and `body`, recording each. */
function answers(status = 200, body: unknown = 'ok'): void {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    requests.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });
}

/** One scope with one binding: `<p id="out" data-text="{expr}">initial</p>`. */
const probe = (expr: string, extra = ''): string =>
  `<div data-forma-state='{}'><p id="out" data-text="{${expr}}">initial</p>${extra}</div>`;

beforeEach(() => {
  events = [];
  requests = [];
  runtime.clearDiagnostics();
  window.addEventListener('formajs:diagnostic', onDiagnostic);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  // The runtime zeroes its task meter from a timer (FORMA-028): one armed
  // under fake timers must fire before real ones return, or the next test
  // starts on a meter nothing will zero.
  if (vi.isFakeTimers()) vi.runOnlyPendingTimers();
  for (const handle of handles) handle.unmount();
  handles = [];
  document.body.replaceChildren();
  window.removeEventListener('formajs:diagnostic', onDiagnostic);
  runtime.setDiagnostics(true);
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SR16: binding only under the root handed in', () => {
  it('binds only under the root it is handed: markup injected outside it stays unbound', async () => {
    // A page that loads no tierless path, as 3.0.0's and the preview frame's
    // do: the observer 2.x still starts on `body` is stopped first.
    runtime.destroyRuntime();
    try {
      const root = page();
      const handle = mountOn(root, `<div data-forma-state='{"n":1}'><p id="inside" data-text="{n}">0</p></div>`, {
        tier: 'reviewed',
        grants: {},
      });
      const injected = (id: string): string => `<div data-forma-state='{"n":2}'><p id="${id}" data-text="{n}">raw</p></div>`;
      document.getElementById('app')!.insertAdjacentHTML('beforeend', injected('beside'));
      document.body.insertAdjacentHTML('beforeend', injected('in-body'));
      root.insertAdjacentHTML('beforebegin', injected('before'));
      await settle();

      expect(text('inside')).toBe('1');
      expect([text('beside'), text('in-body'), text('before')]).toEqual(['raw', 'raw', 'raw']);

      // An update renders under the root again, and only there.
      handle.update(`<div data-forma-state='{"m":3}'><p id="inside" data-text="{m}">0</p></div>`);
      await settle();
      expect(text('inside')).toBe('3');
      expect([text('beside'), text('in-body'), text('before')]).toEqual(['raw', 'raw', 'raw']);
    } finally {
      document.body.replaceChildren();
      runtime.initRuntime();
    }
    // The control: the same injection where 2.x's tierless observer runs is
    // bound, by that path. The mount is not what binds it.
    document.body.insertAdjacentHTML('beforeend', `<div data-forma-state='{"n":2}'><p id="observed" data-text="{n}">raw</p></div>`);
    await settle();
    expect(text('observed')).toBe('2');
  });

  it('no tierless path binds markup under a tiered root', async () => {
    const root = page();
    mountOn(
      root,
      `<div data-forma-state='{"n":0}'>` +
        `<p id="reach" data-text="{$el.closest('body') ? 'reached' : 'confined'}">initial</p>` +
        `<button id="inc" data-on:click="{n++}">+</button><p id="n" data-text="{n}">-</p></div>`,
      { tier: 'reviewed', grants: {} },
    );
    expect(text('reach')).toBe('confined');
    expect(text('n')).toBe('0');

    // Markup the page inserts under the root later: the observer does not bind it.
    root.insertAdjacentHTML('beforeend', `<div data-forma-state='{"x":1}'><p id="late" data-text="{x}">raw</p></div>`);
    await settle();
    expect(text('late')).toBe('raw');

    // The tierless mount() and the DOMContentLoaded scan pass it by, and do
    // not bind the mount's own markup again with every power.
    runtime.mount(document.body);
    runtime.initRuntime();
    expect(text('late')).toBe('raw');
    expect(text('reach')).toBe('confined');

    // A tierless scope around the root binds its own elements, never the mount's.
    // Nor do its $refs reach into the mount.
    const app = document.getElementById('app')!;
    app.setAttribute('data-forma-state', '{"t":"app"}');
    document.getElementById('title')!.setAttribute('data-text', "{$refs.counter ? 'into the mount' : t}");
    document.getElementById('n')!.setAttribute('data-ref', 'counter');
    runtime.mount(app);
    expect(text('title')).toBe('app');
    expect(text('reach')).toBe('confined');

    // The attribute the observer watches, changed under the root: ignored.
    root.querySelector('[data-forma-state]')!.setAttribute('data-forma-state', '{"n":5}');
    await settle();

    // Tierless unmount() and destroyRuntime() leave the mount bound.
    runtime.unmount(document.body);
    runtime.destroyRuntime();
    runtime.initRuntime();
    click('inc');
    expect(text('n')).toBe('1');
    expect(text('reach')).toBe('confined');
  });

  it('a mount nested in another binds with its own grants, and the outer one never binds its markup', () => {
    const root = page();
    mountOn(root, probe(`$el.closest('section') ? 'outer reached' : 'confined'`, '<div id="inner-root"></div>'), {
      tier: 'compiled', // every grant
    });
    expect(text('out')).toBe('outer reached');
    const inner = document.getElementById('inner-root')!;
    mountOn(
      inner,
      `<div data-forma-state='{}'><p id="inner" data-text="{$el.closest('section') ? 'reached' : 'confined'}">initial</p>` +
        `<p id="asks" data-text="{$el.matches('section p') ? 'read' : 'not read'}">initial</p></div>`,
      { tier: 'reviewed', grants: {} },
    );
    // The inner mount's markup is bound by the inner mount, without dom: its
    // closest() stops at its root, and a selector asking about the page is
    // denied in the inner mount's name.
    expect(text('inner')).toBe('confined');
    expect(text('asks')).toBe('initial');
    expect(codes()).toEqual(['FORMA_E_GRANT_DOM']);
    expect(denials()[0]!.mount).toBe('#inner-root');
  });
});

describe("SR16 in 2.x: the page's mount switch", () => {
  // Each case loads a fresh copy of the runtime, as a page does, after setting
  // up the page it starts on. The copy this file imports, which auto-mounts,
  // is stopped meanwhile, so the page has one runtime.
  const served = `<div data-forma-state='{"n":1}'><p id="served" data-text="{n}">raw</p></div><div id="root"></div>`;
  const injected = (id: string): string => `<div data-forma-state='{"n":2}'><p id="${id}" data-text="{n}">raw</p></div>`;

  async function freshRuntime(): Promise<typeof runtime> {
    vi.resetModules();
    return import('../runtime');
  }

  it("with the page's mount switch only mountMarkup binds: markup injected outside a tiered root stays unbound", async () => {
    runtime.destroyRuntime();
    const script = document.createElement('script');
    script.setAttribute('data-forma-mount', 'manual');
    document.head.appendChild(script);
    document.body.innerHTML = served;
    const fresh = await freshRuntime();
    try {
      await settle();
      // No auto-mount on load: the server's own data-forma-state is not bound.
      expect(text('served')).toBe('raw');
      const widget = fresh.mountMarkup(document.getElementById('root')!,
        `<div data-forma-state='{"w":3}'><p id="inside" data-text="{w}">-</p></div>`, { tier: 'reviewed', grants: {} });
      expect(text('inside')).toBe('3');

      // No body observer: markup injected beside the root stays unbound.
      document.body.insertAdjacentHTML('beforeend', injected('outside'));
      await settle();
      expect(text('outside')).toBe('raw');

      // The tierless calls refuse, and bind nothing.
      const scratch = document.createElement('div');
      document.body.appendChild(scratch);
      for (const call of [
        () => fresh.mount(document.body),
        () => fresh.initRuntime(),
        () => fresh.reconcile(scratch, injected('reconciled')),
      ]) {
        expect(call).toThrow(/FORMA_E_MOUNT_MANUAL/);
      }
      expect(scratch.innerHTML).toBe('');
      expect([text('served'), text('outside')]).toEqual(['raw', 'raw']);

      // Read once: removing the switch later turns nothing back on.
      script.remove();
      document.body.insertAdjacentHTML('beforeend', injected('later'));
      await settle();
      expect(text('later')).toBe('raw');
      expect(() => fresh.mount(document.body)).toThrow(/FORMA_E_MOUNT_MANUAL/);
      widget.unmount();
    } finally {
      fresh.destroyRuntime();
      script.remove();
    }

    // The control: the same page without the switch auto-mounts, as at 2.0.x.
    document.body.innerHTML = served;
    const auto = await freshRuntime();
    try {
      expect(text('served')).toBe('1');
      document.body.insertAdjacentHTML('beforeend', injected('observed'));
      await settle();
      expect(text('observed')).toBe('2');
    } finally {
      auto.destroyRuntime();
      document.body.replaceChildren();
      vi.resetModules();
      runtime.initRuntime();
    }
  });

  it("the mount switch is read once, from the runtime's own script element", async () => {
    // A CDN build reads its own <script> (document.currentScript). Here that
    // element is not in the document, so nothing but the own-element read can
    // see it.
    runtime.destroyRuntime();
    const own = document.createElement('script');
    own.setAttribute('data-forma-mount', 'manual');
    Object.defineProperty(document, 'currentScript', { configurable: true, get: () => own });
    document.body.innerHTML = served;
    try {
      const fresh = await freshRuntime();
      expect(text('served')).toBe('raw');
      expect(() => fresh.mount(document.body)).toThrow(/FORMA_E_MOUNT_MANUAL/);
      fresh.destroyRuntime();

      // Any other value is the default.
      own.setAttribute('data-forma-mount', 'auto');
      document.body.innerHTML = served;
      const auto = await freshRuntime();
      expect(text('served')).toBe('1');
      auto.destroyRuntime();
    } finally {
      delete (document as unknown as Record<string, unknown>).currentScript;
      document.body.replaceChildren();
      vi.resetModules();
      runtime.initRuntime();
    }
  });
});

describe('L-36: $el, $event and $refs stop at the mount root', () => {
  it("$el.closest('body') reaches nothing without dom", () => {
    const expr = `$el.closest('body') ? 'reached' : 'confined'`;
    const root = page();
    // Without dom the walk stops at the root and answers null, as no match
    // does: nothing outside is tested, so there is nothing to deny.
    const confined = mountOn(root, probe(expr), { tier: 'reviewed', grants: {} });
    expect(text('out')).toBe('confined');
    expect(denials()).toEqual([]);
    expect(document.getElementById('out')!.hasAttribute('data-forma-expr-error')).toBe(false);
    confined.unmount();

    // An element inside the root is reachable without dom.
    mountOn(root, probe(`$el.closest('[data-forma-state]').tagName`), { tier: 'reviewed', grants: {} });
    expect(text('out')).toBe('DIV');
    handles.pop()!.unmount();

    // With dom, and under A2's default of every grant, it reaches the page.
    mountOn(root, probe(expr), { tier: 'reviewed', grants: { dom: true } });
    expect(text('out')).toBe('reached');
    handles.pop()!.unmount();
    mountOn(root, probe(expr), { tier: 'reviewed' });
    expect(text('out')).toBe('reached');
    expect(denials()).toEqual([]);
  });

  it("closest() without dom never tests an element outside the root: an outside ancestor's attribute cannot be read a character at a time", () => {
    // formajs#30's review, B1: a local attribute selector that matches only
    // an ancestor outside the root. When closest() tested that ancestor and
    // refused the answer, the refusal (the binding kept its text) against no
    // match (it rendered MISS) read the secret one prefix at a time.
    const root = page(); // inside <section data-secret="s3cret">
    const asked = (prefix: string): string | null => {
      mountOn(root, probe(`$el.closest('[data-secret^=&quot;${prefix}&quot;]') ? 'HIT' : 'MISS'`), { tier: 'reviewed', grants: {} });
      const answer = text('out');
      handles.pop()!.unmount();
      return answer;
    };
    const answers = ['s', 's3', 's3c', 'x', 'q'].map(asked);
    expect(answers).toEqual(['MISS', 'MISS', 'MISS', 'MISS', 'MISS']);
    expect(denials()).toEqual([]);
    // The same selector still finds a match inside the root, and dom still
    // reaches the ancestor: the walk is confined, not the selector refused.
    mountOn(root, `<div data-forma-state='{}' data-secret="inside"><p id="out" data-text="{$el.closest('[data-secret^=&quot;in&quot;]') ? 'HIT' : 'MISS'}">-</p></div>`,
      { tier: 'reviewed', grants: {} });
    expect(text('out')).toBe('HIT');
    handles.pop()!.unmount();
    mountOn(root, probe(`$el.closest('[data-secret^=&quot;s3&quot;]') ? 'HIT' : 'MISS'`), { tier: 'reviewed', grants: { dom: true } });
    expect(text('out')).toBe('HIT');
  });

  it.each([
    [':has(+ aside)', `$el.closest('div').matches(':has(+ aside)')`],
    [':has(span)', `$el.matches(':has(span)')`],
    [':is() of a complex selector', `$el.matches(':is([data-secret] p)')`],
    [':where() of a complex selector', `$el.matches(':where(section p)')`],
    [':scope', `$el.closest('div').querySelector(':scope > p')`],
    [':scope alone', `$el.matches(':scope')`],
    [':not() of a complex selector', `$el.closest('div').querySelectorAll(':not(section *)').length`],
  ])('matches() and querySelector(All)() cannot read past the element through %s', (_form, expr) => {
    const root = page();
    mountOn(root, probe(expr), { tier: 'reviewed', grants: {} });
    expect(text('out')).toBe('initial');
    expect(codes()).toEqual(['FORMA_E_GRANT_DOM']);
  });

  it("an element reached through $event or $refs carries the mount's bound", () => {
    const root = page();
    mountOn(
      root,
      `<div data-forma-state='{"seen":"none"}'><p id="mine" data-ref="mine">mine</p>` +
        `<button id="via-event" data-on:click="{seen = 'event ' + ($event.target.closest('section') ? 'reached' : 'confined')}">e</button>` +
        `<button id="via-refs" data-on:click="{seen = 'refs ' + ($refs.mine.closest('section') ? 'reached' : 'confined')}">r</button>` +
        `<button id="local" data-on:click="{seen = $event.target.closest('div') ? 'own div' : 'none'}">l</button>` +
        `<p id="seen" data-text="{seen}">-</p></div>`,
      { tier: 'reviewed', grants: {} },
    );
    click('via-event');
    expect(text('seen')).toBe('event confined');
    click('via-refs');
    expect(text('seen')).toBe('refs confined');
    click('local');
    expect(text('seen')).toBe('own div');
  });

  it('the mount root itself is outside the mount', () => {
    const root = page();
    mountOn(root, probe(`$el.closest('#root') ? 'root' : 'none'`), { tier: 'reviewed', grants: {} });
    expect(text('out')).toBe('none');
    handles.pop()!.unmount();
    // Through a hop that yields it, it is refused.
    mountOn(root, probe(`$el.closest('div').parentElement`), { tier: 'reviewed', grants: {} });
    expect(text('out')).toBe('initial');
  });

  it.each([
    // [method, a selector asking about the page, its answer with dom, the local form, its answer without dom]
    ['matches', `$el.matches('section[data-secret^="s"] p') ? 'yes' : 'no'`, 'yes', `$el.matches('p') ? 'yes' : 'no'`, 'yes'],
    ['closest', `$el.closest('section > div div') ? 'yes' : 'no'`, 'yes', `$el.closest('div') ? 'yes' : 'no'`, 'yes'],
    ['querySelector', `$el.closest('div').querySelector('#app span') ? 'yes' : 'no'`, 'yes', `$el.closest('div').querySelector('span') ? 'yes' : 'no'`, 'yes'],
    ['querySelectorAll', `$el.closest('div').querySelectorAll('[data-secret] span').length`, '1', `$el.closest('div').querySelectorAll('span').length`, '1'],
  ])('a selector that reads past the element needs dom: %s', (_method, outward, granted, local, localAnswer) => {
    // A scope holding a <span>, so every form has something to find.
    const widget = (expr: string): string =>
      `<div data-forma-state='{}'><p id="out" data-text="{${expr.replace(/"/g, '&quot;')}}">initial</p><p><span></span></p></div>`;
    const root = page();
    mountOn(root, widget(outward), { tier: 'reviewed', grants: {} });
    expect(text('out')).toBe('initial');
    expect(codes()).toEqual(['FORMA_E_GRANT_DOM']);
    handles.pop()!.unmount();

    // The same question with a local selector is answered without dom...
    mountOn(root, widget(local), { tier: 'reviewed', grants: {} });
    expect(text('out')).toBe(localAnswer);
    handles.pop()!.unmount();
    // ...and the one asking about the page is answered with it. (happy-dom
    // matches a querySelector() combinator only inside the receiver, where a
    // browser matches the whole document; e2e/tiered-mount.spec.ts asserts
    // the browsers' answer.)
    mountOn(root, widget(outward), { tier: 'reviewed', grants: { dom: true } });
    if (_method === 'matches' || _method === 'closest') expect(text('out')).toBe(granted);
    else expect(text('out')).not.toBe('initial');
    expect(codes()).toEqual(['FORMA_E_GRANT_DOM']);
  });
});

/**
 * Every hop the interpreter offers that yields an element, each from a
 * receiver at the boundary so the hop crosses it. The runtime never hands an
 * expression such a receiver; the table checks that the interpreter would
 * refuse the hop if it did, so the bound does not rest on that alone.
 */
const HOPS: ReadonlyArray<{ hop: string; src: string; host: (d: Document) => unknown }> = [
  { hop: 'nextElementSibling', src: '$h.nextElementSibling', host: (d) => d.getElementById('root') },
  { hop: 'previousElementSibling', src: '$h.previousElementSibling', host: (d) => d.getElementById('sib') },
  { hop: 'firstElementChild', src: '$h.firstElementChild', host: (d) => d.getElementById('app') },
  { hop: 'lastElementChild', src: '$h.lastElementChild', host: (d) => d.getElementById('app') },
  { hop: 'children', src: '$h.children', host: (d) => d.getElementById('app') },
  { hop: 'closest', src: "$h.closest('section')", host: (d) => d.getElementById('in') },
  { hop: 'querySelector', src: "$h.querySelector('aside')", host: (d) => d.getElementById('app') },
  { hop: 'querySelectorAll', src: "$h.querySelectorAll('aside')", host: (d) => d.getElementById('app') },
  { hop: 'event.target', src: '$h.target', host: (d) => ({ event: d.getElementById('sib') }) },
  { hop: 'event.currentTarget', src: '$h.currentTarget', host: (d) => ({ event: d.getElementById('sib') }) },
  { hop: '$refs', src: '$h.x', host: (d) => ({ refs: d.getElementById('sib') }) },
];

/** Evaluate `src` with `$h` a host made under `bound`, inside a dispatch when the host is an event. */
function evalHop(entry: (typeof HOPS)[number], bound: Bound): unknown {
  const made = entry.host(document) as Element | { event: Element } | { refs: Element };
  const run = (host: unknown): unknown =>
    evaluateExpression(compileExpression(entry.src), { getters: { $h: () => host }, setters: {} });
  if ('event' in made) {
    let out: unknown;
    let thrown: unknown;
    made.event.addEventListener('ping', (e) => {
      try { out = run(hostObject('event', e, '$event', bound)); } catch (err) { thrown = err; }
    }, { once: true });
    made.event.dispatchEvent(new Event('ping'));
    if (thrown) throw thrown;
    return out;
  }
  if ('refs' in made) return run(hostObject('refs', new Map([['x', made.refs]]), '$refs', bound));
  return run(hostObject('element', made, '$el', bound));
}

describe('L-36: no hop reaches past the mount root', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<section id="app"><div id="root"><div id="in"><span id="deep"></span></div></div><aside id="sib"></aside></section>';
  });

  const boundFor = (dom: boolean): { bound: Bound; used: string[] } => {
    const used: string[] = [];
    return { bound: { root: document.getElementById('root')!, dom, navigate: false, use: (g) => used.push(g) }, used };
  };

  it.each(HOPS.map((h) => [h.hop, h] as const))('no hop from $el reaches past the mount root: %s', (_hop, entry) => {
    const denied = boundFor(false);
    let error: unknown;
    let answer: unknown = 'unset';
    try { answer = evalHop(entry, denied.bound); } catch (err) { error = err; }
    if (entry.hop === 'closest') {
      // closest() is confined, not refused: its walk stops at the root and
      // answers nothing, so no element outside it is tested (B1).
      expect(error).toBeUndefined();
      expect(answer).toBeUndefined();
    } else {
      expect(isExprError(error) && error.code).toBe('FORMA_E_GRANT_DOM');
    }
    expect(denied.used).toEqual([]);

    // With dom the hop is answered, still wrapped, and its use recorded.
    const granted = boundFor(true);
    const out = evalHop(entry, granted.bound);
    const first = Array.isArray(out) ? out[0] : out;
    expect(isHost(first) && (first.target as Element).id).toMatch(/^(sib|app|root)$/);
    expect(isHost(first) && first.bound).toBe(granted.bound);
    expect(granted.used.length).toBeGreaterThan(0);
    expect(new Set(granted.used)).toEqual(new Set(['dom']));
  });

  it('a hop that stays inside the root needs no grant', () => {
    const { bound, used } = boundFor(false);
    const inside = hostObject('element', document.getElementById('in'), '$el', bound);
    const out = evaluateExpression(compileExpression('$h.firstElementChild.closest(\'#in\').querySelector(\'span\').id'), {
      getters: { $h: () => inside },
      setters: {},
    });
    expect(out).toBe('deep');
    expect(used).toEqual([]);
  });

  it('the table covers every element-yielding entry of the allowlist', () => {
    // A new property, method or event field that yields an element joins the
    // table above, or this fails: the bound is checked per hop, not assumed.
    const yields = [
      ...Object.entries(ELEMENT_HOST_PROPS).filter(([, as]) => as === 'element' || as === 'elementList').map(([k]) => k),
      ...Object.entries(ELEMENT_METHOD_RESULT).filter(([, as]) => as === 'element' || as === 'elementList').map(([k]) => k),
      ...[...EVENT_HOST_PROPS].map((k) => `event.${k}`),
      '$refs',
    ].sort();
    expect(HOPS.map((h) => h.hop).sort()).toEqual(yields);
  });

  it.each([
    'parentElement', 'parentNode', 'ownerDocument', 'offsetParent', 'shadowRoot', 'assignedSlot', 'form',
    'labels', 'list', 'ownerSVGElement', 'viewportElement', 'nextSibling', 'previousSibling', 'firstChild',
    'lastChild', 'childNodes', 'getRootNode()', 'contains(null)', 'ownerDocument.body', 'outerHTML', 'innerHTML',
  ])('no property or method outside the allowlist reaches another element, granted dom or not: $el.%s', (member) => {
    const { bound } = boundFor(true);
    const el = hostObject('element', document.getElementById('in'), '$el', bound);
    let error: unknown;
    try {
      evaluateExpression(compileExpression(`$h.${member}`), { getters: { $h: () => el }, setters: {} });
    } catch (err) { error = err; }
    expect(isExprError(error) && error.code).toMatch(/^FORMA_E_(PROPERTY|METHOD)_DENIED$/);
  });

  it.each(['relatedTarget', 'composedPath()', 'view', 'srcElement', 'path', 'target.parentElement'])(
    'no event field outside the allowlist reaches another element, granted dom or not: $event.%s',
    (member) => {
      const { bound } = boundFor(true);
      const node = document.getElementById('deep')!;
      let error: unknown;
      node.addEventListener('ping', (e) => {
        try {
          evaluateExpression(compileExpression(`$h.${member}`), {
            getters: { $h: () => hostObject('event', e, '$event', bound) },
            setters: {},
          });
        } catch (err) { error = err; }
      }, { once: true });
      node.dispatchEvent(new Event('ping', { bubbles: true }));
      expect(isExprError(error) && error.code).toMatch(/^FORMA_E_(PROPERTY|METHOD)_DENIED$/);
    },
  );
});

describe('DR-15: grants', () => {
  it('$el.click() is denied without navigate and runs with it', () => {
    const root = page();
    const markup =
      `<div data-forma-state='{}'><a id="link" data-ref="link" href="#navigated">x</a>` +
      `<button id="go" data-on:click="{$refs.link.click()}">go</button></div>`;
    let clicks = 0;
    const count = (): void => { clicks++; };

    mountOn(root, markup, { tier: 'reviewed', grants: {} });
    document.getElementById('link')!.addEventListener('click', (e) => { e.preventDefault(); count(); });
    click('go');
    expect(clicks).toBe(0);
    expect(codes()).toEqual(['FORMA_E_GRANT_NAVIGATE']);
    expect(denials()[0]!.grant).toBe('navigate');
    expect(document.getElementById('go')!.getAttribute('data-forma-handler-error')).toBe('unsupported');
    handles.pop()!.unmount();

    mountOn(root, markup, { tier: 'reviewed', grants: { navigate: true } });
    document.getElementById('link')!.addEventListener('click', (e) => { e.preventDefault(); count(); });
    click('go');
    expect(clicks).toBe(1);
    expect(codes()).toEqual(['FORMA_E_GRANT_NAVIGATE']);
  });

  it.each(['click', 'auxclick', 'DOMActivate', 'submit', 'reset', 'Click'])(
    '$dispatch of an activation event needs navigate: %s',
    (type) => {
      // formajs#30's review, S1: WebKit runs a link's, a submit button's and a
      // form's activation for an untrusted click, auxclick or DOMActivate, and
      // Firefox submits or resets a form on an untrusted submit or reset.
      const root = page();
      const markup =
        `<div data-forma-state='{}'><form id="form"><button id="go" type="button" ` +
        `data-on:mouseover="{$dispatch('${type}')}">go</button></form></div>`;
      let seen = 0;
      const count = (): void => { seen++; };

      mountOn(root, markup, { tier: 'reviewed', grants: {} });
      document.getElementById('form')!.addEventListener(type, count);
      document.getElementById('go')!.dispatchEvent(new Event('mouseover'));
      expect(seen).toBe(0);
      expect(codes()).toEqual(['FORMA_E_GRANT_NAVIGATE']);
      expect(denials()[0]!.grant).toBe('navigate');
      handles.pop()!.unmount();

      const granted = mountOn(root, markup, { tier: 'reviewed', grants: { navigate: true } });
      document.getElementById('form')!.addEventListener(type, count);
      document.getElementById('go')!.dispatchEvent(new Event('mouseover'));
      expect(seen).toBe(1);
      expect(granted.grantsUsed()).toEqual({ navigate: true });
    },
  );

  it('$dispatch of any other event needs no grant', () => {
    const root = page();
    const handle = mountOn(root,
      `<div data-forma-state='{}'><button id="go" data-on:mouseover="{$dispatch('selected', 7)}">go</button></div>`,
      { tier: 'reviewed', grants: {} });
    let detail: unknown = null;
    document.getElementById('root')!.addEventListener('selected', (e) => { detail = (e as CustomEvent).detail; });
    document.getElementById('go')!.dispatchEvent(new Event('mouseover'));
    expect(detail).toBe(7);
    expect(denials()).toEqual([]);
    expect(handle.grantsUsed()).toEqual({});
  });

  it('with explicit empty grants a generated tree binds neither data-fetch nor $el.click()', async () => {
    // SR31. The tree a generator could write: a POST in the user's session,
    // and a click on a link it carries.
    answers(200, 'done');
    const root = page();
    const tree =
      `<div data-forma-state='{}'>` +
      `<div data-fetch="POST /api/transfer → done |error:failed"></div>` +
      `<p id="failed" data-text="{failed}">-</p><p id="done" data-text="{done}">-</p>` +
      `<a id="link" data-ref="link" href="#navigated">x</a>` +
      `<button id="go" data-on:click="{$refs.link.click()}">go</button></div>`;
    let clicks = 0;

    mountOn(root, tree, { tier: 'reviewed', grants: {} });
    document.getElementById('link')!.addEventListener('click', (e) => { e.preventDefault(); clicks++; });
    click('go');
    await settle();
    expect(requests).toEqual([]);
    expect(clicks).toBe(0);
    expect(text('failed')).toBe('data-fetch denied: the mount grants no fetch');
    expect(text('done')).toBe('');
    expect(codes().sort()).toEqual(['FORMA_E_GRANT_FETCH', 'FORMA_E_GRANT_NAVIGATE']);
    handles.pop()!.unmount();

    // The same tree with the grants it needs sends one POST, without cookies,
    // and clicks once.
    mountOn(root, tree, {
      tier: 'reviewed',
      grants: { fetch: { methods: ['POST'], paths: ['/api/transfer'] }, navigate: true },
    });
    document.getElementById('link')!.addEventListener('click', (e) => { e.preventDefault(); clicks++; });
    click('go');
    await settle();
    expect(requests.map((r) => [r.url, r.init.method, r.init.credentials])).toEqual([['/api/transfer', 'POST', 'omit']]);
    expect(clicks).toBe(1);
    expect(text('done')).toBe('done');
  });

  it('a 404 with a JSON body lands in the error: target, not the data target', async () => {
    answers(404, { error: 'missing' });
    const root = page();
    const widget =
      `<div data-forma-state='{}'>` +
      `<div data-fetch="GET /api/items → items |loading:busy |error:failed"></div>` +
      `<p id="items" data-text="{items?.error}">-</p><p id="failed" data-text="{failed}">-</p>` +
      `<p id="busy" data-text="{busy}">-</p></div>`;
    mountOn(root, widget, { tier: 'reviewed', grants: { fetch: { paths: ['/api/'] } } });
    await settle();
    expect(requests).toHaveLength(1);
    expect(text('failed')).toBe('data-fetch answered HTTP 404');
    expect(text('items')).toBe('');
    expect(text('busy')).toBe('false');
    handles.pop()!.unmount();

    // A 2xx through the same grant is data.
    answers(200, { error: 'none: this is data' });
    mountOn(root, widget, { tier: 'reviewed', grants: { fetch: { paths: ['/api/'] } } });
    await settle();
    expect(text('items')).toBe('none: this is data');
    expect(text('failed')).toBe('');
  });

  it.each([
    // [grant, data-fetch request, sent]
    [{ paths: ['/api/widgets'] }, 'GET /api/widgets/1', true],
    [{ paths: ['/api/widgets'] }, 'GET /api/widgets', true],
    [{ paths: ['/api/widgets/'] }, 'GET /api/widgets/1?q=2', true],
    [{ paths: ['/api/widgets'] }, 'GET /api/widgets-admin', false],
    [{ paths: ['/api/widgets'] }, 'GET /api/widgets/../admin', false],
    [{ paths: ['/api/widgets'] }, 'GET /api/widgets/%2e%2e/admin', false],
    [{ paths: ['/api/widgets'] }, 'GET /api/widgets/a%2Fb', false],
    [{ paths: ['/api/widgets'] }, 'GET https://evil.example/api/widgets/1', false],
    [{ paths: ['/api/widgets'] }, 'GET //evil.example/api/widgets/1', false],
    [{ paths: ['/api/widgets'] }, 'POST /api/widgets/1', false],
    [{ paths: ['/api/widgets'], methods: ['GET', 'DELETE'] }, 'DELETE /api/widgets/1', true],
    [{ paths: ['https://api.example.com/v1/'], methods: ['POST'] }, 'POST https://api.example.com/v1/x', true],
    [{ paths: ['https://api.example.com/v1/'] }, 'GET https://api.example.com/v2/x', false],
    [{ paths: ['https://api.example.com/v1/'] }, 'GET /v1/x', false],
  ] as const)('a fetch grant admits only its methods and path prefixes: %j %s', async (grant, request, sent) => {
    answers();
    const root = page();
    mountOn(root, `<div data-forma-state='{}'><div data-fetch="${request} → x |error:failed"></div></div>`, {
      tier: 'reviewed',
      grants: { fetch: grant as never },
    });
    await settle();
    expect(requests.length).toBe(sent ? 1 : 0);
    expect(codes()).toEqual(sent ? [] : ['FORMA_E_GRANT_FETCH']);
  });

  it("a fetch grant's cookies decide the request's credentials", async () => {
    answers();
    const root = page();
    for (const cookies of [true, false, undefined]) {
      mountOn(root, `<div data-forma-state='{}'><div data-fetch="GET /api/me → me"></div></div>`, {
        tier: 'reviewed',
        grants: { fetch: { paths: ['/api/'], ...(cookies === undefined ? {} : { cookies }) } },
      });
      handles.pop()!.unmount();
    }
    // And the A2 default sends them as a tierless mount does, same-origin.
    mountOn(root, `<div data-forma-state='{}'><div data-fetch="GET /api/me → me"></div></div>`, { tier: 'reviewed' });
    await settle();
    expect(requests.map((r) => r.init.credentials)).toEqual(['same-origin', 'omit', 'omit', 'same-origin']);
  });

  it("a fetch grant's timeout shortens the abort", async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
      requests.push({ url, init });
      return new Promise((_r, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Fetch is aborted', 'AbortError')));
      });
    });
    const root = page();
    mountOn(root, `<div data-forma-state='{}'><div data-fetch="GET /api/slow → x |error:failed"></div><p id="failed" data-text="{failed}">-</p></div>`, {
      tier: 'reviewed',
      grants: { fetch: { paths: ['/api/'], timeoutMs: 5_000 } },
    });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(requests[0]!.init.signal!.aborted).toBe(false);
    expect(text('failed')).toBe('');
    await vi.advanceTimersByTimeAsync(1);
    expect(requests[0]!.init.signal!.aborted).toBe(true);
    expect(text('failed')).toBe('data-fetch timed out after 5000 ms');

    // Never longer than data-fetch's 30 s.
    expect(() => mountMarkup(document.createElement('div'), '', {
      tier: 'reviewed',
      grants: { fetch: { paths: ['/api/'], timeoutMs: 30_001 } },
    })).toThrow(/FORMA_E_MOUNT_ARGS/);
  });

  it('$refetch reaches only the fetches of its own mount', async () => {
    answers();
    document.body.innerHTML = '<div id="a"></div><div id="b"></div><div id="legacy"></div>';
    const widget = (url: string, call: string, button: string): string =>
      `<div data-forma-state='{}'><div data-fetch="GET ${url} → x" data-fetch-id="load"></div>` +
      `<button id="${button}" data-on:click="{$refetch('${call}')}">r</button></div>`;
    mountOn(document.getElementById('a')!, widget('/api/a', 'load', 'a-load'), { tier: 'reviewed' });
    mountOn(document.getElementById('b')!, widget('/api/b', 'admin', 'b-admin'), { tier: 'reviewed' });
    const legacy = document.getElementById('legacy')!;
    legacy.innerHTML =
      `<div data-forma-state='{}'><div data-fetch="GET /api/admin → y" data-fetch-id="admin"></div>` +
      `<button id="legacy-load" data-on:click="{$refetch('load')}">r</button></div>`;
    runtime.mount(legacy);
    await settle();
    const count = (url: string): number => requests.filter((r) => r.url === url).length;
    expect([count('/api/a'), count('/api/b'), count('/api/admin')]).toEqual([1, 1, 1]);

    click('a-load'); // its own: sent again
    click('b-admin'); // the page's id, from a mount: reaches nothing
    click('legacy-load'); // a mount's id, from the page: reaches nothing
    await settle();
    expect([count('/api/a'), count('/api/b'), count('/api/admin')]).toEqual([2, 1, 1]);
    runtime.unmount(legacy);
  });
});

describe("SR37's runtime half: every denied grant is a coded diagnostic", () => {
  it("a seeded denial raises one coded diagnostic, whatever the page's diagnostics switch says", async () => {
    answers();
    runtime.setDiagnostics(false);
    const root = page();
    const seeded =
      `<div data-forma-state='{}'><div data-fetch="GET /api/items → items |error:failed"></div>` +
      `<div data-fetch="GET /api/items → items |error:failed"></div></div>`;
    mountOn(root, seeded, { tier: 'reviewed', grants: {}, config: { name: 'widget-a' } });

    expect(events).toEqual([{
      kind: 'grant-denied',
      expr: 'GET /api/items → items |error:failed',
      reason: 'the mount grants no fetch',
      code: 'FORMA_E_GRANT_FETCH',
      count: 1,
      mount: 'widget-a',
      tier: 'reviewed',
      grant: 'fetch',
    }]);
    // The repeat is counted on the record, not dispatched again.
    expect(runtime.getDiagnostics().filter((d) => d.kind === 'grant-denied').map((d) => d.count)).toEqual([2]);

    // A second mount denied the same thing is a second diagnostic.
    const second = document.createElement('div');
    document.body.appendChild(second);
    mountOn(second, seeded, { tier: 'reviewed', grants: {}, config: { name: 'widget-b' } });
    expect(events.map((e) => e.mount)).toEqual(['widget-a', 'widget-b']);

    // The page's switch still silences what it governs: an ordinary failure
    // in a tierless scope.
    const legacy = document.createElement('div');
    legacy.innerHTML = `<div data-forma-state='{}'><p data-text="{nope.x}">-</p></div>`;
    document.body.appendChild(legacy);
    runtime.mount(legacy);
    expect(events).toHaveLength(2);
    runtime.unmount(legacy);
    await settle();
    expect(requests).toEqual([]);
  });

  it('a mount takes its diagnostics switch from its call, not the page', () => {
    const root = page();
    runtime.setDiagnostics(false);
    mountOn(root, probe('nope.x'), { tier: 'reviewed', grants: {} });
    expect(events.map((e) => e.code)).toEqual(['FORMA_E_UNRESOLVED']);
    handles.pop()!.unmount();
    runtime.setDiagnostics(true);
    runtime.clearDiagnostics();
    mountOn(root, probe('nope.y'), { tier: 'reviewed', grants: {}, config: { diagnostics: false } });
    expect(events).toHaveLength(1);
    handles.pop()!.unmount();
    // A denied grant is reported whatever either switch says.
    mountOn(root, probe(`$el.matches('body *')`), { tier: 'reviewed', grants: {}, config: { diagnostics: false } });
    expect(events.map((e) => e.code)).toEqual(['FORMA_E_UNRESOLVED', 'FORMA_E_GRANT_DOM']);
  });
});

describe('the development report of the grants each mount used', () => {
  /** A fixture widget: GET and POST with the user's cookies, one read of the page, no click. */
  const fixture =
    `<div data-forma-state='{}'>` +
    `<div data-fetch="GET /api/items → items"></div>` +
    `<div data-fetch="POST /api/items/1 → saved"></div>` +
    `<p id="out" data-text="{$el.closest('section').id}">-</p>` +
    `<a id="link" data-ref="link" href="#x">x</a>` +
    `<button id="go" data-on:click="{$refs.link.click()}">go</button></div>`;

  it('the development report lists exactly the grants a fixture widget used', async () => {
    answers();
    const root = page();
    const handle = mountOn(root, fixture, { tier: 'reviewed' });
    await settle();
    expect(text('out')).toBe('app');
    expect(handle.grantsUsed()).toEqual({
      fetch: { methods: ['GET', 'POST'], paths: ['/api/items', '/api/items/1'], cookies: true },
      dom: true,
    });

    // The click it had not made yet appears once it does.
    document.getElementById('link')!.addEventListener('click', (e) => e.preventDefault());
    click('go');
    const report = handle.grantsUsed()!;
    expect(report).toEqual({
      fetch: { methods: ['GET', 'POST'], paths: ['/api/items', '/api/items/1'], cookies: true },
      dom: true,
      navigate: true,
    });

    // A widget that uses nothing reports nothing.
    const quiet = document.createElement('div');
    document.body.appendChild(quiet);
    expect(mountOn(quiet, probe('1 + 1'), { tier: 'reviewed' }).grantsUsed()).toEqual({});

    // The report, written back as the widget's grants, mounts it with no denial.
    handle.unmount();
    handles = handles.filter((h) => h !== handle);
    requests = [];
    events = [];
    const again = mountOn(root, fixture, { tier: 'reviewed', grants: report as GrantReport });
    document.getElementById('link')!.addEventListener('click', (e) => e.preventDefault());
    click('go');
    await settle();
    expect(denials()).toEqual([]);
    expect(requests.map((r) => [r.init.method, r.url, r.init.credentials])).toEqual([
      ['GET', '/api/items', 'same-origin'],
      ['POST', '/api/items/1', 'same-origin'],
    ]);
    expect(again.grantsUsed()).toEqual(report);
  });

  it('a request sent without cookies is reported without them', async () => {
    answers();
    const root = page();
    const handle = mountOn(root, `<div data-forma-state='{}'><div data-fetch="GET /api/public → x"></div></div>`, {
      tier: 'reviewed',
      grants: { fetch: { paths: ['/api/'] } },
    });
    await settle();
    expect(handle.grantsUsed()).toEqual({ fetch: { methods: ['GET'], paths: ['/api/public'], cookies: false } });
  });
});

describe('tiers and configuration', () => {
  it('an unreviewed mount refuses any origin but an opaque one, and any grant', () => {
    const root = page();
    root.innerHTML = '<p id="before">before</p>';
    expect(() => mountMarkup(root, probe('1'), { tier: 'unreviewed' })).toThrow(/FORMA_E_MOUNT_ORIGIN/);
    // Refused before it touched anything.
    expect(text('before')).toBe('before');

    // In a sandboxed frame without allow-same-origin, `origin` is "null".
    vi.stubGlobal('origin', 'null');
    expect(() => mountMarkup(root, probe('1'), { tier: 'unreviewed', grants: { dom: true } })).toThrow(/FORMA_E_MOUNT_ARGS/);
    expect(() => mountMarkup(root, probe('1'), { tier: 'unreviewed', grants: {} })).toThrow(/FORMA_E_MOUNT_ARGS/);
    expect(text('before')).toBe('before');

    answers();
    mountOn(
      root,
      `<div data-forma-state='{}'><div data-fetch="GET /api/x → x"></div>` +
        `<p id="out" data-text="{$el.closest('body') ? 'reached' : 'confined'}">initial</p>` +
        `<p id="sum" data-text="{1 + 1}">-</p></div>`,
      { tier: 'unreviewed' },
    );
    expect(text('sum')).toBe('2');
    expect(text('out')).toBe('confined');
    expect(codes()).toEqual(['FORMA_E_GRANT_FETCH']);
    expect(requests).toEqual([]);
    expect(denials().every((d) => d.tier === 'unreviewed')).toBe(true);
  });

  it('an unreviewed mount renders no <link>: each is removed before the markup reaches the document', async () => {
    // FORMA-128's follow-up (the A2 audit, S1): WebKit preconnects from the
    // preview frame for a <link rel="preconnect"> whatever its policy says.
    vi.stubGlobal('origin', 'null');
    const root = page();
    const inserted: string[] = [];
    const watch = new MutationObserver((records) => {
      for (const r of records) {
        for (const n of Array.from(r.addedNodes)) {
          if (n.nodeType === 1) {
            const el = n as Element;
            if (el.localName === 'link') inserted.push(el.outerHTML);
            for (const l of Array.from(el.querySelectorAll('link'))) inserted.push(l.outerHTML);
          }
        }
      }
    });
    watch.observe(root, { childList: true, subtree: true });
    const markup =
      `<link rel="preconnect" href="http://127.0.0.1:3900/">` +
      `<div data-forma-state='{"h":"http://127.0.0.1:3900/bound"}'>` +
      `<link rel="preconnect" data-bind:href="h"><link rel="stylesheet" href="/x.css">` +
      `<template><link rel="prefetch" href="http://127.0.0.1:3900/nested"></template>` +
      `<p id="kept" data-text="{'kept'}">-</p></div>`;
    const handle = mountOn(root, runtime.trustedHtml(markup), { tier: 'unreviewed' });
    await settle();
    expect(text('kept')).toBe('kept');
    expect(root.querySelectorAll('link')).toHaveLength(0);
    expect(root.querySelector('template')!.content.querySelectorAll('link')).toHaveLength(0);
    expect(inserted).toEqual([]);
    const refused = runtime.getDiagnostics().filter((d) => d.code === 'FORMA_E_UNREVIEWED_LINK');
    expect(refused.map((d) => [d.kind, d.tier])).toEqual([
      ['markup-refused', 'unreviewed'], ['markup-refused', 'unreviewed'],
      ['markup-refused', 'unreviewed'], ['markup-refused', 'unreviewed'],
    ]);

    // An update is stripped the same way, a plain string too.
    handle.update(`<p id="kept">again</p><link rel="dns-prefetch" href="http://127.0.0.1:3900/">`);
    await settle();
    expect(text('kept')).toBe('again');
    expect(root.querySelectorAll('link')).toHaveLength(0);
    expect(inserted).toEqual([]);
    watch.disconnect();
    handles.pop()!.unmount();

    // Reported whatever the mount's diagnostics switch says.
    runtime.clearDiagnostics();
    mountOn(root, `<link rel="icon" href="/i.png"><p id="kept">quiet</p>`, { tier: 'unreviewed', config: { diagnostics: false } });
    expect(runtime.getDiagnostics().map((d) => d.code)).toEqual(['FORMA_E_UNREVIEWED_LINK']);
    handles.pop()!.unmount();

    // The control: a reviewed mount keeps the markup's links.
    mountOn(root, `<link rel="preconnect" href="http://127.0.0.1:3900/"><p id="kept">reviewed</p>`, { tier: 'reviewed' });
    expect(root.querySelectorAll('link')).toHaveLength(1);
  });

  it("an unreviewed mount parses its markup once, in the root's context, and writes no string to the root", async () => {
    // formajs#35's review, B1: the strip ran in an inert <template> and the
    // reconciler wrote its serialisation to the root through innerHTML, a
    // second parse in another insertion mode, which re-created a <link> the
    // first had not seen (nested <form>, <math>, <mglyph>, <style>). Now the
    // markup is parsed once, in the root's own context, stripped on those
    // nodes, and written as nodes.
    vi.stubGlobal('origin', 'null');
    const root = page();
    const written = vi.spyOn(Element.prototype, 'innerHTML', 'set');
    const toRoot = (): number => written.mock.contexts.filter((el) => el === root).length;
    const payload = (p: string): string =>
      `<link rel="icon" href="/decoy"><form><math><mtext></form><form><mglyph><style></math>` +
      `<link rel="preconnect" href="http://127.0.0.1:3900/${p}"></style></mglyph></form></mtext></math></form><p id="p">${p}</p>`;
    const handle = mountOn(root, runtime.trustedHtml(payload('first')), { tier: 'unreviewed' });
    expect(text('p')).toBe('first');
    expect(root.querySelectorAll('link')).toHaveLength(0);
    expect(toRoot()).toBe(0);

    // An update takes the reconciler's diff path: the same one parse, and
    // the root is patched from its nodes.
    handle.update(runtime.trustedHtml(payload('second') + '<span id="added">added</span>'));
    expect(text('p')).toBe('second');
    expect(text('added')).toBe('added');
    expect(root.querySelectorAll('link')).toHaveLength(0);
    expect(toRoot()).toBe(0);

    // The parse is the root's own: a <tr> the root would not have parsed is
    // not there, on the first render and on an update alike (a <template>
    // would have kept it, and the diff would have cloned it in).
    handle.update('<tr><td>cell</td></tr><p id="p">third</p>');
    expect(text('p')).toBe('third');
    expect(root.querySelector('tr')).toBeNull();
    expect(toRoot()).toBe(0);
    written.mockRestore();
  });

  it('an unreviewed mount renders no srcdoc: the attribute is removed, a binding that would write one is refused, and each is reported', async () => {
    // formajs#35's review, S2: a <link> inside an <iframe srcdoc> was out of
    // the strip's reach, and WebKit connected for it.
    vi.stubGlobal('origin', 'null');
    const root = page();
    const doc = '<link rel=preconnect href=http://127.0.0.1:3900/>';
    const markup =
      `<iframe id="written" srcdoc="${doc}" title="kept"></iframe>` +
      `<div data-forma-state='{"d":"${doc}"}'><iframe id="bound" data-bind:srcdoc="d" data-bind:title="d"></iframe></div>` +
      `<template><iframe srcdoc="${doc}"></iframe></template>` +
      `<div data-forma-state='{"rows":["${doc}"]}'><ul data-list="{rows}"><li><iframe class="row" srcdoc="{item}" title="{item}"></iframe></li></ul></div>` +
      `<p id="kept">kept</p>`;
    const handle = mountOn(root, runtime.trustedHtml(markup), { tier: 'unreviewed' });
    await settle();
    expect(text('kept')).toBe('kept');
    expect(root.querySelectorAll('[srcdoc]')).toHaveLength(0);
    expect(root.querySelector('template')!.content.querySelectorAll('[srcdoc]')).toHaveLength(0);
    // The elements stay, without the attribute; their other bindings run.
    expect(document.getElementById('written')!.getAttribute('title')).toBe('kept');
    expect(document.getElementById('bound')!.getAttribute('title')).toBe(doc);
    expect(root.querySelectorAll('iframe.row')).toHaveLength(1);
    expect(root.querySelector('iframe.row')!.getAttribute('title')).toBe(doc);
    const refused = runtime.getDiagnostics().filter((d) => d.code === 'FORMA_E_UNREVIEWED_SRCDOC');
    expect(refused.map((d) => [d.kind, d.tier])).toEqual([
      ['markup-refused', 'unreviewed'], ['markup-refused', 'unreviewed'],
      ['markup-refused', 'unreviewed'], ['markup-refused', 'unreviewed'],
    ]);
    expect(refused.filter((d) => /binding is refused/.test(d.reason))).toHaveLength(1);

    // An update is treated the same way, written or bound.
    handle.update(`<iframe id="again" srcdoc="${doc}"></iframe><div data-forma-state='{"d":"${doc}"}'><iframe data-bind:srcdoc="d"></iframe></div><p id="kept">again</p>`);
    await settle();
    expect(text('kept')).toBe('again');
    expect(root.querySelectorAll('[srcdoc]')).toHaveLength(0);
    handles.pop()!.unmount();

    // The control: a reviewed mount writes srcdoc, written and bound.
    mountOn(root, `<iframe id="w" srcdoc="${doc}"></iframe><div data-forma-state='{"d":"${doc}"}'><iframe id="b" data-bind:srcdoc="d"></iframe></div>`, { tier: 'reviewed' });
    expect(document.getElementById('w')!.getAttribute('srcdoc')).toBe(doc);
    expect(document.getElementById('b')!.getAttribute('srcdoc')).toBe(doc);
  });

  it('an unreviewed mount fails closed: a <link> that reaches the root after the strip is removed, reported, and the markup refused', async () => {
    // Defence in depth for formajs#35's review, B1: the strip runs on the
    // nodes that are written, so nothing should reach the root; a <link>
    // that does, here planted by the DOM between the strip and the write,
    // is removed, reported as having reached the document, and the render
    // refused with the root cleared.
    vi.stubGlobal('origin', 'null');
    const root = page();
    const plant = (el: Element): void => { el.appendChild(document.createElement('link')).setAttribute('rel', 'preconnect'); };

    // On an update, through the diff path's clone of a new element.
    const handle = mountOn(root, '<p id="k">1</p>', { tier: 'unreviewed' });
    expect(text('k')).toBe('1');
    const clone = Node.prototype.cloneNode;
    const cloning = vi.spyOn(Node.prototype, 'cloneNode').mockImplementation(function (this: Node, deep?: boolean) {
      const copy = clone.call(this, deep);
      if ((this as Element).localName === 'span') plant(copy as Element);
      return copy;
    });
    let thrown: (Error & { code?: string }) | null = null;
    try { handle.update('<p id="k">2</p><span id="s">s</span>'); } catch (err) { thrown = err as Error; }
    cloning.mockRestore();
    expect(thrown?.code).toBe('FORMA_E_UNREVIEWED_LINK');
    expect(root.childNodes).toHaveLength(0);
    expect(document.querySelectorAll('link')).toHaveLength(0);
    const reached = runtime.getDiagnostics().filter((d) => d.code === 'FORMA_E_UNREVIEWED_LINK');
    expect(reached).toHaveLength(1);
    expect(reached[0]!.reason).toMatch(/reached the document/);
    expect(reached[0]!.kind).toBe('markup-refused');
    // The mount lives on, and renders what is clean.
    handle.update('<p id="k">3</p>');
    expect(text('k')).toBe('3');
    handles.pop()!.unmount();

    // On a first render, through the write itself: the root is left free.
    const replace = Element.prototype.replaceChildren;
    const replacing = vi.spyOn(Element.prototype, 'replaceChildren').mockImplementation(function (this: Element, ...nodes: (Node | string)[]) {
      replace.apply(this, nodes);
      if (nodes.length > 0 && this === root) plant(this);
    });
    thrown = null;
    try { mountOn(root, '<p id="k">4</p>', { tier: 'unreviewed' }); } catch (err) { thrown = err as Error; }
    replacing.mockRestore();
    expect(thrown?.code).toBe('FORMA_E_UNREVIEWED_LINK');
    expect(root.childNodes).toHaveLength(0);
    handles.pop();
    mountOn(root, '<p id="k">5</p>', { tier: 'unreviewed' });
    expect(text('k')).toBe('5');
  });

  it('a mount call names a known tier, an element and markup, and mounts a root once', () => {
    const root = page();
    for (const bad of [
      () => mountMarkup(root, '', {} as MountOptions),
      () => mountMarkup(root, '', { tier: 'trusted' } as unknown as MountOptions),
      () => mountMarkup(null as unknown as Element, '', { tier: 'reviewed' }),
      () => mountMarkup(root, 7 as unknown as string, { tier: 'reviewed' }),
      () => mountMarkup(root, '', { tier: 'reviewed', grants: { fetch: {} as never } }),
      () => mountMarkup(root, '', { tier: 'reviewed', grants: { fetch: { paths: ['api/'] } } }),
      () => mountMarkup(root, '', { tier: 'reviewed', grants: { fetch: { paths: ['/'], methods: ['TRACE' as never] } } }),
      () => mountMarkup(root, '', { tier: 'reviewed', config: { exprBudget: -1 } }),
    ]) {
      expect(bad).toThrow(/FORMA_E_MOUNT_ARGS/);
    }
    mountOn(root, probe('1'), { tier: 'compiled' });
    expect(() => mountMarkup(root, '', { tier: 'compiled' })).toThrow(/FORMA_E_MOUNT_TWICE/);
  });

  it('bindings a tierless path made under the root go first, with what they rendered', () => {
    const root = page();
    root.innerHTML = `<div data-forma-state='{"n":0}'><button id="old" data-on:click="{n++}">+</button><p id="old-n" data-text="{n}">-</p></div>`;
    runtime.mount(root);
    const old = document.getElementById('old')!;
    const oldN = document.getElementById('old-n')!;
    old.click();
    expect(oldN.textContent).toBe('1');

    mountOn(root, probe('1 + 1'), { tier: 'reviewed', grants: {} });
    expect(text('out')).toBe('2');
    expect(root.contains(old)).toBe(false);
    // The tierless bindings were disposed, not left running on detached nodes.
    old.click();
    expect(oldN.textContent).toBe('1');
  });

  it('takes trustedHtml() markup beside a string, and nothing else', () => {
    const root = page();
    const handle = mountOn(root, runtime.trustedHtml(probe('6 * 7')), { tier: 'reviewed', grants: {} });
    expect(text('out')).toBe('42');
    handle.update(runtime.trustedHtml(`<div data-forma-state='{"v":"next"}'><p id="out" data-text="{v}">-</p></div>`));
    expect(text('out')).toBe('next');
    const lookAlike = { toString: () => probe('1') } as unknown as string;
    expect(() => handle.update(lookAlike)).toThrow(/FORMA_E_MOUNT_ARGS/);
    expect(text('out')).toBe('next');
  });

  it('unmount() disposes every binding and empties the root; update() after it throws', () => {
    const root = page();
    const handle = mountOn(root, `<div data-forma-state='{"n":0}'><button id="inc" data-on:click="{n++}">+</button><p id="n" data-text="{n}">-</p></div>`, {
      tier: 'reviewed',
    });
    const button = document.getElementById('inc')!;
    const p = document.getElementById('n')!;
    button.click();
    expect(p.textContent).toBe('1');
    handle.unmount();
    expect(root.childNodes.length).toBe(0);
    // The detached nodes are no longer bound.
    button.click();
    expect(p.textContent).toBe('1');
    expect(() => handle.update(probe('1'))).toThrow(/FORMA_E_MOUNT_GONE/);
    // The root can be mounted again.
    mountOn(root, probe('40 + 2'), { tier: 'reviewed' });
    expect(text('out')).toBe('42');
  });

  it('a tiered mount ignores the page directive map', () => {
    const root = page();
    runtime.setDirectiveMap({ w: ['data-show'] });
    try {
      mountOn(
        root,
        `<div data-forma-state='{}'><p id="out" data-forma-id="w" data-text="{'bound'}">initial</p>` +
          `<p id="unmapped" data-text="{'also bound'}">initial</p></div>`,
        { tier: 'reviewed' },
      );
      expect(text('out')).toBe('bound');
      expect(text('unmapped')).toBe('also bound');
    } finally {
      runtime.setDirectiveMap(null);
    }
  });
});

describe('configuration only from the call', () => {
  // 50,000 callbacks: about 100,000 steps, inside the allocation budget.
  const heavy = 'Array.from({length: 50000}).map((x, i) => i).length';

  it('a tiered mount takes its step budget from its call, never from a script tag', async () => {
    // A page that raises the budget a hundredfold on a script tag, as
    // `data-forma-expr-budget` allows, loading a fresh copy of the runtime.
    const script = document.createElement('script');
    script.setAttribute('data-forma-expr-budget', '10000000');
    document.head.appendChild(script);
    vi.resetModules();
    const fresh = await import('../runtime');
    try {
      document.body.innerHTML = '<div id="legacy"></div><div id="tiered"></div><div id="configured"></div>';
      const legacy = document.getElementById('legacy')!;
      legacy.innerHTML = `<div data-forma-state='{}'><p id="l" data-text="{${heavy}}">-</p></div>`;
      fresh.mount(legacy);
      expect(text('l')).toBe('50000');

      await new Promise((r) => setTimeout(r, 0)); // a fresh task: a fresh meter
      const tiered = fresh.mountMarkup(document.getElementById('tiered')!, `<div data-forma-state='{}'><p id="t" data-text="{${heavy}}">-</p></div>`, {
        tier: 'reviewed',
      });
      expect(text('t')).toBe('-');
      expect(fresh.getDiagnostics().map((d) => d.code)).toContain('FORMA_E_BUDGET');

      await new Promise((r) => setTimeout(r, 0));
      const configured = fresh.mountMarkup(
        document.getElementById('configured')!,
        `<div data-forma-state='{}'><p id="c" data-text="{${heavy}}">-</p></div>`,
        { tier: 'reviewed', config: { exprBudget: 1_000_000 } },
      );
      expect(text('c')).toBe('50000');
      tiered.unmount();
      configured.unmount();
      fresh.unmount(legacy);
    } finally {
      fresh.destroyRuntime();
      script.remove();
      vi.resetModules();
    }
  });
});

describe('the tierless reconcile() keeps 2.0.x', () => {
  const LOGGED = Symbol.for('@getforma/core#deprecations');

  it('reconcile behaves as at 2.0.x and warns once in development', async () => {
    delete (globalThis as Record<symbol, unknown>)[LOGGED];
    const warn = vi.mocked(console.warn);
    answers(404, { error: 'missing' });
    page();
    const container = document.getElementById('root')!;
    const markup =
      `<div data-forma-state='{}'><div data-fetch="GET /api/items → items |error:failed"></div>` +
      `<p id="reach" data-text="{$el.closest('section').getAttribute('data-secret')}">-</p>` +
      `<p id="items" data-text="{items?.error}">-</p><p id="failed" data-text="{failed}">-</p></div>`;
    runtime.reconcile(container, markup);
    await settle();
    // Every power, as at 2.0.x: the page's attribute, and a 404's body as data.
    expect(text('reach')).toBe('s3cret');
    expect(text('items')).toBe('missing');
    expect(text('failed')).toBe('');
    expect(denials()).toEqual([]);

    runtime.reconcile(container, markup.replace('items?.error', 'items?.error ?? 0'));
    const logged = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('FORMA_W_DEPRECATED_RECONCILE'));
    expect(logged).toEqual([`[forma] FORMA_W_DEPRECATED_RECONCILE: ${DEPRECATIONS.FORMA_W_DEPRECATED_RECONCILE}`]);
    expect(logged[0]).toContain('mountMarkup(root, markup, { tier, grants })');
    runtime.unmount(container);
  });
});

// ---------------------------------------------------------------------------

const configs = rawConfig as Options[];

/** Build the real CDN runtime config (an IIFE), with `overrides`, and return its output. */
async function buildRuntimeIife(overrides: Options = {}): Promise<string> {
  const base = configs.find((c) => Object.keys(c.entry as Record<string, string>).includes('formajs-runtime'));
  if (!base) throw new Error('no tsup config emits formajs-runtime');
  const outDir = mkdtempSync(join(tmpdir(), 'forma-tiered-'));
  try {
    await build({ ...base, config: false, sourcemap: false, silent: true, outDir, ...overrides });
    return readFileSync(join(outDir, 'formajs-runtime.global.js'), 'utf8');
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

describe('the production build (the real tsup config)', () => {
  it("a production build carries neither the grant report nor reconcile's warning", { timeout: 120_000 }, async () => {
    const code = await buildRuntimeIife();
    expect(code).not.toContain('FORMA_W_DEPRECATED_RECONCILE');
    expect(code).not.toContain('grantReport');
    expect(code).not.toContain('sourceIsDev');
    // What enforces the grants is there: the build did not drop everything.
    expect(code).toContain('mountMarkup');
    expect(code).toContain('FORMA_E_GRANT_FETCH');
    expect(code).toContain('FORMA_E_GRANT_DOM');
  });

  it('a build without the production flag keeps them', { timeout: 120_000 }, async () => {
    // The control: nothing replaces `__FORMA_DEV_BUILD__`.
    const code = await buildRuntimeIife({ define: {} });
    expect(code).toContain('FORMA_W_DEPRECATED_RECONCILE');
    expect(code).toContain('grantReport');
  });
});
