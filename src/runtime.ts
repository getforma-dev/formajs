/**
 * FormaJS HTML Runtime — Alpine-like declarative API via data-* attributes.
 *
 * Usage:
 *   <script src="formajs.runtime.min.js"></script>
 *   <div data-forma-state='{"count": 0}'>
 *     <p data-text="{count}"></p>
 *     <button data-on:click="{count++}">+1</button>
 *   </div>
 *
 * Supported attributes:
 *   data-forma-state='{"key": value}'  State declaration (JSON)
 *   data-text="{expr}"                 Text content binding
 *   data-show="{expr}"                 Display toggle (display: none)
 *   data-transition:*="..."            Enter/leave transitions for data-show
 *   data-if="{expr}"                   Conditional render (remove/restore)
 *   data-model="{prop}"                Two-way input binding
 *   data-on:event="{expr}"             Event handler
 *   data-class:name="{expr}"           Conditional CSS class
 *   data-bind:attr="{expr}"            Dynamic attribute
 *   data-computed="name = expr"        Computed value
 *   data-persist="{prop}"              localStorage sync
 *   data-list="{expr}"                 List rendering (first child = template)
 *   data-fetch="GET /url → prop"       Fetch binding
 *   data-fetch-id="name"               Register fetch for $refetch('name')
 */
import { createValueSignal, internalEffect, createComputed, batch } from './reactive';
import { reconcileList, type ListTransitionHooks } from './dom/list';
import { createReconciler } from './dom/reconcile';

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
type UnsafeEvalMode = 'mutable' | 'locked-off' | 'locked-on';
let _unsafeEvalMode: UnsafeEvalMode = 'mutable';
let _allowUnsafeEval = false;
let _diagnosticsEnabled = true;
function dbg(...args: unknown[]): void {
  if (_debug || (typeof window !== 'undefined' && (window as any).__FORMA_DEBUG)) {
    console.log('[FormaJS]', ...args);
  }
}

interface RuntimeConfig {
  allowUnsafeEval?: boolean;
  unsafeEvalMode?: UnsafeEvalMode;
  lockUnsafeEval?: boolean;
  diagnostics?: boolean;
  autoContainment?: boolean;
}

interface RuntimeDiagnostic {
  kind: 'handler-unsupported' | 'expression-unsupported';
  expr: string;
  reason: string;
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

function parseUnsafeEvalMode(raw: string | null | undefined): UnsafeEvalMode | undefined {
  if (raw == null) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'mutable') return 'mutable';
  if (normalized === 'locked-off' || normalized === 'off' || normalized === 'disabled') {
    return 'locked-off';
  }
  if (normalized === 'locked-on' || normalized === 'on' || normalized === 'enabled') {
    return 'locked-on';
  }
  return undefined;
}

