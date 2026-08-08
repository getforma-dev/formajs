/**
 * FormaJS HTML Runtime
 *
 * Declarative reactive UI via data-* attributes, powered by fine-grained
 * signals (alien-signals 3.x). Zero build step required.
 *
 * CSP posture: EVERY build evaluates expressions with the allowlist AST
 * interpreter in src/expr/ — lexer, precedence-climbing parser, validator,
 * tree-walking interpreter. There is no eval(), no new Function() and no
 * opt-in switch that could reach one, in any artifact. An expression outside
 * the grammar is reported and NOT evaluated; the binding keeps whatever was
 * already in the DOM rather than writing an empty string.
 * Verified by: src/__tests__/runtime-csp-default.test.ts > "no build can reach new Function, with any configuration"
 * Verified by: src/__tests__/build-artifacts.test.ts > "no build emits new Function or a with() scope wrapper"
 *
 * Design inspirations:
 *   Alpine.js   — data-* directive model, progressive enhancement
 *   SolidJS     — fine-grained signals, [getter, setter] tuple, real DOM
 *   Qwik        — deferred hydration triggers (idle, interaction, visible)
 *   Astro       — islands architecture, independent interactive regions
 *   Hotwire     — server-driven UI, reconciler with scope modes
 *   Lit         — root element access during hydration, (el, props) pattern
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  Yes, this file is ~2,400 lines. It's a monolith on purpose.        │
 * │                                                                     │
 * │  The HTML Runtime is a self-contained unit: directive binding,      │
 * │  handler compilation, transition system, DOM scanner and observer   │
 * │  all share mutable state (debug flags, caches, config). Keeping     │
 * │  them in one file avoids circular imports, simplifies the build     │
 * │  (single IIFE for CDN), and means `grep` always finds what you      │
 * │  need. The sections are clearly marked — use the map below.         │
 * │                                                                     │
 * │  The expression language is the one thing that is NOT here: it      │
 * │  lives in src/expr/ because its security properties are stated as   │
 * │  "nothing outside this directory can reach X", and a directory is   │
 * │  a boundary a CI grep can check. See src/expr/__tests__/            │
 * │  no-escape-hatch.test.ts.                                           │
 * │                                                                     │
 * │  Will it be split further someday? Maybe. But today it works, it's  │
 * │  tested, and the CDN runtime bundle ships at ~31KB gzipped. If      │
 * │  you're judging the line count — fair. But read the code first. :)  │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * This file is the HTML Runtime — a subpath of @getforma/core:
 *   import '@getforma/core/runtime'          (ESM)
 *   <script src="...runtime.global.js">      (CDN)
 *
 * It is separate from the main @getforma/core entry point, which exports
 * signals, h(), mount, stores, etc. The main entry has zero network code.
 * HTTP/storage/server are at @getforma/core/http, /storage, /server.
 *
 * Usage (CDN — the pin below tracks the published package version):
 *   <script src="https://unpkg.com/@getforma/core@2.0.1/dist/formajs-runtime.global.js"></script>
 *   <div data-forma-state='{"count": 0}'>
 *     <p data-text="{count}"></p>
 *     <button data-on:click="{count++}">+1</button>
 *   </div>
 * Verified by: src/__tests__/docs-truth.test.ts > "the runtime header's CDN pin is the current package version"
 *
 * Build outputs from this source file:
 *   dist/runtime.js                        ESM (import '@getforma/core/runtime')
 *   dist/runtime.cjs                       CommonJS (require)
 *   dist/formajs-runtime.global.js         IIFE for <script> tags (auto-inits)
 *   dist/runtime-hardened.js               ESM, tree-shaken, no code splitting
 *   dist/formajs-runtime-hardened.global.js IIFE, tree-shaken, no code splitting
 *
 * The "hardened" pair is the same source. It was once the build with the
 * `new Function` fallback compiled out; the fallback is gone from every build,
 * so the only difference left is bundling strategy. Both names stay because
 * they are documented CDN URLs and exports-map targets.
 *
 * ── FILE MAP ──────────────────────────────────────────────────────────
 *
 * Search for the marker, not a line number. This map used to carry line
 * ranges; they were four sections out of date by the time anyone read them,
 * which is the failure mode of every hand-maintained line index. The names
 * below are the literal `// ── … ──` markers in this file, in order, and a
 * test fails if one is renamed, removed, or moved out of order.
 *
 *   Attribute safety & scope                  isUnsafeAttrBinding, Scope, createChildScope
 *   $refetch registry                         imperative data-fetch triggers
 *   Debug logger                              dbg(), window.__FORMA_DEBUG
 *   Configuration & diagnostics               RuntimeConfig, RuntimeDiagnostic
 *   Performance utilities                     yieldToMain, applyContainmentHints
 *   Pre-compiled regexes                      hot-path RegExp literals
 *   Per-scope evaluator cache                 compiled expression/handler reuse
 *   Compiled template cache                   data-list template compilation
 *   Parsing utilities                         readBalancedSegment
 *   Template text caching for data-list       clone + interpolate list rows
 *   CSS Transitions                           parse spec, enter/leave phases
 *   Expression evaluator                      buildEvaluator over src/expr
 *   Handler compiler                          buildHandler over src/expr
 *   State initialization                      parseState, initScope
 *   DOM scanner                               directive discovery
 *   Element binding                           bindElement — the directive processor
 *   Scope mounting / unmounting               mountScope, unmountScope
 *   Pre-compiled Directive Map                server-supplied directive sidecar
 *   MutationObserver                          auto-discovery of new scopes
 *   Main init                                 initRuntime/destroyRuntime, mount/unmount
 *   DevTools API — State Inspector            getScopes, setScopeValue, resetScope
 *   Reconciler                                createReconciler bridge, exports
 *
 * Verified by: src/__tests__/docs-truth.test.ts > "the runtime file map names every section marker, in order"
 *
 * ── SUPPORTED DIRECTIVES ──────────────────────────────────────────────
 *
 *   State & Reactivity:
 *     data-forma-state='{"key": val}'    Declare reactive state (valid JSON)
 *     data-computed="name = expr"        Derived value (lazy, cached)
 *     data-persist="{prop}"              Sync state to localStorage
 *
 *   Content Binding:
 *     data-text="{expr}"                 Bind text content
 *     data-show="{expr}"                 Toggle visibility (display: none)
 *     data-if="{expr}"                   Conditional render (remove/insert DOM)
 *     data-model="{prop}"                Two-way input binding
 *     data-list="{expr}"                 List rendering (keyed reconciliation)
 *
 *   Attributes & Classes:
 *     data-on:event="{expr}"             Event handler (e.g. data-on:click)
 *     data-class:name="{expr}"           Conditional CSS class
 *     data-bind:attr="{expr}"            Dynamic attribute binding
 *
 *   Transitions (for data-show and data-if):
 *     data-transition:enter="classes"        Classes during enter phase
 *     data-transition:enter-from="classes"   Classes at enter start
 *     data-transition:enter-to="classes"     Classes at enter end
 *     data-transition:leave="classes"        Classes during leave phase
 *     data-transition:leave-from="classes"   Classes at leave start
 *     data-transition:leave-to="classes"     Classes at leave end
 *
 *   Refs:
 *     data-ref="name"                    Register element for $refs.name access
 *
 *   Data Fetching:
 *     data-fetch="GET /url → prop"       Fetch data into state
 *     data-fetch="POST /url → prop"      POST with state as body
 *     data-fetch-id="name"               Register for $refetch('name')
 *
 *   Configuration (on <script> tag):
 *     data-forma-diagnostics="true"      Enable expression diagnostics
 *     data-forma-auto-containment="true" Enable CSS containment hints
 *     data-forma-expr-budget="100000"    Per-evaluation interpreter step budget
 *
 * ── MAGIC VARIABLES ──────────────────────────────────────────────────
 *
 *   Available in all expressions and handlers:
 *     $el          The current DOM element, wrapped — reads and calls are
 *                  restricted to the tables in src/expr/allowlist.ts
 *     $dispatch    Fire a CustomEvent: $dispatch('name', detail?)
 *                  Events bubble and cross Shadow DOM (composed: true)
 *     $event       The DOM event object (in data-on:* handlers only)
 *     event        Alias for $event (also in data-on:* handlers)
 *     $refs        Named element references: $refs.myInput (via data-ref="myInput")
 *     $refetch     Re-trigger a data-fetch: $refetch('fetch-id')
 */
import { createSignal, internalEffect, createComputed, batch } from './reactive';
import { reconcileList, type ListTransitionHooks } from './dom/list';
import { createReconciler } from './dom/reconcile';
import { isDangerousUrl, isUrlAttr, isEventHandlerAttr } from './security/url-safety';
import {
  clearExpressionCache,
  compileExpression,
  compileHandler,
  evaluateExpression,
  hostFn,
  hostObject,
  isExprError,
  runHandler,
  setStepBudget,
  type FormaExprError,
} from './expr';

// ── Attribute safety & scope ──

/**
 * True if writing `value` to attribute `name` on a `<tag>` element via
 * setAttribute would create an XSS sink: an `on*` inline event handler, or a
 * URL attribute carrying a script-executing scheme. Shared by data-bind:* and
 * list-template binding.
 *
 * `tag` is the lower-case name of the element receiving the attribute and is
 * always passed: `isDangerousUrl` needs it to tell a `data:image/svg+xml` that
 * is inert on an `<img>` from the same value on an `<a href>`, where it is a
 * navigable document.
 * Verified by: src/__tests__/runtime-bind-security.test.ts > "does not set a javascript: URL from data-bind:href"
 * Verified by: src/__tests__/runtime-bind-security.test.ts > "forwards the element tag to the URL scheme check"
 */
function isUnsafeAttrBinding(name: string, value: string, tag: string): boolean {
  if (isEventHandlerAttr(name)) return true;
  if (isUrlAttr(name) && isDangerousUrl(value, tag)) return true;
  return false;
}

type Getter = () => unknown;
type Setter = (v: unknown) => void;

interface Scope {
  getters: Record<string, Getter>;
  setters: Record<string, Setter>;
}

// ── $refetch registry ──
// Maps data-fetch-id values to their doFetch() functions so handlers can
// trigger imperative refetches via $refetch('id').
const _refetchRegistry = new Map<string, () => void>();

function $refetch(id: string): void {
  const fn = _refetchRegistry.get(id);
  if (fn) {
    fn();
  } else if (_debug) {
    dbg(`$refetch: no data-fetch with id "${id}" found`);
  }
}

function createChildScope(parent: Scope, locals: Record<string, unknown>): Scope {
  const localGetters: Record<string, Getter> = Object.create(null);
  for (const key of Object.keys(locals)) {
    localGetters[key] = () => locals[key];
  }

  return {
    getters: new Proxy(parent.getters, {
      get(target, prop: string) {
        if (prop in localGetters) return localGetters[prop];
        return target[prop];
      },
      has(target, prop: string) {
        return prop in localGetters || prop in target;
      },
    }),
    setters: parent.setters,
  };
}