function readRuntimeConfig(): RuntimeConfig {
  const config: RuntimeConfig = {};

  if (typeof window !== 'undefined') {
    const globalConfig = (window as any).__FORMA_RUNTIME_CONFIG as RuntimeConfig | undefined;
    if (globalConfig) {
      if (typeof globalConfig.allowUnsafeEval === 'boolean') {
        config.allowUnsafeEval = globalConfig.allowUnsafeEval;
      }
      if (typeof globalConfig.unsafeEvalMode === 'string') {
        const parsed = parseUnsafeEvalMode(globalConfig.unsafeEvalMode);
        if (parsed) config.unsafeEvalMode = parsed;
      }
      if (typeof globalConfig.lockUnsafeEval === 'boolean') {
        config.lockUnsafeEval = globalConfig.lockUnsafeEval;
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
    const script = document.currentScript as HTMLScriptElement | null;
    if (script) {
      const unsafeFromAttr = parseBooleanFlag(script.getAttribute('data-forma-unsafe-eval'));
      if (unsafeFromAttr !== undefined) {
        config.allowUnsafeEval = unsafeFromAttr;
      }
      const modeFromAttr = parseUnsafeEvalMode(
        script.getAttribute('data-forma-unsafe-eval-mode'),
      );
      if (modeFromAttr !== undefined) {
        config.unsafeEvalMode = modeFromAttr;
      }
      const lockFromAttr = parseBooleanFlag(script.getAttribute('data-forma-lock-unsafe-eval'));
      if (lockFromAttr !== undefined) {
        config.lockUnsafeEval = lockFromAttr;
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
): void {
  if (!_diagnosticsEnabled) return;

  const key = `${kind}|${reason}|${expr}`;
  const now = Date.now();
  const existing = diagnostics.get(key);

  if (existing) {
    existing.count += 1;
    existing.lastSeenAt = now;
  } else {
    diagnostics.set(key, {
      kind,
      expr,
      reason,
      count: 1,
      firstSeenAt: now,
      lastSeenAt: now,
    });
    console.warn(`[FormaJS] ${reason}: ${expr}`);
  }

  try {
    if (typeof window !== 'undefined') {
      const detail = {
        kind,
        expr,
        reason,
        count: diagnostics.get(key)?.count ?? 1,
      };
      window.dispatchEvent(new CustomEvent('formajs:diagnostic', { detail }));
    }
  } catch {
    // Ignore event dispatch failures
  }
}

declare const __FORMA_UNSAFE_EVAL_MODE__: string | undefined;
const buildUnsafeEvalMode = parseUnsafeEvalMode(
  typeof __FORMA_UNSAFE_EVAL_MODE__ === 'string'
    ? __FORMA_UNSAFE_EVAL_MODE__
    : undefined,
);

if (buildUnsafeEvalMode) {
  _unsafeEvalMode = buildUnsafeEvalMode;
  if (_unsafeEvalMode === 'locked-off') _allowUnsafeEval = false;
  if (_unsafeEvalMode === 'locked-on') _allowUnsafeEval = true;
  if (_unsafeEvalMode === 'mutable') _allowUnsafeEval = true;
}

const runtimeConfig = readRuntimeConfig();
const configUnsafeMode = runtimeConfig.lockUnsafeEval
  ? 'locked-off'
  : runtimeConfig.unsafeEvalMode;
if (configUnsafeMode) {
  _unsafeEvalMode = configUnsafeMode;
  if (_unsafeEvalMode === 'locked-off') _allowUnsafeEval = false;
  if (_unsafeEvalMode === 'locked-on') _allowUnsafeEval = true;
}
if (
  _unsafeEvalMode === 'mutable'
  && typeof runtimeConfig.allowUnsafeEval === 'boolean'
) {
  _allowUnsafeEval = runtimeConfig.allowUnsafeEval;
}
if (typeof runtimeConfig.diagnostics === 'boolean') {
  _diagnosticsEnabled = runtimeConfig.diagnostics;
}
const _autoContainment = runtimeConfig.autoContainment === true;

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

const RE_STRING_SINGLE = /^'[^']*'$/;
const RE_STRING_DOUBLE = /^"[^"]*"$/;
const RE_NUMBER = /^-?\d+(\.\d+)?$/;
const RE_IDENTIFIER = /^[a-zA-Z_$]\w*$/;
const RE_DOT_ACCESS = /^(\w+)\.(\w+)$/;
const RE_DEEP_DOT = /^(\w+)\.(\w+)\.(\w+)(?:\.(\w+))?$/;
const RE_BRACKET = /^(\w+)\[(\d+|'[^']*'|"[^"]*")\]$/;
const RE_TERNARY = /^(.+?)\s*\?\s*(.+?)\s*:\s*(.+)$/;
const RE_NULLISH = /^(.+?)\s*\?\?\s*(.+)$/;
const RE_AND = /^(.+?)\s*&&\s*(.+)$/;
const RE_OR = /^(.+?)\s*\|\|\s*(.+)$/;
const RE_COMPARISON = /^(.+?)\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+)$/;
const RE_MUL = /^(.+?)\s*([*/%])\s*(.+)$/;
const RE_ADD = /^(.+?)\s*([+-])\s*(.+)$/;
const RE_TEMPLATE_LIT = /^`([^`]*)`$/;
const RE_TEMPLATE_INTERP = /\$\{([^}]+)\}/g;
const RE_METHOD_CALL = /^(\w+)\.(\w+)\((.*)\)$/;
const RE_GROUP_METHOD_CALL = /^\((.+)\)\.(\w+)\((.*)\)$/;
const RE_STRIP_BRACES = /^\{|\}$/g;
const RE_ITEM_TEMPLATE = /\{item\.?(\w*)\}/g;
const RE_DIGIT_ONLY = /^\d+$/;
const RE_POST_INCR = /^(\w+)(\+\+|--)$/;
const RE_PRE_INCR = /^(\+\+|--)(\w+)$/;
const RE_TOGGLE = /^(\w+)\s*=\s*!(\w+)$/;
const RE_ASSIGN = /^(\w+)\s*=\s*(.+)$/;
const RE_COMPOUND = /^(\w+)\s*(\+=|-=|\*=|\/=)\s*(.+)$/;
const RE_IF_PREFIX = /^if\b/;
// RE_UNQUOTED_KEYS removed in v0.5.0 — relaxed JSON parsing corrupted URLs
// and string values containing colons. Use valid JSON in data-forma-state.
const RE_COMPUTED = /^(\w+)\s*=\s*(.+)$/;
const RE_FETCH = /^(.+?)(?:→|->)\s*(\S+)(.*)$/;
const RE_FETCH_METHOD = /^(GET|POST|PUT|PATCH|DELETE)\s+(.+)$/i;
const RE_STRIP_ITEM_BRACES = /^\{item\.?|\}$/g;
// Detect expressions referencing DOM event parameters — these can't be resolved
// through scope getters and must fall through to the new Function handler path.
const RE_EVENT_REF = /\bevent\s*[.([]|\$event\b/;
const RE_REFETCH_CALL = /^\$refetch\(\s*['"]([^'"]+)['"]\s*\)$/;

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

// ── Expression factory cache ──
// Maps expression string -> factory function that takes a scope and returns a getter.
// This avoids re-parsing the same expression pattern across different scopes.
type ExpressionFactory = (scope: Scope) => (() => unknown) | null;
const EXPRESSION_CACHE_MAX = 2048;
const expressionCache = new Map<string, ExpressionFactory>();
function cacheExpression(key: string, factory: ExpressionFactory): void {
  if (expressionCache.size >= EXPRESSION_CACHE_MAX) {
    // Evict oldest entry (first inserted)
    const first = expressionCache.keys().next().value;
    if (first !== undefined) expressionCache.delete(first);
  }
  expressionCache.set(key, factory);
}
let scopeExpressionCache = new WeakMap<Scope, Map<string, () => unknown>>();

interface HandlerBuildResult {
  handler: (e: Event) => void;
  supported: boolean;
}

let scopeHandlerCache = new WeakMap<Scope, Map<string, HandlerBuildResult>>();

// ── Compiled template cache ──
// Pre-splits template text into static/dynamic segments for fast re-evaluation.
interface CompiledTemplate {
  statics: string[];
  dynamics: string[]; // expression strings between {item.xxx}
  hasItemRef: boolean;
}

const compiledTemplateCache = new Map<string, CompiledTemplate>();
const UNSAFE_METHOD_NAMES = new Set([
  'constructor', '__proto__', 'prototype',
  '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__',
  'eval', 'Function',
]);

/**
 * Pre-compiled regexes for each blocked method name — avoids re-creating
 * RegExp objects on every call.
 */
const BLOCKED_METHOD_REGEXES: Array<{ name: string; dotRe: RegExp; bracketRe: RegExp }> = (() => {
  const result: Array<{ name: string; dotRe: RegExp; bracketRe: RegExp }> = [];
  for (const name of UNSAFE_METHOD_NAMES) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result.push({
      name,
      // Match as property access (.name) or bare identifier at start
      dotRe: new RegExp(`(?:^|\\.)${escaped}(?:\\s*\\(|\\s*$|[^\\w$])`, 'm'),
      // Match bracket access with single quotes, double quotes, or backticks
      bracketRe: new RegExp(`\\[\\s*(?:'${escaped}'|"${escaped}"|` + '`' + escaped + '`' + `)\\s*\\]`),
    });
  }
  return result;
})();

/**
 * Scan an expression string for any UNSAFE_METHOD_NAMES usage.
 * Uses word-boundary matching to avoid false positives on substrings
 * (e.g. "constructorValue" should not match "constructor").
 *
 * Before scanning:
 * 1. Strips JS block comments and line comments
 * 2. Normalizes whitespace around dots (e.g. "x . constructor" → "x.constructor")
 * 3. Checks bracket access with static string literals and backtick templates
 * 4. Detects string concatenation inside brackets that could produce a blocked name
 *
 * Returns the matched blocked name, or null if clean.
 */
function findBlockedMethod(expr: string): string | null {
  // Strip block comments (/* ... */)
  let cleaned = expr.replace(/\/\*[\s\S]*?\*\//g, '');
  // Strip line comments (// ... to end of line)
  cleaned = cleaned.replace(/\/\/[^\n]*/g, '');
  // Normalize whitespace around dots: "x . constructor" → "x.constructor"
  cleaned = cleaned.replace(/\s*\.\s*/g, '.');

  for (const { name, dotRe, bracketRe } of BLOCKED_METHOD_REGEXES) {
    if (dotRe.test(cleaned)) return name;
    if (bracketRe.test(cleaned)) return name;
  }

  // Layer 2: detect string concatenation inside brackets that could produce
  // a blocked name. Extract all bracket contents and check if concatenated
  // string fragments could form a blocked name.
  // e.g. x['constr' + 'uctor'] → extract 'constr' and 'uctor' → 'constructor'
  if (cleaned.includes('[')) {
    const bracketContents = extractBracketContents(cleaned);
    for (const content of bracketContents) {
      // Only check contents with concatenation operators
      if (!content.includes('+')) continue;
      // Extract all string literal fragments and join them
      const fragments = content.match(/['"`]([^'"`]*?)['"`]/g);
      if (!fragments) continue;
      const joined = fragments.map(f => f.slice(1, -1)).join('');
      if (UNSAFE_METHOD_NAMES.has(joined)) return joined;
    }
  }

  return null;
}