// ── Debug logger — enable via FormaRuntime.debug = true or window.__FORMA_DEBUG = true ──
let _debug = false;

// ── Configuration & diagnostics ──

let _diagnosticsEnabled = true;
function dbg(...args: unknown[]): void {
  if (_debug || (typeof window !== 'undefined' && (window as any).__FORMA_DEBUG)) {
    console.log('[FormaJS]', ...args);
  }
}

interface RuntimeConfig {
  diagnostics?: boolean;
  autoContainment?: boolean;
  /** Per-evaluation interpreter step budget (`data-forma-expr-budget`). */
  exprBudget?: number;
}

interface RuntimeDiagnostic {
  kind: 'handler-unsupported' | 'expression-unsupported';
  expr: string;
  reason: string;
  /** Stable machine-readable cause, e.g. `FORMA_E_METHOD_DENIED`. */
  code: string;
  count: number;
  firstSeenAt: number;
  lastSeenAt: number;
}

const diagnostics = new Map<string, RuntimeDiagnostic>();

function parseBooleanFlag(raw: string | null | undefined): boolean | undefined {
  if (raw == null) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no') return false;
  return undefined;
}

// Script attributes that carry runtime configuration. Used to locate the
// configuring <script> in module builds, where document.currentScript is null.
const CONFIG_SCRIPT_SELECTOR = [
  'script[data-forma-diagnostics]',
  'script[data-forma-auto-containment]',
  'script[data-forma-expr-budget]',
].join(',');

/**
 * The <script> tag that configures the runtime.
 *
 * `document.currentScript` is the right answer for the IIFE builds, but it is
 * null by spec while a `<script type="module">` runs — so the ESM builds
 * (dist/runtime.js) would ignore every `data-forma-*` switch. Falling back to
 * the first script tag that carries one keeps the switches working identically
 * in every build. Module scripts are deferred, so the whole document is parsed
 * by the time this runs. Anyone who can add such a script tag can already run
 * script on the page, so the fallback grants no new capability.
 * Verified by: src/__tests__/runtime-csp-default.test.ts > "honours a data-forma-* script attribute when document.currentScript is null (ESM builds)"
 */
function findConfigScript(): HTMLScriptElement | null {
  const current = document.currentScript as HTMLScriptElement | null;
  if (current) return current;
  return document.querySelector(CONFIG_SCRIPT_SELECTOR) as HTMLScriptElement | null;
}

function readRuntimeConfig(): RuntimeConfig {
  const config: RuntimeConfig = {};

  if (typeof window !== 'undefined') {
    const globalConfig = (window as any).__FORMA_RUNTIME_CONFIG as RuntimeConfig | undefined;
    if (globalConfig) {
      if (typeof globalConfig.exprBudget === 'number') {
        config.exprBudget = globalConfig.exprBudget;
      }
      if (typeof globalConfig.diagnostics === 'boolean') {
        config.diagnostics = globalConfig.diagnostics;
      }
      if (typeof globalConfig.autoContainment === 'boolean') {
        config.autoContainment = globalConfig.autoContainment;
      }
    }
  }

  if (typeof document !== 'undefined') {
    const script = findConfigScript();
    if (script) {
      const budgetFromAttr = Number(script.getAttribute('data-forma-expr-budget'));
      if (Number.isFinite(budgetFromAttr) && budgetFromAttr > 0) {
        config.exprBudget = budgetFromAttr;
      }
      const diagnosticsFromAttr = parseBooleanFlag(script.getAttribute('data-forma-diagnostics'));
      if (diagnosticsFromAttr !== undefined) {
        config.diagnostics = diagnosticsFromAttr;
      }
      const containmentFromAttr = parseBooleanFlag(script.getAttribute('data-forma-auto-containment'));
      if (containmentFromAttr !== undefined) {
        config.autoContainment = containmentFromAttr;
      }
    }
  }

  return config;
}

function reportDiagnostic(
  kind: RuntimeDiagnostic['kind'],
  expr: string,
  reason: string,
  code = 'FORMA_E_UNSUPPORTED',
): void {
  if (!_diagnosticsEnabled) return;

  const key = `${kind}|${reason}|${expr}`;
  const now = Date.now();
  const existing = diagnostics.get(key);

  if (existing) {
    // Seen before: count it and say nothing. A 1,000-row list sharing one
    // denied expression must not produce 1,000 console lines or 1,000
    // CustomEvents — the running total is on the record, for anyone who wants
    // it, via getDiagnostics().
    existing.count += 1;
    existing.lastSeenAt = now;
    return;
  }

  diagnostics.set(key, {
    kind,
    expr,
    reason,
    code,
    count: 1,
    firstSeenAt: now,
    lastSeenAt: now,
  });
  console.warn(`[FormaJS] ${reason}: ${expr}`);

  try {
    if (typeof window !== 'undefined') {
      const detail = { kind, expr, reason, code, count: 1 };
      window.dispatchEvent(new CustomEvent('formajs:diagnostic', { detail }));
    }
  } catch {
    // Ignore event dispatch failures
  }
}

const runtimeConfig = readRuntimeConfig();
if (typeof runtimeConfig.exprBudget === 'number') {
  setStepBudget(runtimeConfig.exprBudget);
}
if (typeof runtimeConfig.diagnostics === 'boolean') {
  _diagnosticsEnabled = runtimeConfig.diagnostics;
}
const _autoContainment = runtimeConfig.autoContainment === true;

// ── Performance utilities ──

interface SchedulerLike {
  yield?: () => Promise<unknown>;
  postTask?: (
    callback: () => void,
    options?: { priority?: 'user-blocking' | 'user-visible' | 'background' },
  ) => Promise<unknown>;
}

function getScheduler(): SchedulerLike | undefined {
  const candidate = (globalThis as any)?.scheduler as SchedulerLike | undefined;
  if (!candidate) return undefined;
  if (typeof candidate.yield === 'function' || typeof candidate.postTask === 'function') {
    return candidate;
  }
  return undefined;
}

/** Yield control to keep the main thread responsive during large batches. */
async function yieldToMain(): Promise<void> {
  const scheduler = getScheduler();
  if (scheduler?.yield) {
    await scheduler.yield();
    return;
  }
  if (scheduler?.postTask) {
    await scheduler.postTask(() => {}, { priority: 'background' });
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

interface ContainmentHintsOptions {
  selector?: string;
  contain?: string;
  contentVisibility?: string;
  containIntrinsicSize?: string;
  skipIfAlreadySet?: boolean;
}

/** Apply CSS containment hints to opt-in containers for lower layout/paint cost. */
function applyContainmentHints(
  root: ParentNode = document,
  options: ContainmentHintsOptions = {},
): number {
  const selector = options.selector ?? '[data-forma-contain]';
  if (!selector) return 0;
  if (typeof (root as ParentNode).querySelectorAll !== 'function') return 0;

  const nodes = root.querySelectorAll(selector);
  let applied = 0;
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i] as HTMLElement;
    if (!el?.style) continue;

    const contain = el.getAttribute('data-forma-contain') ?? options.contain ?? 'layout style paint';
    const contentVisibility = el.getAttribute('data-forma-content-visibility')
      ?? options.contentVisibility
      ?? 'auto';
    const containIntrinsicSize = el.getAttribute('data-forma-contain-intrinsic-size')
      ?? options.containIntrinsicSize
      ?? 'auto 800px';
    const skipExisting = options.skipIfAlreadySet === true;
    let changed = false;

    const containCurrent = el.style.getPropertyValue('contain');
    const contentVisCurrent = el.style.getPropertyValue('content-visibility');
    const containSizeCurrent = el.style.getPropertyValue('contain-intrinsic-size');

    if (contain !== 'off' && (!skipExisting || !containCurrent)) {
      el.style.setProperty('contain', contain);
      changed = true;
    }
    if (contentVisibility !== 'off' && (!skipExisting || !contentVisCurrent)) {
      el.style.setProperty('content-visibility', contentVisibility);
      changed = true;
    }
    if (containIntrinsicSize !== 'off' && (!skipExisting || !containSizeCurrent)) {
      el.style.setProperty('contain-intrinsic-size', containIntrinsicSize);
      changed = true;
    }

    if (changed) applied++;
  }

  if (_debug && applied > 0) {
    dbg('applyContainmentHints: applied to', applied, 'element(s)');
  }
  return applied;
}

// ── Pre-compiled regexes (avoid re-creation in hot paths) ──

const RE_STRIP_BRACES = /^\{|\}$/g;
// RE_UNQUOTED_KEYS removed in v0.5.0 — relaxed JSON parsing corrupted URLs
// and string values containing colons. Use valid JSON in data-forma-state.
const RE_COMPUTED = /^(\w+)\s*=\s*(.+)$/;
const RE_FETCH = /^(.+?)(?:→|->)\s*(\S+)(.*)$/;
const RE_FETCH_METHOD = /^(GET|POST|PUT|PATCH|DELETE)\s+(.+)$/i;
const RE_STRIP_ITEM_BRACES = /^\{item\.?|\}$/g;

interface TransitionSpec {
  enter: string[];
  enterFrom: string[];
  enterTo: string[];
  leave: string[];
  leaveFrom: string[];
  leaveTo: string[];
  enterDurationMs?: number;
  leaveDurationMs?: number;
}

interface ElementTransitionState {
  token: number;
  cancel: (() => void) | null;
}

const TRANSITION_STATE_SYM = Symbol.for('forma-transition-state');

// ── Per-scope evaluator cache ──
interface HandlerBuildResult {
  handler: (e: Event) => void;
  supported: boolean;
}

// Compiling an expression is scope-independent (src/expr caches the AST by
// source text), but the CLOSURE that binds it to a scope is not, so it is
// memoised per scope — one entry per (scope, expression) instead of one per
// (scope, expression, evaluation).
const scopeExpressionCache = new WeakMap<Scope, Map<string, () => unknown>>();
const scopeHandlerCache = new WeakMap<Scope, Map<string, HandlerBuildResult>>();

// ── Compiled template cache ──
// Pre-splits template text into static/dynamic segments for fast re-evaluation.
interface CompiledTemplate {
  statics: string[];
  dynamics: string[]; // expression strings between {item.xxx}
  hasItemRef: boolean;
}

const compiledTemplateCache = new Map<string, CompiledTemplate>();
const COMPILED_TEMPLATE_CACHE_MAX = 2048;
function cacheCompiledTemplate(key: string, template: CompiledTemplate): void {
  if (compiledTemplateCache.size >= COMPILED_TEMPLATE_CACHE_MAX) {
    // Evict oldest entry (first inserted)
    const first = compiledTemplateCache.keys().next().value;
    if (first !== undefined) compiledTemplateCache.delete(first);
  }
  compiledTemplateCache.set(key, template);
}
const TEXT_BINDING_SYM = Symbol.for('forma-text-binding-cache');