/** Extract the contents of all bracket access expressions (between [ and ]). */
function extractBracketContents(expr: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < expr.length; i++) {
    if (expr[i] === '[') {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (expr[i] === ']') {
      depth--;
      if (depth === 0 && start >= 0) {
        results.push(expr.slice(start, i));
        start = -1;
      }
    }
  }
  return results;
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

function splitCallArgs(raw: string): string[] {
  const out: string[] = [];
  if (raw.trim() === '') return out;

  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let start = 0;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\') {
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

    if (ch === '\'') {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }

    if (ch === '(') {
      depth++;
      continue;
    }
    if (ch === ')') {
      if (depth > 0) depth--;
      continue;
    }

    if (ch === ',' && depth === 0) {
      out.push(raw.slice(start, i).trim());
      start = i + 1;
    }
  }

  out.push(raw.slice(start).trim());
  return out.filter(Boolean);
}

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

function splitTopLevelStatements(raw: string): string[] {
  const input = raw.trim();
  if (!input) return [];

  const out: string[] = [];
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escaped = false;
  let start = 0;

  for (let i = 0; i < input.length; i++) {
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

    if (ch === '(') depthParen++;
    else if (ch === ')' && depthParen > 0) depthParen--;
    else if (ch === '{') depthBrace++;
    else if (ch === '}' && depthBrace > 0) depthBrace--;
    else if (ch === '[') depthBracket++;
    else if (ch === ']' && depthBracket > 0) depthBracket--;

    if (ch === ';' && depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
      const stmt = input.slice(start, i).trim();
      if (stmt) out.push(stmt);
      start = i + 1;
    }
  }

  const tail = input.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

function consumeStatement(raw: string): { body: string; rest: string } | null {
  const input = raw.trim();
  if (!input) return null;

  if (input.startsWith('{')) {
    const block = readBalancedSegment(input, 0, '{', '}');
    if (!block) return null;
    const body = block.inner.trim();
    let rest = input.slice(block.end + 1).trim();
    if (rest.startsWith(';')) rest = rest.slice(1).trim();
    return { body, rest };
  }

  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
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

    if (ch === '(') depthParen++;
    else if (ch === ')' && depthParen > 0) depthParen--;
    else if (ch === '{') depthBrace++;
    else if (ch === '}' && depthBrace > 0) depthBrace--;
    else if (ch === '[') depthBracket++;
    else if (ch === ']' && depthBracket > 0) depthBracket--;

    if (ch === ';' && depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
      return {
        body: input.slice(0, i).trim(),
        rest: input.slice(i + 1).trim(),
      };
    }
  }

  return {
    body: input,
    rest: '',
  };
}

function parseIfHandler(expr: string, scope: Scope): ((e: Event) => void) | null {
  const input = expr.trim();
  if (!RE_IF_PREFIX.test(input)) return null;

  // If the expression references DOM event parameters (`event`, `$event`),
  // bail out — these aren't in scope getters and must use new Function.
  if (RE_EVENT_REF.test(input)) return null;

  let idx = 2;
  while (idx < input.length && /\s/.test(input[idx]!)) idx++;
  if (input[idx] !== '(') return null;

  const condSegment = readBalancedSegment(input, idx, '(', ')');
  if (!condSegment) return null;

  const condExpr = parseExpression(condSegment.inner.trim(), scope);
  if (!condExpr) return null;

  let rest = input.slice(condSegment.end + 1).trim();
  const thenStmt = consumeStatement(rest);
  if (!thenStmt || !thenStmt.body) return null;

  const thenHandler = parseHandler(thenStmt.body, scope);
  if (!thenHandler) return null;

  rest = thenStmt.rest.trim();
  let elseHandler: ((e: Event) => void) | null = null;
  if (rest.startsWith('else')) {
    rest = rest.slice('else'.length).trim();
    const elseStmt = consumeStatement(rest);
    if (!elseStmt || !elseStmt.body) return null;
    elseHandler = parseHandler(elseStmt.body, scope);
    if (!elseHandler) return null;
    rest = elseStmt.rest.trim();
  }

  if (rest.length > 0) return null;

  return (e: Event) => {
    batch(() => {
      if (condExpr()) thenHandler(e);
      else elseHandler?.(e);
    });
  };
}

function unwrapOuterParens(raw: string): string {
  let expr = raw.trim();
  while (expr.startsWith('(')) {
    const segment = readBalancedSegment(expr, 0, '(', ')');
    if (!segment || segment.end !== expr.length - 1) break;
    const inner = segment.inner.trim();
    if (!inner) break;
    expr = inner;
  }
  return expr;
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
  compiledTemplateCache.set(text, result);
  return result;
}

// ── Template text caching for data-list ──

/** Maps text nodes to their compiled template (pre-split static/dynamic segments). */
const templateTexts = new WeakMap<Node, CompiledTemplate>();

/**
 * Resolve template placeholders in a text string using pre-compiled template.
 * Concatenates static segments with evaluated dynamic segments.
 */
function resolveTemplate(text: string, item: unknown): string {
  const compiled = compileTemplate(text);
  return evaluateCompiledTemplate(compiled, item);
}

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
        node.setAttribute(attr.name, evaluateCompiledTemplate(compiled, item));
      }
    }
    if (entries.length > 0) {
      templateAttrs.set(node, entries);
    }
  }
}

// ── Chained access / optional chaining parser ──

/**
 * Represents a single step in a property/method chain.
 * - type 'prop': property access (`.name` or `?.name`)
 * - type 'call': method call (`.method(args)` or `?.method(args)`)
 */
interface ChainStep {
  type: 'prop' | 'call';
  name: string;
  optional: boolean; // true for `?.`
  argFns?: Array<() => unknown>; // only for 'call' type
}

/**
 * Parse an expression that starts with an identifier and is followed by
 * zero or more chain steps: `.prop`, `?.prop`, `.method(args)`, `?.method(args)`.
 * Returns null if the expression doesn't match this pattern.
 *
 * Handles: "user.name", "user?.name", "str.trim().toUpperCase()",
 * "obj?.method()", "items.filter(x).map(y)", "a.b.c.d" (any depth).
 */
function parseChainedAccess(expr: string, scope: Scope): (() => unknown) | null {
  // Must start with an identifier (or Math)
  let pos = 0;
  const identMatch = expr.match(/^[a-zA-Z_$]\w*/);
  if (!identMatch) return null;

  const rootName = identMatch[0]!;
  pos = rootName.length;

  // Must have at least one chain step after the identifier
  if (pos >= expr.length) return null;
  // Next char must be '.' or '?' (for '?.')
  if (expr[pos] !== '.' && !(expr[pos] === '?' && expr[pos + 1] === '.')) return null;

  const steps: ChainStep[] = [];

  while (pos < expr.length) {
    let optional = false;

    // Check for `?.` (optional chaining) or `.` (regular access)
    if (expr[pos] === '?' && expr[pos + 1] === '.') {
      optional = true;
      pos += 2;
    } else if (expr[pos] === '.') {
      pos += 1;
    } else {
      // Not a chain continuation — unexpected character
      return null;
    }

    // Parse property/method name
    const nameMatch = expr.slice(pos).match(/^\w+/);
    if (!nameMatch) return null;
    const name = nameMatch[0]!;
    pos += name.length;

    if (UNSAFE_METHOD_NAMES.has(name)) return () => undefined;

    // Check if this is a method call: followed by `(`
    if (pos < expr.length && expr[pos] === '(') {
      const balanced = readBalancedSegment(expr, pos, '(', ')');
      if (!balanced) return null;

      const argsRaw = balanced.inner.trim();
      const argFns: Array<() => unknown> = [];
      for (const arg of splitCallArgs(argsRaw)) {
        const parsed = parseExpression(arg, scope);
        if (!parsed) return null;
        argFns.push(parsed);
      }

      steps.push({ type: 'call', name, optional, argFns });
      pos = balanced.end + 1;
    } else {
      steps.push({ type: 'prop', name, optional });
    }
  }

  // If we didn't consume the entire expression, this isn't a simple chain
  if (pos !== expr.length) return null;

  // If there are no steps, fall back (just an identifier)
  if (steps.length === 0) return null;

  // Build the root expression getter
  const rootExpr = rootName === 'Math'
    ? (() => Math)
    : (() => scope.getters[rootName]?.());

  return () => {
    let val: any = rootExpr();
    for (const step of steps) {
      if (val == null) {
        if (step.optional) return undefined;
        // Non-optional access on null/undefined — use ?. semantics
        // (existing behavior used ?. for dot access)
        return undefined;
      }
      if (step.type === 'prop') {
        val = val[step.name];
      } else {
        const method = val[step.name];
        if (typeof method !== 'function') return undefined;
        const args = step.argFns!.map(fn => fn());
        val = method.apply(val, args);
      }
    }
    return val;
  };
}

// ── CSP-safe expression parser ──

/**
 * Parse a simple expression into a closure that evaluates against the scope.
 * Handles common patterns without requiring `new Function()` or `eval`.
 * Returns null if the expression is too complex for the CSP-safe parser.
 */
function parseExpression(expr: string, scope: Scope): (() => unknown) | null {
  // Check expression factory cache first
  const cachedFactory = expressionCache.get(expr);
  if (cachedFactory) return cachedFactory(scope);

  const result = parseExpressionUncached(expr, scope);

  // Cache factory functions for common simple patterns that can be re-bound to different scopes
  if (result !== null) {
    // Cache factories for simple patterns (identifier, dot access, etc.)
    // Complex patterns with sub-expressions are scope-dependent and harder to cache as factories,
    // but we can still cache the structural match result for them.
    // Keyword literals MUST be checked before RE_IDENTIFIER — "true", "false",
    // "null", "undefined" all match /^[a-zA-Z_$]\w*$/ and would be incorrectly
    // cached as scope variable lookups (returning undefined).
    if (expr === 'true' || expr === 'false' || expr === 'null' || expr === 'undefined') {
      const val = expr === 'true' ? true : expr === 'false' ? false : expr === 'null' ? null : undefined;
      cacheExpression(expr, () => () => val);
    } else if (RE_IDENTIFIER.test(expr)) {
      cacheExpression(expr, (s) => () => s.getters[expr]?.());
    } else if (RE_STRING_SINGLE.test(expr) || RE_STRING_DOUBLE.test(expr)) {
      const val = expr.slice(1, -1);
      cacheExpression(expr, () => () => val);
    } else if (RE_NUMBER.test(expr)) {
      const val = Number(expr);
      cacheExpression(expr, () => () => val);
    } else {
      const dotMatch = expr.match(RE_DOT_ACCESS);
      if (dotMatch) {
        const p1 = dotMatch[1]!, p2 = dotMatch[2]!;
        cacheExpression(expr, (s) => () => {
          const obj = s.getters[p1]?.();
          return (obj as any)?.[p2];
        });
      }
    }
  }

  return result;
}

/**
 * Core expression parser — called on cache miss.
 * Uses pre-compiled module-level regexes for all pattern matching.
 */