interface TextBindingCache {
  initialized: boolean;
  last: string;
  node: Text | null;
}

function toTextValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'symbol') return value.toString();
  return String(value);
}

function setElementTextFast(el: Element, next: string): void {
  let cache = (el as any)[TEXT_BINDING_SYM] as TextBindingCache | undefined;
  if (!cache) {
    cache = { initialized: false, last: '', node: null };
    (el as any)[TEXT_BINDING_SYM] = cache;
  }

  if (cache.initialized && cache.last === next) return;

  // Reuse direct text-node writes when this element is a single text child.
  let node = cache.node;
  if (!node || node.parentNode !== el || el.childNodes.length !== 1 || el.firstChild !== node) {
    if (el.childNodes.length === 1 && el.firstChild?.nodeType === Node.TEXT_NODE) {
      node = el.firstChild as Text;
      cache.node = node;
    } else {
      el.textContent = next;
      const first = el.firstChild;
      cache.node = (first && first.nodeType === Node.TEXT_NODE && el.childNodes.length === 1)
        ? (first as Text)
        : null;
      cache.last = next;
      cache.initialized = true;
      return;
    }
  }

  node.data = next;
  cache.last = next;
  cache.initialized = true;
}

// ── Parsing utilities ──

function readBalancedSegment(
  input: string,
  start: number,
  open: string,
  close: string,
): { inner: string; end: number } | null {
  if (input[start] !== open) return null;

  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escaped = false;

  for (let i = start; i < input.length; i++) {
    const ch = input[i]!;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\' && (inSingle || inDouble || inTemplate)) {
      escaped = true;
      continue;
    }

    if (inSingle) {
      if (ch === '\'') inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '"') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (ch === '`') inTemplate = false;
      continue;
    }

    if (ch === '\'') {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      continue;
    }

    if (ch === open) {
      depth++;
      continue;
    }
    if (ch === close) {
      depth--;
      if (depth === 0) {
        return {
          inner: input.slice(start + 1, i),
          end: i,
        };
      }
    }
  }

  return null;
}

function compileTemplate(text: string): CompiledTemplate {
  const cached = compiledTemplateCache.get(text);
  if (cached) return cached;

  const statics: string[] = [];
  const dynamics: string[] = [];
  let lastIndex = 0;
  // Use a fresh regex each time since it has the 'g' flag
  const re = /\{item\.?(\w*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    statics.push(text.slice(lastIndex, m.index));
    dynamics.push(m[1]!); // the key after "item." (empty string means whole item)
    lastIndex = re.lastIndex;
  }
  statics.push(text.slice(lastIndex));

  const result: CompiledTemplate = {
    statics,
    dynamics,
    hasItemRef: dynamics.length > 0,
  };
  cacheCompiledTemplate(text, result);
  return result;
}

// ── Template text caching for data-list ──

/** Maps text nodes to their compiled template (pre-split static/dynamic segments). */
const templateTexts = new WeakMap<Node, CompiledTemplate>();

/**
 * Evaluate a pre-compiled template against an item.
 * Only evaluates dynamic parts and concatenates with static segments.
 */
function evaluateCompiledTemplate(compiled: CompiledTemplate, item: unknown): string {
  if (!compiled.hasItemRef) return compiled.statics[0]!;
  let result = compiled.statics[0]!;
  for (let i = 0; i < compiled.dynamics.length; i++) {
    const key = compiled.dynamics[i]!;
    if (!key) {
      result += typeof item === 'object' ? JSON.stringify(item) : String(item ?? '');
    } else {
      result += String((item as Record<string, unknown>)?.[key] ?? '');
    }
    result += compiled.statics[i + 1] ?? '';
  }
  return result;
}

/**
 * Clone a template element and apply item data to all text node placeholders.
 * Stores the original template text in a WeakMap so updates can re-apply without re-cloning.
 */
function cloneWithTemplateData(template: Element, item: unknown): Element {
  const clone = template.cloneNode(true) as Element;
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.textContent ?? '';
    if (text.includes('{item')) {
      const compiled = compileTemplate(text);
      templateTexts.set(node, compiled); // Store compiled template
      node.textContent = evaluateCompiledTemplate(compiled, item);
    }
  }
  // Also process attributes (e.g. data-key, href, src, etc.)
  cloneAttributeTemplates(clone, item);
  return clone;
}

/**
 * Update an existing cloned element's text nodes with new item data.
 * Uses the cached original template patterns from the WeakMap.
 */
function updateTemplateData(el: Element, item: unknown): void {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const compiled = templateTexts.get(node);
    if (compiled) {
      node.textContent = evaluateCompiledTemplate(compiled, item);
    }
  }
}

/** WeakMap for caching compiled attribute templates */
const templateAttrs = new WeakMap<Element, Array<{ attr: string; compiled: CompiledTemplate }>>();

/**
 * Process attribute templates on a cloned element and its descendants.
 * Pre-compiles patterns and resolves them with item data.
 */
/** Directive attribute names/prefixes that bindElement processes — these must NOT be
 *  template-interpolated by cloneAttributeTemplates because their values will be
 *  evaluated by the reactive binding system using the child scope. */
const DIRECTIVE_ATTR_PREFIXES = [
  'data-list', 'data-show', 'data-text', 'data-if', 'data-model',
  'data-on:', 'data-class:', 'data-bind:', 'data-computed', 'data-persist', 'data-fetch',
  'data-transition', 'data-transition:',
];
function isDirectiveAttr(name: string): boolean {
  for (const prefix of DIRECTIVE_ATTR_PREFIXES) {
    if (name === prefix || name.startsWith(prefix)) return true;
  }
  return false;
}

function splitClassTokens(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .trim()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

// ── CSS Transitions ──

function parseDurationTokenMs(token: string): number | null {
  const t = token.trim().toLowerCase();
  if (t.endsWith('ms')) {
    const n = Number(t.slice(0, -2));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  if (t.endsWith('s')) {
    const n = Number(t.slice(0, -1));
    return Number.isFinite(n) && n >= 0 ? n * 1000 : null;
  }
  return null;
}

function parseClassTokensAndDuration(raw: string | null): { classes: string[]; durationMs?: number } {
  const classes: string[] = [];
  let durationMs: number | undefined;
  for (const token of splitClassTokens(raw)) {
    const parsed = parseDurationTokenMs(token);
    if (parsed != null) {
      durationMs = parsed;
    } else {
      classes.push(token);
    }
  }
  return { classes, durationMs };
}

function uniqueTokens(tokens: string[]): string[] {
  return Array.from(new Set(tokens.filter(Boolean)));
}

function parseCssTimeListMs(raw: string): number[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((part) => parseDurationTokenMs(part.trim()))
    .filter((ms): ms is number => ms != null);
}

function maxCombinedTimingsMs(durations: number[], delays: number[]): number {
  if (durations.length === 0 && delays.length === 0) return 0;
  if (durations.length === 0) return Math.max(...delays, 0);
  if (delays.length === 0) return Math.max(...durations, 0);

  const len = Math.max(durations.length, delays.length);
  let max = 0;
  for (let i = 0; i < len; i++) {
    const d = durations[i % durations.length] ?? 0;
    const delay = delays[i % delays.length] ?? 0;
    if (d + delay > max) max = d + delay;
  }
  return max;
}

function resolveTransitionDurationMs(el: HTMLElement, explicitMs?: number): number {
  if (typeof explicitMs === 'number') return explicitMs;
  const cs = window.getComputedStyle(el);
  const trans = maxCombinedTimingsMs(
    parseCssTimeListMs(cs.transitionDuration),
    parseCssTimeListMs(cs.transitionDelay),
  );
  const anim = maxCombinedTimingsMs(
    parseCssTimeListMs(cs.animationDuration),
    parseCssTimeListMs(cs.animationDelay),
  );
  return Math.max(trans, anim);
}

function getTransitionState(el: HTMLElement): ElementTransitionState {
  const existing = (el as any)[TRANSITION_STATE_SYM] as ElementTransitionState | undefined;
  if (existing) return existing;
  const created: ElementTransitionState = { token: 0, cancel: null };
  (el as any)[TRANSITION_STATE_SYM] = created;
  return created;
}

function clearTransitionState(el: HTMLElement): void {
  const state = (el as any)[TRANSITION_STATE_SYM] as ElementTransitionState | undefined;
  if (state?.cancel) {
    state.cancel();
  }
  delete (el as any)[TRANSITION_STATE_SYM];
}

function parseTransitionSpec(el: Element): TransitionSpec | null {
  const hasTransitionAttr = el.hasAttribute('data-transition')
    || Array.from(el.attributes).some((a) => a.name.startsWith('data-transition:'));
  if (!hasTransitionAttr) return null;

  const base = parseClassTokensAndDuration(el.getAttribute('data-transition')).classes;

  const enter = parseClassTokensAndDuration(el.getAttribute('data-transition:enter'));
  const leave = parseClassTokensAndDuration(el.getAttribute('data-transition:leave'));
  const enterFrom = splitClassTokens(
    el.getAttribute('data-transition:enter-from')
    ?? el.getAttribute('data-transition:enter-start'),
  );
  const enterTo = splitClassTokens(
    el.getAttribute('data-transition:enter-to')
    ?? el.getAttribute('data-transition:enter-end'),
  );
  const leaveFrom = splitClassTokens(
    el.getAttribute('data-transition:leave-from')
    ?? el.getAttribute('data-transition:leave-start'),
  );
  const leaveTo = splitClassTokens(
    el.getAttribute('data-transition:leave-to')
    ?? el.getAttribute('data-transition:leave-end'),
  );

  const durationBoth = parseDurationTokenMs(el.getAttribute('data-transition:duration') ?? '');
  const enterDuration = parseDurationTokenMs(el.getAttribute('data-transition:duration-enter') ?? '')
    ?? enter.durationMs
    ?? durationBoth
    ?? undefined;
  const leaveDuration = parseDurationTokenMs(el.getAttribute('data-transition:duration-leave') ?? '')
    ?? leave.durationMs
    ?? durationBoth
    ?? undefined;

  return {
    enter: uniqueTokens([...base, ...enter.classes]),
    enterFrom: uniqueTokens(enterFrom),
    enterTo: uniqueTokens(enterTo),
    leave: uniqueTokens([...base, ...leave.classes]),
    leaveFrom: uniqueTokens(leaveFrom),
    leaveTo: uniqueTokens(leaveTo),
    enterDurationMs: enterDuration,
    leaveDurationMs: leaveDuration,
  };
}

function removeClasses(el: Element, classes: string[]): void {
  for (const cls of classes) {
    el.classList.remove(cls);
  }
}

function addClasses(el: Element, classes: string[]): void {
  for (const cls of classes) {
    el.classList.add(cls);
  }
}

function runTransitionPhase(
  el: HTMLElement,
  phaseClasses: { base: string[]; from: string[]; to: string[]; durationMs?: number },
  onDone: () => void,
): () => void {
  const cleanupClasses = uniqueTokens([
    ...phaseClasses.base,
    ...phaseClasses.from,
    ...phaseClasses.to,
  ]);

  let done = false;
  let timeoutId: number | null = null;
  let raf1: number | null = null;
  let raf2: number | null = null;

  const finish = () => {
    if (done) return;
    done = true;
    if (timeoutId != null) window.clearTimeout(timeoutId);
    if (raf1 != null) cancelAnimationFrame(raf1);
    if (raf2 != null) cancelAnimationFrame(raf2);
    removeClasses(el, cleanupClasses);
    onDone();
  };

  addClasses(el, phaseClasses.base);
  addClasses(el, phaseClasses.from);
  removeClasses(el, phaseClasses.to);

  raf1 = requestAnimationFrame(() => {
    raf2 = requestAnimationFrame(() => {
      if (done) return;
      removeClasses(el, phaseClasses.from);
      addClasses(el, phaseClasses.to);

      const ms = resolveTransitionDurationMs(el, phaseClasses.durationMs);
      if (ms <= 0) {
        finish();
        return;
      }
      timeoutId = window.setTimeout(finish, ms + 25);
    });
  });

  return finish;
}

/**
 * Insert an element into the DOM and optionally run an enter transition.
 * The element is functional immediately — the animation is purely visual.
 */
function transitionInsert(
  el: HTMLElement,
  parent: Node,
  ref: Node | null,
  spec: TransitionSpec | null,
): void {
  parent.insertBefore(el, ref);
  if (!spec) return;

  const state = getTransitionState(el);
  state.token += 1;
  const token = state.token;
  if (state.cancel) state.cancel();

  state.cancel = runTransitionPhase(
    el,
    {
      base: spec.enter,
      from: spec.enterFrom,
      to: spec.enterTo,
      durationMs: spec.enterDurationMs,
    },
    () => {
      const current = getTransitionState(el);
      if (current.token === token) current.cancel = null;
    },
  );
}

/**
 * Run a leave transition on an element, then call onDone when complete.
 * Sets data-forma-leaving immediately so the element is excluded from diffs.
 * If no transition spec, calls onDone synchronously.
 */
function transitionRemove(
  el: HTMLElement,
  spec: TransitionSpec | null,
  onDone: () => void,
): void {
  // Guard: if already leaving, don't start another leave
  if (el.hasAttribute('data-forma-leaving')) {
    onDone();
    return;
  }

  if (!spec) {
    onDone();
    return;
  }

  el.setAttribute('data-forma-leaving', '');

  const state = getTransitionState(el);
  state.token += 1;
  const token = state.token;
  if (state.cancel) state.cancel();

  state.cancel = runTransitionPhase(
    el,
    {
      base: spec.leave,
      from: spec.leaveFrom,
      to: spec.leaveTo,
      durationMs: spec.leaveDurationMs,
    },
    () => {
      const current = getTransitionState(el);
      if (current.token === token) current.cancel = null;
      el.removeAttribute('data-forma-leaving');
      onDone();
    },
  );
}

function applyShowVisibility(
  el: HTMLElement,
  visible: boolean,
  transition: TransitionSpec | null,
  initial: boolean,
): void {
  if (!transition || initial) {
    el.style.display = visible ? '' : 'none';
    if (transition) {
      removeClasses(el, uniqueTokens([
        ...transition.enter, ...transition.enterFrom, ...transition.enterTo,
        ...transition.leave, ...transition.leaveFrom, ...transition.leaveTo,
      ]));
    }
    return;
  }

  const state = getTransitionState(el);
  state.token += 1;
  const token = state.token;
  if (state.cancel) state.cancel();
  state.cancel = null;

  if (visible) {
    el.style.display = '';
    state.cancel = runTransitionPhase(
      el,
      {
        base: transition.enter,
        from: transition.enterFrom,
        to: transition.enterTo,
        durationMs: transition.enterDurationMs,
      },
      () => {
        const current = getTransitionState(el);
        if (current.token === token) current.cancel = null;
      },
    );
    return;
  }

  state.cancel = runTransitionPhase(
    el,
    {
      base: transition.leave,
      from: transition.leaveFrom,
      to: transition.leaveTo,
      durationMs: transition.leaveDurationMs,
    },
    () => {
      const current = getTransitionState(el);
      if (current.token !== token) return;
      el.style.display = 'none';
      current.cancel = null;
    },
  );
}

function cloneAttributeTemplates(el: Element, item: unknown): void {
  const all = [el, ...Array.from(el.querySelectorAll('*'))];
  for (const node of all) {
    const entries: Array<{ attr: string; compiled: CompiledTemplate }> = [];
    for (const attr of Array.from(node.attributes)) {
      // Skip directive attributes — they'll be evaluated by bindElement with the child scope
      if (isDirectiveAttr(attr.name)) continue;
      if (attr.value.includes('{item')) {
        const compiled = compileTemplate(attr.value);
        entries.push({ attr: attr.name, compiled });
        const value = evaluateCompiledTemplate(compiled, item);
        if (isUnsafeAttrBinding(attr.name, value, node.tagName.toLowerCase())) {
          node.removeAttribute(attr.name);
        } else {
          node.setAttribute(attr.name, value);
        }
      }
    }
    if (entries.length > 0) {
      templateAttrs.set(node, entries);
    }
  }
}

// ── Expression evaluator ──

function getScopeCache<T>(cache: WeakMap<Scope, Map<string, T>>, scope: Scope): Map<string, T> {
  let scoped = cache.get(scope);
  if (!scoped) {
    scoped = new Map<string, T>();
    cache.set(scope, scoped);
  }
  return scoped;
}

/**
 * Sentinel returned by a binding whose expression did not evaluate. It is a
 * unique symbol precisely so it cannot be confused with a legitimate
 * `undefined` — the whole failure model rests on those being distinguishable
 * (R1). Every directive checks for it and leaves the DOM alone.
 * Verified by: src/__tests__/failure-semantics.test.ts > "a denied expression leaves the previous text in place and never renders undefined"
 */
const EXPR_FAILED = Symbol('forma-expression-failed');

/** Strip one balanced `{ … }` wrapper, honouring string and template literals. */
function stripBraces(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return trimmed;
  const seg = readBalancedSegment(trimmed, 0, '{', '}');
  if (!seg || seg.end !== trimmed.length - 1) return trimmed;
  return seg.inner.trim();
}

/** The console half of a failure report: expression, cause, and the element. */
function logExprFailure(el: Element | null, expr: string, err: FormaExprError, what: string): void {
  const where = err.column >= 0 ? ` at column ${err.column + 1}` : '';
  const head = el ? `\n  on: ${el.outerHTML.slice(0, 120)}` : '';
  console.error(`[FormaJS] ${what} not evaluated${where}: ${expr}\n  ${err.code}: ${err.message}${head}`);
}

/**
 * A value expression could not be compiled or could not be evaluated. Both are
 * reported the same way — console error, `formajs:diagnostic`, an entry in
 * `getDiagnostics()` with a stable code, and a `data-forma-expr-error` marker
 * on the element — and in both cases the binding writes NOTHING.
 * Verified by: src/__tests__/failure-semantics.test.ts > "reports one diagnostic per distinct expression, however many elements share it"
 */
function reportExprFailure(el: Element | null, expr: string, err: FormaExprError): void {
  logExprFailure(el, expr, err, 'expression');
  reportDiagnostic('expression-unsupported', expr, err.message, err.code);
  el?.setAttribute('data-forma-expr-error', 'unsupported');
}

function reportHandlerFailure(el: Element | null, expr: string, err: FormaExprError): void {
  logExprFailure(el, expr, err, 'handler');
  reportDiagnostic('handler-unsupported', expr, err.message, err.code);
  el?.setAttribute('data-forma-handler-error', 'unsupported');
}

/**
 * Compile one value expression against a scope.
 *
 * Returns `null` when the expression is outside the grammar — already reported,
 * so the caller only has to decide what "no binding" looks like for its
 * directive. The returned closure THROWS `FormaExprError` on an evaluation-time
 * denial; it never answers `undefined` to mean "failed".
 */
function buildEvaluator(expr: string, scope: Scope, el: Element | null): (() => unknown) | null {
  const cleaned = stripBraces(expr);
  const cache = getScopeCache(scopeExpressionCache, scope);
  const cached = cache.get(cleaned);
  if (cached) return cached;

  let compiled;
  try {
    compiled = compileExpression(cleaned);
  } catch (err) {
    if (!isExprError(err)) throw err;
    reportExprFailure(el, cleaned, err);
    return null;
  }
  const run = () => evaluateExpression(compiled, scope);
  cache.set(cleaned, run);
  return run;
}

// ── Handler compiler ──

/**
 * Compile a `data-on:*` handler body: `;`-separated statements over the same
 * grammar, plus assignment, `++`/`--`, `if`/`else` and bare method calls.
 *
 * `$event` / `event` are not scope state — they exist only for the duration of
 * one dispatch — so they are bound through a child scope whose two locals are
 * refreshed on every invocation and restored afterwards. That keeps a
 * re-entrant dispatch correct and stops a compiled handler retaining the Event.
 * Verified by: src/__tests__/runtime-csp-default.test.ts > "does not leak the Event between dispatches"
 */
function buildHandler(expr: string, scope: Scope, el: Element | null): HandlerBuildResult {
  const cleaned = stripBraces(expr);
  const cache = getScopeCache(scopeHandlerCache, scope);
  const cached = cache.get(cleaned);
  if (cached) return cached;

  let program;
  try {
    program = compileHandler(cleaned);
  } catch (err) {
    if (!isExprError(err)) throw err;
    reportHandlerFailure(el, cleaned, err);
    const failed: HandlerBuildResult = { handler: () => {}, supported: false };
    cache.set(cleaned, failed);
    return failed;
  }

  const eventLocals: Record<string, unknown> = { $event: undefined, event: undefined };
  const eventScope = createChildScope(scope, eventLocals);

  const handler = (e: Event) => {
    const outer = eventLocals.$event;
    const wrapped = hostObject('event', e, '$event');
    eventLocals.$event = wrapped;
    eventLocals.event = wrapped;
    try {
      batch(() => runHandler(program, eventScope));
    } catch (err) {
      if (!isExprError(err)) throw err;
      reportHandlerFailure((e.currentTarget as Element | null) ?? el, cleaned, err);
    } finally {
      eventLocals.$event = outer;
      eventLocals.event = outer;
    }
  };

  const result: HandlerBuildResult = { handler, supported: true };
  cache.set(cleaned, result);
  return result;
}

// ── State initialization ──

const FORBIDDEN_STATE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Parse a `data-forma-state` attribute into the plain object a scope is built
 * from. Anything else — invalid JSON, but equally the *valid* JSON values
 * `null`, `7`, `"str"` and `[1,2]` — yields `{}`.
 *
 * Rejecting the valid-but-wrong-shape values is not tidiness. `initScope` feeds
 * the result to `Object.entries`, and the pollution sweep below uses `in`,
 * which throws a TypeError on a primitive: `data-forma-state='null'` on ONE
 * element used to throw out of parseState, out of `mount()`, and leave every
 * other scope on the page unbound.
 *
 * Verified by: src/__tests__/runtime-state-parsing.test.ts > "a JSON scalar in data-forma-state does not stop the rest of the page from binding"
 * Verified by: src/__tests__/runtime-state-parsing.test.ts > "treats every non-object JSON value as empty state"
 */
function parseState(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    if (_debug) {
      dbg('parseState: Invalid JSON in data-forma-state — use valid JSON with quoted keys. Got:', raw.slice(0, 200));
    }
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    if (_debug) {
      dbg('parseState: data-forma-state must be a JSON object. Got:', raw.slice(0, 200));
    }
    return {};
  }
  const state = parsed as Record<string, unknown>;
  // Strip prototype-pollution keys. JSON.parse materializes `"__proto__"` as a
  // real own property, so this delete is not a no-op the way it would be for an
  // object literal.
  // Verified by: src/__tests__/runtime-state-parsing.test.ts > "a __proto__ key in data-forma-state never reaches Object.prototype"
  for (const key of FORBIDDEN_STATE_KEYS) {
    if (Object.hasOwn(state, key)) delete state[key];
  }
  return state;
}

// ── DOM scanner ──

function initScope(stateEl: Element): Scope {
  const raw = stateEl.getAttribute('data-forma-state') ?? '{}';
  const state = parseState(raw);
  const keys = Object.keys(state);
  if (_debug) {
    dbg('initScope: parsed', keys.length, 'keys:', keys.join(', '));
    if (keys.length === 0) {
      dbg('initScope: WARNING — empty state! Raw attribute:', raw.slice(0, 200));
    }
  }
  // Null-prototype, so an expression naming a member of Object.prototype does
  // not resolve to one. With a `{}` literal here, `data-text="{constructor}"`
  // read `Object` off the prototype chain and the parser's `getters[expr]?.()`
  // CALLED it — the same reach applied to `toString`, `valueOf` and
  // `hasOwnProperty`. That is the sandbox escape the FORBIDDEN_STATE_KEYS sweep
  // in parseState only looked like it closed: it strips the keys from the
  // parsed state, but inheritance put them back on the scope.
  // Verified by: src/__tests__/runtime-state-parsing.test.ts > "an expression naming an Object.prototype member reads undefined, not the prototype"
  const getters: Record<string, Getter> = Object.create(null);
  const setters: Record<string, Setter> = Object.create(null);

  for (const [key, initial] of Object.entries(state)) {
    const [get, set] = createSignal(initial);
    getters[key] = get;
    setters[key] = set as Setter;
  }

  // $refetch is a captured callable, not a bare function in scope.
  const refetchHost = hostFn('$refetch', (id: unknown) => $refetch(String(id)), 1);
  getters['$refetch'] = () => refetchHost;

  return { getters, setters };
}

// ── Element binding ──

function bindElement(el: Element, scope: Scope, disposers: (() => void)[]): void {
  // Per-element magics. Both are HOST values (src/expr/host.ts): the element is
  // reachable only through the element property allowlist, and $dispatch is a
  // captured callable rather than a function sitting in scope — a function held
  // in state is never invocable, so only magics like this one can be called.
  const elMagics: Record<string, unknown> = {
    $el: hostObject('element', el, '$el'),
    $dispatch: hostFn('$dispatch', (name: unknown, detail?: unknown) => {
      el.dispatchEvent(new CustomEvent(String(name), {
        bubbles: true,
        composed: true, // crosses Shadow DOM boundaries (important for <forma-stage>)
        detail,
      }));
    }, 2),
  };
  scope = createChildScope(scope, elMagics);

  // A marker left by an EARLIER bind of this element (reconcile re-binds in
  // place) is cleared here, up front, and never again. It used to be cleared in
  // a trailer at the end of bindElement, guarded by a flag that only knew about
  // COMPILE failures — so a denial raised while EVALUATING, which marks the
  // element from inside the effect that bindElement is still setting up, was
  // reported to the console and to getDiagnostics() and then had its marker
  // wiped off the element on the way out. `{items.push(4)}`, `{items[key]}`
  // with a hostile key, `{$el.ownerDocument}` and every budget denial were
  // silent in the DOM. Clearing before, and only setting after, makes the
  // marker mean "this element has an expression that did not run", whenever
  // that was discovered.
  // Verified by: src/__tests__/failure-semantics.test.ts > "a denial while evaluating marks the element, not just the console"
  if (el.hasAttribute('data-forma-expr-error')) el.removeAttribute('data-forma-expr-error');
  if (el.hasAttribute('data-forma-handler-error')) el.removeAttribute('data-forma-handler-error');

  // Every directive on this element goes through `evaluator()`. An expression
  // that cannot compile, or that is denied while evaluating, reports once and
  // yields EXPR_FAILED — which each directive treats as "do not write", so the
  // DOM keeps whatever it had instead of being handed the string "undefined".
  // Verified by: src/__tests__/runtime-csp-default.test.ts > "marks the element with data-forma-expr-error when an expression cannot be compiled"
  // Verified by: src/__tests__/failure-semantics.test.ts > "a denied expression leaves the previous text in place and never renders undefined"
  const evaluator = (expression: string): (() => unknown) => {
    const fn = buildEvaluator(expression, scope, el);
    if (!fn) return () => EXPR_FAILED;
    return () => {
      try {
        return fn();
      } catch (err) {
        if (!isExprError(err)) throw err;
        reportExprFailure(el, stripBraces(expression), err);
        return EXPR_FAILED;
      }
    };
  };

  // When the server provides a directive map, we know exactly which directives
  // this element has. Skip getAttribute calls for directives it doesn't have.
  // `known` is null when no map is available (fallback: check everything).
  const known = getDirectives(el);

  // data-computed="name = expr" or "a = expr1; b = expr2"
  const computedAttr = (!known || known.has('data-computed')) ? el.getAttribute('data-computed') : null;
  if (computedAttr) {
    // Split multi-statement computed: "a = expr1; b = expr2; c = expr3"
    // Uses lookahead to split at "; identifier =" boundaries without
    // breaking arrow functions (=>) or comparisons (===, ==).
    const parts = computedAttr.split(/;\s*(?=\w+\s*=[^=])/);
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const match = trimmed.match(RE_COMPUTED);
      if (match) {
        const name = match[1]!;
        const expr = match[2]!;
        // Remove the computed name from getters before building evaluator
        // to prevent self-referential cycle (computed reading itself)
        const prevGetter = scope.getters[name];
        delete scope.getters[name];
        // The raw evaluator is used here, not the reporting one: a computed
        // that cannot evaluate must make its READERS fail loudly (each with its
        // own element and diagnostic) rather than caching a sentinel that would
        // then be rendered as text.
        // `buildEvaluator` has already reported the failure and marked the
        // element, so there is nothing to do here but leave the name unbound —
        // which makes every reader of it fail loudly with its own diagnostic.
        const evaluate = buildEvaluator(`{${expr}}`, scope, el);
        if (evaluate) {
          const cell = createComputed((): { ok: true; v: unknown } | { ok: false; e: FormaExprError } => {
            try {
              return { ok: true, v: evaluate() };
            } catch (err) {
              if (!isExprError(err)) throw err;
              return { ok: false, e: err };
            }
          });
          scope.getters[name] = () => {
            const r = cell();
            if (!r.ok) throw r.e;
            return r.v;
          };
        }
        // Keep the original setter so manual overrides still work
        if (!prevGetter) {
          // If there was no initial state entry, remove the setter too
          delete scope.setters[name];
        }
      }
    }
  }

  // data-text="{expr}"
  const textExpr = (!known || known.has('data-text')) ? el.getAttribute('data-text') : null;
  if (textExpr) {
    const evaluate = evaluator(textExpr);
    const dispose = internalEffect(() => {
      const value = evaluate();
      if (value === EXPR_FAILED) return;
      setElementTextFast(el, toTextValue(value));
    });
    disposers.push(dispose);
  }

  // data-show="{expr}"
  const showExpr = (!known || known.has('data-show')) ? el.getAttribute('data-show') : null;
  if (showExpr) {
    const evaluate = evaluator(showExpr);
    const transition = parseTransitionSpec(el);
    if (_debug) {
      const tag = el.tagName.toLowerCase();
      const cls = el.className ? `.${String(el.className).split(' ')[0]}` : '';
      dbg(`bindElement: data-show="${showExpr}" on <${tag}${cls}>`);
    }
    let initialized = false;
    const dispose = internalEffect(() => {
      const value = evaluate();
      if (value === EXPR_FAILED) return;
      const visible = !!value;
      if (_debug) dbg(`data-show effect: "${showExpr}" → ${visible}`);
      applyShowVisibility(el as HTMLElement, visible, transition, !initialized);
      initialized = true;
    });
    disposers.push(dispose);
    if (transition) {
      disposers.push(() => clearTransitionState(el as HTMLElement));
    }
  }

  // data-if="{expr}" — conditional DOM insertion/removal with optional transitions
  const ifExpr = (!known || known.has('data-if')) ? el.getAttribute('data-if') : null;
  if (ifExpr) {
    const evaluate = evaluator(ifExpr);
    const transition = parseTransitionSpec(el);
    const placeholder = document.createComment('forma-if');
    const parent = el.parentNode;
    let inserted = true;
    let initialized = false;

    const dispose = internalEffect(() => {
      const value = evaluate();
      if (value === EXPR_FAILED) return;
      const show = !!value;

      if (show && !inserted) {
        // Cancel any in-flight leave
        clearTransitionState(el as HTMLElement);
        el.removeAttribute('data-forma-leaving');
        if (initialized && transition) {
          transitionInsert(el as HTMLElement, parent!, placeholder, transition);
        } else {
          parent?.insertBefore(el, placeholder);
        }
        inserted = true;
      } else if (!show && inserted) {
        if (initialized && transition) {
          transitionRemove(el as HTMLElement, transition, () => {
            if (el.parentNode) {
              parent?.insertBefore(placeholder, el);
              el.remove();
            }
          });
        } else {
          parent?.insertBefore(placeholder, el);
          el.remove();
        }
        inserted = false;
      }
      initialized = true;
    });

    disposers.push(dispose);
    if (transition) {
      disposers.push(() => clearTransitionState(el as HTMLElement));
    }
  }

  // data-model="{prop}"
  const modelExpr = (!known || known.has('data-model')) ? el.getAttribute('data-model') : null;
  if (modelExpr) {
    const prop = modelExpr.replace(RE_STRIP_BRACES, '').trim();
    let getter = scope.getters[prop];
    let setter = scope.setters[prop];
    if ((!getter || !setter) && prop.includes('.')) {
      // Member path (e.g. {item.name} inside a data-list row): evaluate to read,
      // and set the last key on the resolved parent object to write. Reactive
      // when the parent is a store proxy; a plain object still round-trips the
      // input value.
      getter = evaluator(prop);
      const lastDot = prop.lastIndexOf('.');
      const basePath = prop.slice(0, lastDot);
      const key = prop.slice(lastDot + 1);
      const baseGet = evaluator(basePath);
      setter = (v: unknown) => {
        const base = baseGet();
        if (base !== EXPR_FAILED && base != null && typeof base === 'object') {
          (base as Record<string, unknown>)[key] = v;
        }
      };
    }
    if (getter && setter) {
      const input = el as HTMLInputElement;
      const tag = input.tagName;
      const dispose = internalEffect(() => {
        const val = getter();
        if (val === EXPR_FAILED) return;
        const type = input.type;
        if (type === 'checkbox') {
          input.checked = !!val;
          // Optional indeterminate companion attribute (opt-in, non-breaking).
          const indetExpr = el.getAttribute('data-model-indeterminate');
          if (indetExpr) {
            const indetGetter = scope.getters[indetExpr.replace(RE_STRIP_BRACES, '').trim()];
            if (indetGetter) input.indeterminate = !!indetGetter();
          }
        } else if (type === 'radio') {
          input.checked = String(val) === input.value;
        } else if (tag === 'SELECT' && (input as unknown as HTMLSelectElement).multiple) {
          const sel = input as unknown as HTMLSelectElement;
          const arr = Array.isArray(val) ? val.map(String) : [];
          for (const opt of Array.from(sel.options)) opt.selected = arr.includes(opt.value);
        } else {
          input.value = String(val ?? '');
        }
      });
      disposers.push(dispose);
      const event = (input.type === 'checkbox' || input.type === 'radio' || tag === 'SELECT') ? 'change' : 'input';
      const onModelInput = () => {
        const type = input.type;
        if (type === 'checkbox') {
          setter(input.checked);
        } else if (type === 'radio') {
          if (input.checked) setter(input.value);
        } else if (tag === 'SELECT' && (input as unknown as HTMLSelectElement).multiple) {
          const sel = input as unknown as HTMLSelectElement;
          setter(Array.from(sel.selectedOptions).map((o) => o.value));
        } else if (type === 'number' || type === 'range') {
          const raw = input.value;
          if (raw === '') {
            setter(null); // empty numeric clears rather than writing NaN
          } else {
            const n = Number(raw);
            if (!Number.isNaN(n)) setter(n); // ignore partial input like '-' or '1.'
          }
        } else {
          setter(input.value);
        }
      };
      input.addEventListener(event, onModelInput);
      disposers.push(() => {
        input.removeEventListener(event, onModelInput);
      });
    }
  }

  // Single-pass over attributes for data-on:*, data-class:*, data-bind:*
  // When directive map is available, skip the loop entirely if none of these are present.
  const hasColonDirectives = !known || hasAnyPrefix(known, 'data-on:', 'data-class:', 'data-bind:');
  // Snapshot the NamedNodeMap before binding. data-bind effects run
  // synchronously and can add/remove attributes; iterating the live map would
  // otherwise skip the following directive when its indices shift.
  const attrs = Array.from(el.attributes);
  if (hasColonDirectives) for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i]!;
    const name = attr.name;

    if (name.startsWith('data-on:')) {
      const event = name.slice(8); // 'data-on:'.length === 8
      const built = buildHandler(attr.value, scope, el);
      const handler = built.handler;
      if (_debug) {
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : '';
        const cls = el.className ? `.${String(el.className).split(' ')[0]}` : '';
        dbg(`bindElement: data-on:${event}="${attr.value}" on <${tag}${id}${cls}>`);
      }
      // Set only. A stale marker was cleared at the top of bindElement, so an
      // element carrying two handlers cannot have the second one erase the
      // first one's failure.
      // Verified by: src/__tests__/failure-semantics.test.ts > "a second, working handler does not erase the first one's failure marker"
      if (!built.supported) {
        el.setAttribute('data-forma-handler-error', 'unsupported');
      }
      if (_debug) {
        const attrVal = attr.value;
        const tracedHandler = (e: Event) => {
          dbg(`HANDLER FIRED: data-on:${event}="${attrVal}"`, 'isTrusted:', e.isTrusted);
          handler(e);
        };
        el.addEventListener(event, tracedHandler);
        disposers.push(() => { el.removeEventListener(event, tracedHandler); });
      } else {
        el.addEventListener(event, handler);
        disposers.push(() => { el.removeEventListener(event, handler); });
      }
    } else if (name.startsWith('data-class:')) {
      const cls = name.slice(11); // 'data-class:'.length === 11
      const evaluate = evaluator(attr.value);
      const dispose = internalEffect(() => {
        const value = evaluate();
        if (value === EXPR_FAILED) return;
        el.classList.toggle(cls, !!value);
      });
      disposers.push(dispose);
    } else if (name.startsWith('data-bind:')) {
      const attrName = name.slice(10); // 'data-bind:'.length === 10
      const evaluate = evaluator(attr.value);
      const dispose = internalEffect(() => {
        const val = evaluate();
        if (val === EXPR_FAILED) return;
        if (val == null || val === false) {
          el.removeAttribute(attrName);
          return;
        }
        // `true` writes a BARE attribute, matching h(), hydration adoption, the
        // SSR renderer and the Rust walker. Writing String(true) here produced
        // `disabled="true"` where every other path produced `disabled`, so an
        // SSR page and its bound self disagreed byte-for-byte.
        // Verified by: src/__tests__/renderer-contract.test.ts > "true renders a bare attribute — present with an empty value"
        const str = val === true ? '' : String(val);
        // The safety check runs for EVERY accepted value, including the bare
        // one: an `on*` name must not be written even with an empty value, and
        // splitting the true-case out above the guard is exactly how it would
        // be. Applies to standard and hardened builds alike.
        // Verified by: src/__tests__/runtime-bind-security.test.ts > "does not set an inline event-handler attribute via data-bind:onclick"
        // Verified by: src/__tests__/renderer-contract.test.ts > "refuses an on* name whatever the value type: %j"
        if (isUnsafeAttrBinding(attrName, str, el.tagName.toLowerCase())) {
          el.removeAttribute(attrName);
        } else {
          el.setAttribute(attrName, str);
        }
      });
      disposers.push(dispose);
    }
  }

  // data-persist="{prop}"
  const persistExpr = (!known || known.has('data-persist')) ? el.getAttribute('data-persist') : null;
  if (persistExpr) {
    const prop = persistExpr.replace(RE_STRIP_BRACES, '').trim();
    const getter = scope.getters[prop];
    const setter = scope.setters[prop];
    if (getter && setter) {
      const key = 'forma:' + prop;
      try {
        const saved = localStorage.getItem(key);
        if (saved !== null) setter(JSON.parse(saved));
      } catch { /* ignore parse errors */ }
      const dispose = internalEffect(() => {
        try { localStorage.setItem(key, JSON.stringify(getter())); } catch { /* quota */ }
      });
      disposers.push(dispose);
    }
  }

  // data-list="{expr}" — keyed reconciliation with LIS
  const listExpr = (!known || known.has('data-list')) ? el.getAttribute('data-list') : null;
  if (listExpr) {
    const evaluate = evaluator(listExpr);
    const templateEl = el.children[0] as Element | undefined;
    if (templateEl) {
      const template = templateEl.cloneNode(true) as Element;
      // Remove original template from DOM
      el.removeChild(templateEl);

      // Detect key attribute: data-key="{item.id}" -> extracts "id"
      const keyAttr = template.getAttribute('data-key');
      const keyProp = keyAttr
        ? keyAttr.replace(RE_STRIP_ITEM_BRACES, '').trim()
        : null;

      // Parse transition spec from the list container element
      const listTransition = parseTransitionSpec(el);

      let oldItems: unknown[] = [];
      let oldNodes: Node[] = [];

      // For index-based keying (no data-key), we wrap items in objects
      // that carry their index so the keyFn can extract it without a
      // second argument. For property-based keying, items pass through raw.
      interface IndexWrapped { __idx: number; __item: unknown }

      /** Dispose all bindings stored on a clone element */
      function disposeCloneBindings(node: Node): void {
        const el = node as any;
        if (Array.isArray(el.__formaDisposers)) {
          for (const d of el.__formaDisposers) {
            try { d(); } catch { /* ensure all disposers run */ }
          }
          delete el.__formaDisposers;
        }
      }

      /** Clone template, bind directives via child scope */
      function createBoundClone(item: unknown, index: number): Element {
        const clone = cloneWithTemplateData(template, item);
        const childScope = createChildScope(scope, { item, index });
        const itemDisposers: (() => void)[] = [];
        bindElement(clone, childScope, itemDisposers);
        for (const desc of Array.from(clone.querySelectorAll('*'))) {
          bindElement(desc, childScope, itemDisposers);
        }
        (clone as any).__formaDisposers = itemDisposers;
        return clone;
      }

      /** Dispose old bindings and rebind with fresh data */
      function updateBoundClone(node: Node, item: unknown, index: number): void {
        disposeCloneBindings(node);
        updateTemplateData(node as Element, item);
        const childScope = createChildScope(scope, { item, index });
        const itemDisposers: (() => void)[] = [];
        bindElement(node as Element, childScope, itemDisposers);
        for (const desc of Array.from((node as Element).querySelectorAll('*'))) {
          bindElement(desc, childScope, itemDisposers);
        }
        (node as any).__formaDisposers = itemDisposers;
      }

      // Build transition hooks for reconcileList (only when transition attrs present)
      const listHooks: ListTransitionHooks | undefined = listTransition ? {
        onInsert: (node: Node) => {
          const htmlEl = node as HTMLElement;
          if (!htmlEl.setAttribute) return; // text node guard
          const state = getTransitionState(htmlEl);
          state.token += 1;
          const token = state.token;
          if (state.cancel) state.cancel();
          state.cancel = runTransitionPhase(
            htmlEl,
            {
              base: listTransition.enter,
              from: listTransition.enterFrom,
              to: listTransition.enterTo,
              durationMs: listTransition.enterDurationMs,
            },
            () => {
              const current = getTransitionState(htmlEl);
              if (current.token === token) current.cancel = null;
            },
          );
        },
        onBeforeRemove: (node: Node, done: () => void) => {
          const htmlEl = node as HTMLElement;
          if (!htmlEl.setAttribute) { done(); return; } // text node guard
          disposeCloneBindings(node);
          transitionRemove(htmlEl, listTransition, () => {
            done();
          });
        },
      } : undefined;

      const dispose = internalEffect(() => {
        const rawItems = evaluate();
        if (rawItems === EXPR_FAILED) return;
        if (!Array.isArray(rawItems)) {
          // Remove all — dispose bindings first
          for (const n of oldNodes) {
            disposeCloneBindings(n);
            el.removeChild(n);
          }
          oldItems = [];
          oldNodes = [];
          return;
        }

        // Cancel any in-flight leave animations before reconciliation
        if (listTransition) {
          const leavingNodes = el.querySelectorAll('[data-forma-leaving]');
          for (const ln of Array.from(leavingNodes)) {
            clearTransitionState(ln as HTMLElement);
            ln.removeAttribute('data-forma-leaving');
            if (ln.parentNode) ln.parentNode.removeChild(ln);
          }
        }

        // Snapshot old nodes before reconciliation to detect removals
        const prevNodes = new Set(oldNodes);

        // Wrap items so each carries its TRUE loop index. This replaces
        // rawItems.indexOf(item) (which returned the first match for duplicate /
        // primitive items, giving wrong/duplicated {index}, and was O(n^2)).
        const wrapped: IndexWrapped[] = rawItems.map((item, i) => ({ __idx: i, __item: item }));
        const oldWrapped = oldItems as IndexWrapped[];
        const keyFn = keyProp
          ? (w: IndexWrapped) => String((w.__item as Record<string, unknown>)?.[keyProp] ?? '')
          : (w: IndexWrapped) => w.__idx;

        const result = reconcileList<IndexWrapped>(
          el,
          oldWrapped,
          wrapped,
          oldNodes,
          keyFn,
          (w: IndexWrapped) => createBoundClone(w.__item, w.__idx),
          (node: Node, w: IndexWrapped) => updateBoundClone(node, w.__item, w.__idx),
          undefined, // beforeNode
          listHooks,
        );
        // Dispose bindings on nodes that were removed by reconcileList
        const nextNodes = new Set(result.nodes);
        for (const n of prevNodes) {
          if (!nextNodes.has(n)) {
            // Skip nodes mid-leave — onBeforeRemove already disposed them
            if ((n as Element).hasAttribute?.('data-forma-leaving')) continue;
            disposeCloneBindings(n);
          }
        }
        oldItems = result.items;
        oldNodes = result.nodes;
      });
      disposers.push(dispose);
    }
  }

  // data-fetch="[METHOD] url → prop [|loading:prop] [|error:prop] [|poll:ms]"
  const fetchExpr = (!known || known.has('data-fetch')) ? el.getAttribute('data-fetch') : null;
  if (fetchExpr) {
    const arrowMatch = fetchExpr.match(RE_FETCH);
    if (arrowMatch) {
      const urlPart = arrowMatch[1]!.trim();
      const target = arrowMatch[2]!.trim();
      const modifiers = arrowMatch[3]?.trim() ?? '';

      let method = 'GET';
      let url = urlPart;
      const methodMatch = urlPart.match(RE_FETCH_METHOD);
      if (methodMatch) {
        method = methodMatch[1]!.toUpperCase();
        url = methodMatch[2]!.trim();
      }

      let loadingTarget: string | undefined;
      let errorTarget: string | undefined;
      let interval: number | undefined;
      for (const mod of modifiers.split('|').filter(Boolean)) {
        const [k, v] = mod.split(':').map(s => s.trim());
        if (k === 'loading') loadingTarget = v;
        else if (k === 'error') errorTarget = v;
        else if (k === 'poll') interval = parseInt(v ?? '0', 10);
      }

      // Create signals for target, loading, and error
      const [getTarget, setTarget] = createSignal<unknown>(null);
      scope.getters[target] = getTarget;
      scope.setters[target] = setTarget as Setter;
      if (loadingTarget) {
        const [gl, sl] = createSignal(false);
        scope.getters[loadingTarget] = gl;
        scope.setters[loadingTarget] = sl as Setter;
      }
      if (errorTarget) {
        const [ge, se] = createSignal<unknown>(null);
        scope.getters[errorTarget] = ge;
        scope.setters[errorTarget] = se as Setter;
      }

      const doFetch = () => {
        if (loadingTarget) scope.setters[loadingTarget]!(true);
        fetch(url, { method })
          .then(r => r.json())
          .then(data => {
            setTarget(data);
            if (loadingTarget) scope.setters[loadingTarget]!(false);
          })
          .catch(err => {
            if (errorTarget) scope.setters[errorTarget]!(err.message);
            if (loadingTarget) scope.setters[loadingTarget]!(false);
          });
      };

      // Register in $refetch registry if data-fetch-id is present
      const fetchId = el.getAttribute('data-fetch-id');
      if (fetchId) {
        _refetchRegistry.set(fetchId, doFetch);
        disposers.push(() => _refetchRegistry.delete(fetchId));
      }

      doFetch();
      if (interval && interval > 0) {
        const id = setInterval(doFetch, interval);
        disposers.push(() => clearInterval(id));
      }
    }
  }

}