function parseExpressionUncached(expr: string, scope: Scope): (() => unknown) | null {
  expr = expr.trim();

  // Parenthesized group: "(a + b)", "((count))"
  const unwrapped = unwrapOuterParens(expr);
  if (unwrapped !== expr) {
    return parseExpression(unwrapped, scope);
  }

  // Literals first (before identifier check, since \w matches digits)

  // String literals
  if (RE_STRING_SINGLE.test(expr) || RE_STRING_DOUBLE.test(expr)) {
    const val = expr.slice(1, -1);
    return () => val;
  }

  // Number literals
  if (RE_NUMBER.test(expr)) {
    const val = Number(expr);
    return () => val;
  }

  // Boolean / null / undefined literals
  if (expr === 'true') return () => true;
  if (expr === 'false') return () => false;
  if (expr === 'null') return () => null;
  if (expr === 'undefined') return () => undefined;

  // Simple identifier: "count", "name" (must start with letter/underscore/$)
  if (RE_IDENTIFIER.test(expr)) {
    return () => scope.getters[expr]?.();
  }

  // Chained access / method calls / optional chaining:
  // "user.name", "user?.name", "str.trim().toUpperCase()", "obj?.method()", "items.filter(x).map(y)"
  // Also handles simple dot access, deep dot access, and single method calls.
  {
    const chainResult = parseChainedAccess(expr, scope);
    if (chainResult) return chainResult;
  }

  // Grouped method call: "(expr).method(args)" — base is a parenthesized expression
  const groupedCallMatch = expr.match(RE_GROUP_METHOD_CALL);
  if (groupedCallMatch) {
    const baseRaw = groupedCallMatch[1]!.trim();
    const methodName = groupedCallMatch[2]!;
    const argsRaw = groupedCallMatch[3]!.trim();

    if (UNSAFE_METHOD_NAMES.has(methodName)) return () => undefined;

    const baseExpr = parseExpression(baseRaw, scope);
    if (!baseExpr) return null;

    const argFns: Array<() => unknown> = [];
    for (const arg of splitCallArgs(argsRaw)) {
      const parsed = parseExpression(arg, scope);
      if (!parsed) return null;
      argFns.push(parsed);
    }

    return () => {
      const base = baseExpr() as any;
      const method = base?.[methodName];
      if (typeof method !== 'function') return undefined;
      const args = argFns.map(fn => fn());
      return method.apply(base, args);
    };
  }

  // Negation: "!active", "!user.loggedIn"
  if (expr.startsWith('!')) {
    const inner = parseExpression(expr.slice(1).trim(), scope);
    if (inner) return () => !inner();
  }

  // Bracket access: "items[0]", "obj['key']"
  const bracketMatch = expr.match(RE_BRACKET);
  if (bracketMatch) {
    const objExpr = parseExpression(bracketMatch[1]!, scope);
    let key: string | number;
    const rawKey = bracketMatch[2]!;
    if (RE_DIGIT_ONLY.test(rawKey)) {
      key = Number(rawKey);
    } else {
      key = rawKey.slice(1, -1);
    }
    if (objExpr) {
      return () => (objExpr() as any)?.[key];
    }
  }

  // Array literal: "[1, 2, 3]", "[item.name, item.id]", "['a', 'b']"
  if (expr.startsWith('[')) {
    const balanced = readBalancedSegment(expr, 0, '[', ']');
    if (balanced && balanced.end === expr.length - 1) {
      const inner = balanced.inner.trim();
      if (inner === '') {
        // Empty array: []
        return () => [];
      }
      const elements = splitCallArgs(inner);
      const elementFns: Array<() => unknown> = [];
      let allParsed = true;
      for (const el of elements) {
        const parsed = parseExpression(el.trim(), scope);
        if (!parsed) { allParsed = false; break; }
        elementFns.push(parsed);
      }
      if (allParsed) {
        return () => elementFns.map(fn => fn());
      }
    }
  }

  // Ternary: "expr ? a : b"
  const ternaryMatch = expr.match(RE_TERNARY);
  if (ternaryMatch) {
    const cond = parseExpression(ternaryMatch[1]!.trim(), scope);
    const then = parseExpression(ternaryMatch[2]!.trim(), scope);
    const els = parseExpression(ternaryMatch[3]!.trim(), scope);
    if (cond && then && els) {
      return () => cond() ? then() : els();
    }
  }

  // Nullish coalescing: "value ?? 'default'"
  const nullishMatch = expr.match(RE_NULLISH);
  if (nullishMatch) {
    const left = parseExpression(nullishMatch[1]!.trim(), scope);
    const right = parseExpression(nullishMatch[2]!.trim(), scope);
    if (left && right) {
      return () => left() ?? right();
    }
  }

  // Logical AND: "a && b"
  const andMatch = expr.match(RE_AND);
  if (andMatch) {
    const left = parseExpression(andMatch[1]!.trim(), scope);
    const right = parseExpression(andMatch[2]!.trim(), scope);
    if (left && right) {
      return () => left() && right();
    }
  }

  // Logical OR: "a || b"
  const orMatch = expr.match(RE_OR);
  if (orMatch) {
    const left = parseExpression(orMatch[1]!.trim(), scope);
    const right = parseExpression(orMatch[2]!.trim(), scope);
    if (left && right) {
      return () => left() || right();
    }
  }

  // Comparison operators: ===, !==, ==, !=, >=, <=, >, <
  const compMatch = expr.match(RE_COMPARISON);
  if (compMatch) {
    const left = parseExpression(compMatch[1]!.trim(), scope);
    const right = parseExpression(compMatch[3]!.trim(), scope);
    if (left && right) {
      const op = compMatch[2]!;
      return () => {
        const l = left(), r = right();
        switch (op) {
          case '===': return l === r;
          case '!==': return l !== r;
          case '==': return l == r;
          case '!=': return l != r;
          case '>': return (l as number) > (r as number);
          case '<': return (l as number) < (r as number);
          case '>=': return (l as number) >= (r as number);
          case '<=': return (l as number) <= (r as number);
        }
      };
    }
  }

  // Arithmetic: +, -, *, /, %
  // Try * / % first (higher precedence), then + -
  const mulMatch = expr.match(RE_MUL);
  if (mulMatch) {
    const left = parseExpression(mulMatch[1]!.trim(), scope);
    const right = parseExpression(mulMatch[3]!.trim(), scope);
    if (left && right) {
      const op = mulMatch[2]!;
      return () => {
        const l = left() as number, r = right() as number;
        switch (op) {
          case '*': return l * r;
          case '/': return l / r;
          case '%': return l % r;
        }
      };
    }
  }

  // Addition / subtraction (also handles string concatenation for +)
  const addMatch = expr.match(RE_ADD);
  if (addMatch) {
    const left = parseExpression(addMatch[1]!.trim(), scope);
    const right = parseExpression(addMatch[3]!.trim(), scope);
    if (left && right) {
      const op = addMatch[2]!;
      return () => {
        const l = left(), r = right();
        if (op === '+') return (l as any) + (r as any);
        return (l as number) - (r as number);
      };
    }
  }

  // Template literals: `Hello ${name}`
  const tmplMatch = expr.match(RE_TEMPLATE_LIT);
  if (tmplMatch) {
    const raw = tmplMatch[1]!;
    // Pre-split template literal into static/dynamic segments
    const staticParts: string[] = [];
    const dynamicFns: (() => unknown)[] = [];
    let lastIndex = 0;
    // Create a fresh regex since RE_TEMPLATE_INTERP has the 'g' flag
    const re = new RegExp(RE_TEMPLATE_INTERP.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      staticParts.push(raw.slice(lastIndex, m.index));
      const inner = parseExpression(m[1]!.trim(), scope);
      if (!inner) return null; // Can't parse inner expression
      dynamicFns.push(inner);
      lastIndex = re.lastIndex;
    }
    staticParts.push(raw.slice(lastIndex));

    // Optimized evaluation: concatenate instead of map+join
    return () => {
      let result = staticParts[0]!;
      for (let i = 0; i < dynamicFns.length; i++) {
        result += String(dynamicFns[i]!() ?? '');
        result += staticParts[i + 1] ?? '';
      }
      return result;
    };
  }

  // Can't parse — return null for fallback
  return null;
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

/** Build an actionable hint for expressions/handlers that failed CSP-safe parsing. */
function cspExpressionHint(expr: string): string {
  if (expr.includes('...')) {
    return `Unsupported expression in CSP-safe mode: spread syntax detected. Use .concat() instead, or enable unsafe-eval via setUnsafeEval(true).`;
  }
  // Note: optional chaining (?.) is now supported by the CSP-safe parser.
  if (expr.includes('=>')) {
    return `Unsupported expression in CSP-safe mode: arrow function detected. Extract logic to a data-computed attribute, or enable unsafe-eval via setUnsafeEval(true).`;
  }
  return `Unsupported expression in CSP-safe mode. Simplify the expression or enable unsafe-eval via setUnsafeEval(true).`;
}

function buildEvaluator(expr: string, scope: Scope): () => unknown {
  const cleaned = expr.replace(RE_STRIP_BRACES, '').trim();
  const cache = getScopeCache(scopeExpressionCache, scope);
  const cached = cache.get(cleaned);
  if (cached) return cached;

  // Try CSP-safe parsing first
  const cspFn = parseExpression(cleaned, scope);
  if (cspFn) {
    cache.set(cleaned, cspFn);
    return cspFn;
  }

  // Fallback to Function constructor (for complex expressions)
  if (!_allowUnsafeEval) {
    dbg('buildEvaluator: blocked unsafe eval fallback for expression:', cleaned);
    reportDiagnostic('expression-unsupported', cleaned, cspExpressionHint(cleaned));
    const blocked = () => undefined;
    cache.set(cleaned, blocked);
    return blocked;
  }

  // Apply UNSAFE_METHOD_NAMES blocklist before new Function — prevents
  // prototype-pollution and eval injection via the unsafe eval path.
  const blockedMethod = findBlockedMethod(cleaned);
  if (blockedMethod) {
    const msg = `Blocked unsafe method "${blockedMethod}" in expression`;
    reportDiagnostic('expression-unsupported', cleaned, msg);
    throw new Error(`[FormaJS] ${msg}: ${cleaned}`);
  }

  try {
    const fn = new Function('__scope', `with(__scope) { return (${cleaned}); }`);
    // Cache proxy — scope.getters is a mutable object, so the proxy
    // always reflects current state without needing to be recreated.
    const proxy = new Proxy(Object.create(null) as Record<string, unknown>, {
      has(_, key: string) { return key in scope.getters; },
      get(_, key: string) {
        // Defense-in-depth: block dangerous property access even if
        // findBlockedMethod missed a bypass (e.g. computed bracket names)
        if (UNSAFE_METHOD_NAMES.has(key)) return undefined;
        const g = scope.getters[key];
        return g ? g() : undefined;
      },
    });
    const unsafe = () => fn(proxy);
    cache.set(cleaned, unsafe);
    return unsafe;
  } catch {
    reportDiagnostic('expression-unsupported', cleaned, 'Expression too complex for CSP-safe mode. Enable unsafe-eval via FormaRuntime.unsafeEval = true, or use the standard (non-hardened) build.');
    const failed = () => undefined;
    cache.set(cleaned, failed);
    return failed;
  }
}

// ── CSP-safe handler parser ──

/**
 * Parse common handler patterns without `new Function()`.
 * Returns null if the expression is too complex for the CSP-safe parser.
 */
function parseHandler(expr: string, scope: Scope): ((e: Event) => void) | null {
  const normalized = expr.trim().replace(/;+$/g, '').trim();
  if (!normalized) return null;

  const ifHandler = parseIfHandler(normalized, scope);
  if (ifHandler) return ifHandler;

  const stmts = splitTopLevelStatements(normalized);
  if (stmts.length > 1) {
    const handlers = stmts.map(s => parseHandler(s, scope));
    if (handlers.every(h => h !== null)) {
      return (e: Event) => {
        batch(() => {
          for (const h of handlers) h!(e);
        });
      };
    }
    return null;
  }

  const single = stmts[0] ?? normalized;

  // count++ or count--
  const incrMatch = single.match(RE_POST_INCR);
  if (incrMatch) {
    const name = incrMatch[1]!;
    const op = incrMatch[2]!;
    return () => {
      batch(() => {
        const val = scope.getters[name]?.() as number ?? 0;
        scope.setters[name]?.(op === '++' ? val + 1 : val - 1);
      });
    };
  }

  // ++count or --count
  const preIncrMatch = single.match(RE_PRE_INCR);
  if (preIncrMatch) {
    const op = preIncrMatch[1]!;
    const name = preIncrMatch[2]!;
    return () => {
      batch(() => {
        const val = scope.getters[name]?.() as number ?? 0;
        scope.setters[name]?.(op === '++' ? val + 1 : val - 1);
      });
    };
  }

  // prop = !prop (toggle)
  const toggleMatch = single.match(RE_TOGGLE);
  if (toggleMatch && toggleMatch[1] === toggleMatch[2]) {
    const name = toggleMatch[1]!;
    return () => {
      batch(() => {
        scope.setters[name]?.(!scope.getters[name]?.());
      });
    };
  }

  // prop = expr (simple assignment)
  const assignMatch = single.match(RE_ASSIGN);
  if (assignMatch) {
    const name = assignMatch[1]!;
    const valExpr = parseExpression(assignMatch[2]!.trim(), scope);
    if (valExpr) {
      if (_debug) dbg(`parseHandler: assignment "${name} = ..." — setter exists:`, !!scope.setters[name], ', getter exists:', !!scope.getters[name]);
      return () => {
        batch(() => {
          const val = valExpr();
          if (_debug) dbg(`SETTER: ${name} = ${val} (was: ${scope.getters[name]?.()})`);
          scope.setters[name]?.(val);
        });
      };
    }
  }

  // prop += value, prop -= value, prop *= value, prop /= value
  const compoundMatch = single.match(RE_COMPOUND);
  if (compoundMatch) {
    const name = compoundMatch[1]!;
    const op = compoundMatch[2]!;
    const valExpr = parseExpression(compoundMatch[3]!.trim(), scope);
    if (valExpr) {
      return () => {
        batch(() => {
          const current = scope.getters[name]?.() as number ?? 0;
          const val = valExpr() as number;
          switch (op) {
            case '+=': scope.setters[name]?.(current + val); break;
            case '-=': scope.setters[name]?.(current - val); break;
            case '*=': scope.setters[name]?.(current * val); break;
            case '/=': scope.setters[name]?.(current / val); break;
          }
        });
      };
    }
  }

  // $refetch('id') — imperative data-fetch trigger (CSP-safe)
  const refetchMatch = single.match(RE_REFETCH_CALL);
  if (refetchMatch) {
    const fetchId = refetchMatch[1]!;
    return () => $refetch(fetchId);
  }

  return null;
}

function buildHandler(expr: string, scope: Scope): HandlerBuildResult {
  // Strip balanced outer braces (e.g., `{count++}` → `count++`) but NOT
  // unbalanced ones like `if (x) { a = b }` where the `}` is a code-block close.
  let cleaned = expr.trim();
  if (cleaned.startsWith('{')) {
    const seg = readBalancedSegment(cleaned, 0, '{', '}');
    if (seg && seg.end === cleaned.length - 1) {
      cleaned = seg.inner.trim();
    }
  }
  const cache = getScopeCache(scopeHandlerCache, scope);
  const cached = cache.get(cleaned);
  if (cached) return cached;

  // Try CSP-safe parsing first
  const cspFn = parseHandler(cleaned, scope);
  if (cspFn) {
    const result: HandlerBuildResult = { handler: cspFn, supported: true };
    cache.set(cleaned, result);
    return result;
  }

  // Fallback to Function constructor (for complex expressions)
  // Use a Proxy with getters and setters so the handler can both read and
  // mutate state (e.g. "count++", "active = !active").
  if (!_allowUnsafeEval) {
    dbg('buildHandler: blocked unsafe eval fallback for expression:', cleaned);
    reportDiagnostic('handler-unsupported', cleaned, cspExpressionHint(cleaned));
    const result: HandlerBuildResult = {
      handler: () => {},
      supported: false,
    };
    cache.set(cleaned, result);
    return result;
  }

  // Apply UNSAFE_METHOD_NAMES blocklist before new Function — prevents
  // prototype-pollution and eval injection via the unsafe eval path.
  const blockedMethod = findBlockedMethod(cleaned);
  if (blockedMethod) {
    const msg = `Blocked unsafe method "${blockedMethod}" in handler`;
    reportDiagnostic('handler-unsupported', cleaned, msg);
    throw new Error(`[FormaJS] ${msg}: ${cleaned}`);
  }

  try {
    // Accept both `$event` and bare `event` — Claude sometimes generates either.
    const fn = new Function('__scope', '$event', 'event', `with(__scope) { ${cleaned} }`);
    // Cache proxy — scope.getters/setters are mutable objects, so the proxy
    // always reflects current state without needing to be recreated.
    const proxy = new Proxy(Object.create(null) as Record<string, unknown>, {
      has(_, key: string) {
        // Do NOT intercept '$event' or 'event' — let them fall through to
        // function parameters so $event.key, event.stopPropagation(), etc. work.
        if (key === '$event' || key === 'event') return false;
        return key in scope.getters || key in scope.setters;
      },
      get(_, key: string) {
        // Defense-in-depth: block dangerous property access
        if (UNSAFE_METHOD_NAMES.has(key)) return undefined;
        const g = scope.getters[key];
        return g ? g() : undefined;
      },
      set(_, key: string, value: unknown) {
        const s = scope.setters[key];
        if (s) s(value);
        return true;
      },
    });
    const unsafeHandler = (e: Event) => {
      batch(() => fn(proxy, e, e));
    };
    const result: HandlerBuildResult = {
      handler: unsafeHandler,
      supported: true,
    };
    cache.set(cleaned, result);
    return result;
  } catch {
    reportDiagnostic('handler-unsupported', cleaned, 'Expression too complex for CSP-safe mode. Enable unsafe-eval via FormaRuntime.unsafeEval = true, or use the standard (non-hardened) build.');
    const result: HandlerBuildResult = {
      handler: () => {},
      supported: false,
    };
    cache.set(cleaned, result);
    return result;
  }
}

// ── State initialization ──

const FORBIDDEN_STATE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function parseState(raw: string): Record<string, unknown> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    if (_debug) {
      dbg('parseState: Invalid JSON in data-forma-state — use valid JSON with quoted keys. Got:', raw.slice(0, 200));
    }
    return {};
  }
  // Strip prototype-pollution keys
  for (const key of FORBIDDEN_STATE_KEYS) {
    if (key in parsed) delete parsed[key];
  }
  return parsed;
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
  const getters: Record<string, Getter> = {};
  const setters: Record<string, Setter> = {};

  for (const [key, initial] of Object.entries(state)) {
    const [get, set] = createValueSignal(initial);
    getters[key] = get;
    setters[key] = set as Setter;
  }

  // Inject $refetch as a callable getter so handlers can use $refetch('id')
  getters['$refetch'] = () => $refetch;

  return { getters, setters };
}