// ── Scope mounting / unmounting (single data-forma-state element) ──

/**
 * Fast check: does this element have any Forma directive attribute?
 *
 * This is the fallback scan, used when the server sent no directive map. It
 * replaced a `DIRECTIVE_SELECTOR` constant that claimed to "avoid scanning
 * every descendant" while being referenced by nothing: mountScope has always
 * called querySelectorAll('*') and filtered with this predicate. The targeted
 * selector the claim described is the one buildDirectiveSelector() constructs
 * from the server's map.
 */
function hasDirective(el: Element): boolean {
  const attrs = el.attributes;
  for (let i = 0; i < attrs.length; i++) {
    const name = attrs[i]!.name;
    if (name.startsWith('data-text') || name.startsWith('data-show') ||
        name.startsWith('data-if') || name.startsWith('data-model') ||
        name.startsWith('data-computed') || name.startsWith('data-persist') ||
        name.startsWith('data-list') || name.startsWith('data-fetch') ||
        name.startsWith('data-on:') || name.startsWith('data-class:') ||
        name.startsWith('data-bind:') || name.startsWith('data-transition')) {
      return true;
    }
  }
  return false;
}

// ── Pre-compiled Directive Map ──
//
// When the server sends a directive_map sidecar (data-forma-id → directive names),
// the runtime uses it in two ways:
//
// 1. mountScope(): targeted CSS selector queries only directive-bearing elements
//    instead of querySelectorAll('*') + attribute scan on every descendant.
//
// 2. bindElement(): skips getAttribute calls for directives the element doesn't
//    have, avoiding unnecessary work for elements with only 1-2 directives.

/** Full map: data-forma-id → Set of directive attribute names. */
let _directiveMap: Map<string, Set<string>> | null = null;

/**
 * Load a pre-compiled directive map from the server.
 * Keys are data-forma-id values, values are arrays of directive attribute names.
 */
function setDirectiveMap(map: Record<string, string[]> | null): void {
  if (!map || Object.keys(map).length === 0) {
    _directiveMap = null;
    return;
  }
  _directiveMap = new Map();
  for (const id in map) {
    _directiveMap.set(id, new Set(map[id]!));
  }
}

/**
 * Build a CSS selector that targets only elements with known directives.
 * Returns null when the map has too many entries (selector would be huge)
 * or when no map is available.
 */
function buildDirectiveSelector(): string | null {
  if (!_directiveMap || _directiveMap.size === 0) return null;
  // Cap at 200 IDs to avoid pathologically long selectors.
  // Above that, querySelectorAll('*') + Set check is likely faster.
  if (_directiveMap.size > 200) return null;
  const parts: string[] = [];
  for (const id of _directiveMap.keys()) {
    parts.push(`[data-forma-id="${id}"]`);
  }
  return parts.join(',');
}

/** Get the directive set for an element, or null if unknown. */
function getDirectives(el: Element): Set<string> | null {
  if (!_directiveMap) return null;
  const id = el.getAttribute('data-forma-id');
  if (!id) return null;
  return _directiveMap.get(id) ?? null;
}