function bindElement(el: Element, scope: Scope, disposers: (() => void)[]): void {
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
        const evaluate = buildEvaluator(`{${expr}}`, scope);
        const getter = createComputed(evaluate);
        scope.getters[name] = getter;
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
    const evaluate = buildEvaluator(textExpr, scope);
    const dispose = internalEffect(() => {
      setElementTextFast(el, toTextValue(evaluate()));
    });
    disposers.push(dispose);
  }

  // data-show="{expr}"
  const showExpr = (!known || known.has('data-show')) ? el.getAttribute('data-show') : null;
  if (showExpr) {
    const evaluate = buildEvaluator(showExpr, scope);
    const transition = parseTransitionSpec(el);
    if (_debug) {
      const tag = el.tagName.toLowerCase();
      const cls = el.className ? `.${String(el.className).split(' ')[0]}` : '';
      dbg(`bindElement: data-show="${showExpr}" on <${tag}${cls}>`);
    }
    let initialized = false;
    const dispose = internalEffect(() => {
      const visible = !!evaluate();
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
    const evaluate = buildEvaluator(ifExpr, scope);
    const transition = parseTransitionSpec(el);
    const placeholder = document.createComment('forma-if');
    const parent = el.parentNode;
    let inserted = true;
    let initialized = false;

    const dispose = internalEffect(() => {
      const show = !!evaluate();

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
    const getter = scope.getters[prop];
    const setter = scope.setters[prop];
    if (getter && setter) {
      const input = el as HTMLInputElement;
      const dispose = internalEffect(() => {
        const val = getter();
        if (input.type === 'checkbox') {
          input.checked = !!val;
        } else {
          input.value = String(val ?? '');
        }
      });
      disposers.push(dispose);
      const event = input.type === 'checkbox' ? 'change' : 'input';
      const onModelInput = () => {
        if (input.type === 'checkbox') {
          setter(input.checked);
        } else if (input.type === 'number' || input.type === 'range') {
          setter(Number(input.value));
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
  const attrs = el.attributes;
  if (hasColonDirectives) for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i]!;
    const name = attr.name;

    if (name.startsWith('data-on:')) {
      const event = name.slice(8); // 'data-on:'.length === 8
      const built = buildHandler(attr.value, scope);
      const handler = built.handler;
      if (_debug) {
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : '';
        const cls = el.className ? `.${String(el.className).split(' ')[0]}` : '';
        dbg(`bindElement: data-on:${event}="${attr.value}" on <${tag}${id}${cls}>`);
      }
      if (!built.supported) {
        el.setAttribute('data-forma-handler-error', 'unsupported');
      } else if (el.hasAttribute('data-forma-handler-error')) {
        el.removeAttribute('data-forma-handler-error');
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
      const evaluate = buildEvaluator(attr.value, scope);
      const dispose = internalEffect(() => {
        el.classList.toggle(cls, !!evaluate());
      });
      disposers.push(dispose);
    } else if (name.startsWith('data-bind:')) {
      const attrName = name.slice(10); // 'data-bind:'.length === 10
      const evaluate = buildEvaluator(attr.value, scope);
      const dispose = internalEffect(() => {
        const val = evaluate();
        if (val == null || val === false) {
          el.removeAttribute(attrName);
        } else {
          el.setAttribute(attrName, String(val));
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
    const evaluate = buildEvaluator(listExpr, scope);
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

        if (keyProp) {
          // ── Property-based keying ──
          const result = reconcileList(
            el,
            oldItems,
            rawItems,
            oldNodes,
            (item: unknown) => String((item as Record<string, unknown>)?.[keyProp] ?? ''),
            (item: unknown) => {
              const idx = rawItems.indexOf(item);
              return createBoundClone(item, idx);
            },
            (node: Node, item: unknown) => {
              const idx = rawItems.indexOf(item);
              updateBoundClone(node, item, idx);
            },
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
        } else {
          // ── Index-based keying ──
          // Wrap items so each carries its index as the key.
          const wrapped: IndexWrapped[] = rawItems.map((item, i) => ({ __idx: i, __item: item }));
          const oldWrapped = oldItems as IndexWrapped[];

          const result = reconcileList<IndexWrapped>(
            el,
            oldWrapped,
            wrapped,
            oldNodes,
            (w: IndexWrapped) => w.__idx,
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
        }
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
      const [getTarget, setTarget] = createValueSignal<unknown>(null);
      scope.getters[target] = getTarget;
      scope.setters[target] = setTarget as Setter;
      if (loadingTarget) {
        const [gl, sl] = createValueSignal(false);
        scope.getters[loadingTarget] = gl;
        scope.setters[loadingTarget] = sl as Setter;
      }
      if (errorTarget) {
        const [ge, se] = createValueSignal<unknown>(null);
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
 * Mount a single `data-forma-state` element — creates signals, binds
 * all descendants, stores disposers on the element for cleanup.
 * Idempotent: skips elements that are already mounted.
 */
/** CSS selector matching elements with at least one Forma directive.
 *  Avoids scanning every descendant — only visits directive-bearing elements. */
const DIRECTIVE_SELECTOR = [
  '[data-text]', '[data-show]', '[data-if]', '[data-model]',
  '[data-computed]', '[data-persist]', '[data-list]', '[data-fetch]',
  '[data-bind\\:*]', '[data-class\\:*]', '[data-on\\:*]',
  // Catch-all for colon-prefixed data attrs that the escaped selectors miss in some engines
  '[data-transition]',
].join(',');

/** Fast check: does this element have any Forma directive attribute? */
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

  // Bind the root itself
  bindElement(root, scope, disposers);

  // Bind only directive-bearing descendants (skip inert elements).
  // When the server provides a directive map, we build a targeted CSS selector
  // that queries only elements with known directives — no querySelectorAll('*').
  let boundCount = 0;
  const selector = buildDirectiveSelector();
  if (selector) {
    // Fast path: query only elements the server told us have directives
    const targets = root.querySelectorAll(selector);
    for (let i = 0; i < targets.length; i++) {
      bindElement(targets[i]!, scope, disposers);
      boundCount++;
    }
  } else {
    // Fallback: scan all descendants and check attributes
    const descendants = root.querySelectorAll('*');
    for (let i = 0; i < descendants.length; i++) {
      const el = descendants[i]!;
      if (hasDirective(el)) {
        bindElement(el, scope, disposers);
        boundCount++;
      }
    }
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

/** Dispose all FormaJS scopes — clears effects, intervals, event listeners, and stops the observer. */
function destroyRuntime(): void {
  stopObserver();
  const stateRoots = document.querySelectorAll('[data-forma-state]');
  for (const root of Array.from(stateRoots)) {
    unmountScope(root);
  }
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
/** Set unsafe-eval mode. `locked-off` is hardened and non-toggleable via setUnsafeEval. */
function setUnsafeEvalMode(mode: UnsafeEvalMode): void {
  if (_unsafeEvalMode === mode) return;
  _unsafeEvalMode = mode;
  if (mode === 'locked-off') _allowUnsafeEval = false;
  if (mode === 'locked-on') _allowUnsafeEval = true;
  if (mode === 'mutable') _allowUnsafeEval = true;
  // Rebuild caches whenever policy changes.
  scopeExpressionCache = new WeakMap<Scope, Map<string, () => unknown>>();
  scopeHandlerCache = new WeakMap<Scope, Map<string, HandlerBuildResult>>();
}
/** Enable/disable unsafe `new Function` fallback for complex expressions. */
function setUnsafeEval(on: boolean): void {
  if (_unsafeEvalMode !== 'mutable') {
    dbg(
      `setUnsafeEval ignored (mode=${_unsafeEvalMode}); unsafe fallback is locked`,
    );
    return;
  }
  if (_allowUnsafeEval === on) return;
  _allowUnsafeEval = on;
  // Rebuild handlers/evaluators after mode change so cached blocked results
  // don't persist when toggling trusted mode at runtime.
  scopeExpressionCache = new WeakMap<Scope, Map<string, () => unknown>>();
  scopeHandlerCache = new WeakMap<Scope, Map<string, HandlerBuildResult>>();
}
/** Get current unsafe-eval policy mode. */
function getUnsafeEvalMode(): UnsafeEvalMode { return _unsafeEvalMode; }
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
  setUnsafeEvalMode,
  getUnsafeEvalMode,
  setUnsafeEval,
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