/** Check if any entry in a Set starts with one of the given prefixes. */
function hasAnyPrefix(set: Set<string>, ...prefixes: string[]): boolean {
  for (const entry of set) {
    for (const prefix of prefixes) {
      if (entry.startsWith(prefix)) return true;
    }
  }
  return false;
}

function mountScope(root: Element): void {
  // Idempotency guard — never double-bind
  if ((root as any).__formaDisposers) {
    if (_debug) dbg('mountScope: SKIPPED (already mounted)');
    return;
  }

  const scope = initScope(root);
  const disposers: (() => void)[] = [];

  // Build $refs — a lazy proxy that resolves data-ref="name" to elements.
  // Scanned once at mount time; the proxy resolves lazily on access.
  const refsMap = new Map<string, Element>();
  const refEls = root.querySelectorAll('[data-ref]');
  for (let i = 0; i < refEls.length; i++) {
    const el = refEls[i]!;
    const name = el.getAttribute('data-ref');
    if (name) refsMap.set(name, el);
  }
  // Also check the root itself
  const rootRefName = root.getAttribute('data-ref');
  if (rootRefName) refsMap.set(rootRefName, root);

  // $refs hands back ELEMENT HOSTS, not raw elements. Before this, a `data-ref`
  // element came out unwrapped and `$refs.r.ownerDocument.location.href` read
  // the real page URL from inside a "CSP-safe" expression, with no diagnostic.
  // Verified by: src/expr/__tests__/adversarial.test.ts > "$refs.r.ownerDocument.location.href is denied"
  const refsHost = hostObject('refs', refsMap, '$refs');
  scope.getters['$refs'] = () => refsHost;

  // Bind the root itself
  bindElement(root, scope, disposers);

  // Bind only directive-bearing descendants (skip inert elements).
  // When the server provides a directive map, we build a targeted CSS selector
  // that queries only elements with known directives — no querySelectorAll('*').
  //
  // Both queries take a SNAPSHOT, and binding an earlier element can detach a
  // later one: `data-list` lifts its first child out as the row template with
  // `removeChild`, so that node is still in the snapshot and no longer in the
  // tree. Binding it evaluated the row's expressions against the PARENT scope,
  // where `item` does not exist — silently undefined under the old parser, and
  // a bogus "item is not declared" diagnostic under this one. A detached node
  // has no parent, which is the O(1) test for "an earlier bind removed this".
  // Verified by: src/__tests__/failure-semantics.test.ts > "a data-list row template is not bound against the parent scope"
  let boundCount = 0;
  const selector = buildDirectiveSelector();
  // Without a server-supplied map the query is `*`, so every element on the
  // page is visited and the attribute scan is the filter. Hoisted out of the
  // loop because that is the hot path.
  const scanAll = selector === null;
  const targets = scanAll ? root.querySelectorAll('*') : root.querySelectorAll(selector);
  for (let i = 0; i < targets.length; i++) {
    const el = targets[i]!;
    if (el.parentNode === null) continue;
    if (scanAll && !hasDirective(el)) continue;
    bindElement(el, scope, disposers);
    boundCount++;
  }

  // Store disposers on the root element for cleanup
  (root as any).__formaDisposers = disposers;
  // Expose scope for devtools (State Inspector panel)
  (root as any).__formaScope = scope;
  (root as any).__formaInitialState = root.getAttribute('data-forma-state') ?? '{}';
  if (_debug) dbg('mountScope: DONE —', boundCount, 'elements bound,', disposers.length, 'disposers', selector ? '(targeted)' : '(full scan)');
}

/**
 * Unmount a single `data-forma-state` element — disposes all effects,
 * intervals, and event listeners. Safe to call on already-unmounted elements.
 */
function unmountScope(root: Element): void {
  const disposers = (root as any).__formaDisposers as (() => void)[] | undefined;
  if (disposers) {
    for (const d of disposers) {
      try { d(); } catch { /* ensure all disposers run */ }
    }
    delete (root as any).__formaDisposers;
    delete (root as any).__formaScope;
    delete (root as any).__formaInitialState;
  }
}

// ── MutationObserver — auto-discovery of new data-forma-state elements ──
//
// Cost: O(addedNodes) per mutation batch. Never re-scans the whole document.
// The observer only fires for childList mutations (nodes added/removed) and
// attribute mutations on the `data-forma-state` attribute specifically.

let _observer: MutationObserver | null = null;
const ELEMENT_NODE = 1;
const MUTATION_CHUNK_SIZE = 40;
let _pendingMutations: MutationRecord[] = [];
let _drainingMutations = false;

function processMutation(mutation: MutationRecord): void {
  // ── Removed nodes: clean up disposers to prevent memory leaks ──
  for (let i = 0; i < mutation.removedNodes.length; i++) {
    const node = mutation.removedNodes[i]!;
    if (node.nodeType !== ELEMENT_NODE) continue;
    const el = node as Element;
    if (el.hasAttribute('data-forma-state')) {
      if (_debug) dbg('MutationObserver: REMOVED scope');
      unmountScope(el);
    }
    const removed = el.querySelectorAll('[data-forma-state]');
    for (let j = 0; j < removed.length; j++) {
      unmountScope(removed[j]!);
    }
  }

  // ── Added nodes: auto-mount new scopes ──
  for (let i = 0; i < mutation.addedNodes.length; i++) {
    const node = mutation.addedNodes[i]!;
    if (node.nodeType !== ELEMENT_NODE) continue;
    const el = node as Element;
    if (el.closest('[data-forma-leaving]')) continue;
    if (el.hasAttribute('data-forma-state')) {
      if (_debug) dbg('MutationObserver: ADDED scope via mutation');
      mountScope(el);
    }
    const added = el.querySelectorAll('[data-forma-state]');
    if (_debug && added.length > 0) {
      dbg('MutationObserver: found', added.length, 'nested scope(s) in added subtree');
    }
    for (let j = 0; j < added.length; j++) {
      const desc = added[j]!;
      if (desc.closest('[data-forma-leaving]')) continue;
      mountScope(desc);
    }
  }

  // ── Attribute change: data-forma-state added/removed/changed ──
  if (mutation.type === 'attributes' && mutation.attributeName === 'data-forma-state') {
    const target = mutation.target as Element;
    // Always unmount first (cleans up old bindings)
    unmountScope(target);
    // Re-mount if the attribute still exists (value may have changed)
    if (target.hasAttribute('data-forma-state')) {
      mountScope(target);
    }
  }
}

async function drainMutationQueue(): Promise<void> {
  try {
    while (_pendingMutations.length > 0) {
      const batch = _pendingMutations.splice(0, MUTATION_CHUNK_SIZE);
      for (let i = 0; i < batch.length; i++) {
        processMutation(batch[i]!);
      }
      if (_pendingMutations.length > 0) {
        await yieldToMain();
      }
    }
  } finally {
    _drainingMutations = false;
    // Handle races where new mutations were queued after the while-check.
    if (_pendingMutations.length > 0 && !_drainingMutations) {
      _drainingMutations = true;
      void drainMutationQueue();
    }
  }
}

function handleMutations(mutations: MutationRecord[]): void {
  if (_debug) dbg('MutationObserver: queued', mutations.length, 'mutation(s)');
  _pendingMutations.push(...mutations);
  if (_drainingMutations) return;
  _drainingMutations = true;
  void drainMutationQueue();
}

function startObserver(): void {
  if (_observer) return;
  _observer = new MutationObserver(handleMutations);
  const target = document.body || document.documentElement;
  if (target) {
    _observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-forma-state'],
    });
  }
}

function stopObserver(): void {
  if (_observer) {
    _observer.disconnect();
    _observer = null;
  }
}

// ── Main init ──

function initRuntime(): void {
  if (_autoContainment) {
    applyContainmentHints(document, { skipIfAlreadySet: true });
  }
  const stateRoots = document.querySelectorAll('[data-forma-state]');
  if (_debug) dbg('initRuntime: found', stateRoots.length, 'scope(s)');
  for (const root of Array.from(stateRoots)) {
    mountScope(root);
  }
  // Start auto-discovery after initial scan
  startObserver();
  if (_debug) dbg('initRuntime: MutationObserver started');
}

/**
 * Dispose all FormaJS scopes — clears effects, intervals, event listeners, and
 * stops the observer.
 *
 * The per-scope closure caches are WeakMaps keyed by the scope, so they go with
 * the scopes. The module-level compiled-AST cache in src/expr is keyed by source
 * TEXT and shared across scopes, so it has to be dropped explicitly or a torn
 * down page keeps up to 2,048 parsed programs alive.
 */
function destroyRuntime(): void {
  stopObserver();
  const stateRoots = document.querySelectorAll('[data-forma-state]');
  for (const root of Array.from(stateRoots)) {
    unmountScope(root);
  }
  clearExpressionCache();
}

/**
 * Mount a specific element or subtree — scans for `data-forma-state`
 * elements and initializes their reactive bindings.
 *
 * Use this for manual control when injecting HTML dynamically.
 * With the MutationObserver active, this is usually not needed.
 *
 * @param el - The root element to scan (checks itself and all descendants).
 */
function mount(el: Element): void {
  if (el.hasAttribute('data-forma-state')) {
    mountScope(el);
  }
  const descendants = el.querySelectorAll('[data-forma-state]');
  for (const desc of Array.from(descendants)) {
    mountScope(desc);
  }
}

/**
 * Unmount a specific element or subtree — disposes all reactive bindings
 * for `data-forma-state` elements within.
 *
 * @param el - The root element to clean up (checks itself and all descendants).
 */
function unmount(el: Element): void {
  if (el.hasAttribute('data-forma-state')) {
    unmountScope(el);
  }
  const descendants = el.querySelectorAll('[data-forma-state]');
  for (const desc of Array.from(descendants)) {
    unmountScope(desc);
  }
}

// Auto-init in browser contexts on DOMContentLoaded (or immediately if already loaded).
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRuntime);
  } else {
    initRuntime();
  }
}

/** Enable/disable debug logging. Also toggleable via window.__FORMA_DEBUG = true */
function setDebug(on: boolean): void { _debug = on; }
/** Enable/disable runtime diagnostics for unsupported expressions/handlers. */
function setDiagnostics(on: boolean): void { _diagnosticsEnabled = on; }

/** Runtime diagnostics captured while parsing/binding templates. */
function getDiagnostics(): RuntimeDiagnostic[] {
  return Array.from(diagnostics.values()).map(d => ({ ...d }));
}

/** Clear runtime diagnostics collected so far. */
function clearDiagnostics(): void {
  diagnostics.clear();
}

// ── DevTools API — State Inspector ──

interface ScopeDescriptor {
  element: Element;
  id: string;
  values: Record<string, { value: unknown; type: string }>;
  initialJSON: string;
}

/**
 * DevTools: enumerate all active scopes and their current signal values.
 * Only called when the State Inspector panel is open — zero overhead otherwise.
 */
function getScopes(): ScopeDescriptor[] {
  const roots = document.querySelectorAll('[data-forma-state]');
  const result: ScopeDescriptor[] = [];

  for (const root of Array.from(roots)) {
    if (root.closest('[data-forma-leaving]')) continue;
    const scope = (root as any).__formaScope as Scope | undefined;
    const initialJSON = (root as any).__formaInitialState as string | undefined;
    if (!scope) continue;

    const values: Record<string, { value: unknown; type: string }> = {};
    for (const key of Object.keys(scope.getters)) {
      const val = scope.getters[key]!();
      values[key] = { value: val, type: typeof val };
    }

    result.push({
      element: root,
      id: root.getAttribute('data-forma-id') || root.id || root.tagName.toLowerCase(),
      values,
      initialJSON: initialJSON ?? '{}',
    });
  }
  return result;
}

/**
 * DevTools: set a state value on a specific scope element.
 * Triggers normal reactive effects (data-show, data-text, etc.).
 */
function setScopeValue(element: Element, key: string, value: unknown): void {
  const scope = (element as any).__formaScope as Scope | undefined;
  if (!scope?.setters[key]) return;
  batch(() => { scope.setters[key]!(value); });
}

/**
 * DevTools: reset all values on a scope to their initial JSON state.
 */
function resetScope(element: Element): void {
  const scope = (element as any).__formaScope as Scope | undefined;
  const initialJSON = (element as any).__formaInitialState as string | undefined;
  if (!scope || !initialJSON) return;

  const initial = parseState(initialJSON);
  batch(() => {
    for (const [key, val] of Object.entries(initial)) {
      scope.setters[key]?.(val);
    }
  });
}

// ── Reconciler ──

let _reconciler: ((container: Element, html: string) => void) | null = null;

function getReconciler() {
  if (!_reconciler) {
    _reconciler = createReconciler({
      mountScope,
      unmountScope,
      disconnectObserver() {
        if (_observer) {
          _observer.disconnect();
        }
      },
      reconnectObserver() {
        if (_observer) {
          const target = document.body || document.documentElement;
          if (target) {
            _observer.observe(target, {
              childList: true,
              subtree: true,
              attributes: true,
              attributeFilter: ['data-forma-state'],
            });
          }
        }
      },
      batch,
    });
  }
  return _reconciler;
}

/** Reconcile a container's DOM against a new HTML string. */
function reconcile(container: Element, html: string): void {
  getReconciler()(container, html);
}

export {
  initRuntime,
  destroyRuntime,
  mount,
  unmount,
  reconcile,
  setDebug,
  yieldToMain,
  applyContainmentHints,
  setDirectiveMap,
  setDiagnostics,
  getDiagnostics,
  clearDiagnostics,
  getScopes,
  setScopeValue,
  resetScope,
};
