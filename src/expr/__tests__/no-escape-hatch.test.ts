/**
 * The structural gate on src/expr/.
 *
 * allowlist-snapshot.test.ts pins WHAT the language may reach. This file pins
 * that nothing reaches anything ANOTHER way: no dynamic code, no global, no
 * timer, and — the rule that carries the security model — no property read off
 * a value with a computed key outside the two audited helpers.
 *
 * It reads the source text rather than the behaviour on purpose. A behavioural
 * test proves the attacks we thought of are dead; this proves the SHAPE that
 * made them possible is absent, which is the part that survives the attacks we
 * did not think of.
 *
 * Comments are stripped before every check, so the security notes in these
 * files may quote the attacks they describe.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = resolve(process.cwd(), 'src/expr');

/** Every non-test module under src/expr/. */
function modules(): string[] {
  return readdirSync(DIR).filter((n) => n.endsWith('.ts')).sort();
}

/** Source with block and line comments removed, so prose cannot trip a rule. */
function code(file: string): string {
  return readFileSync(resolve(DIR, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('src/expr has no escape hatch', () => {
  it('the gate is looking at the modules it thinks it is', () => {
    // A gate that silently stops finding files passes forever.
    expect(modules()).toEqual([
      'allowlist.ts', 'ast.ts', 'errors.ts', 'host.ts', 'index.ts',
      'interp.ts', 'lexer.ts', 'parser.ts', 'validate.ts',
    ]);
  });

  it('src/expr contains no path to the Function constructor or a global', () => {
    const forbidden: Array<[label: string, pattern: RegExp]> = [
      ['new Function', /\bnew\s+Function\b/],
      ['Function(', /\bFunction\s*\(/],
      ['eval(', /\beval\s*\(/],
      ['import(', /\bimport\s*\(/],
      ['globalThis', /\bglobalThis\b/],
      ['window', /\bwindow\b/],
      ['document', /\bdocument\b/],
      ['setTimeout', /\bsetTimeout\b/],
      ['setInterval', /\bsetInterval\b/],
      ['queueMicrotask', /\bqueueMicrotask\b/],
      ['fetch', /\bfetch\s*\(/],
      ['localStorage', /\blocalStorage\b/],
      ['process', /\bprocess\b/],
      ['require', /\brequire\s*\(/],
    ];
    for (const file of modules()) {
      const src = code(file);
      for (const [label, pattern] of forbidden) {
        expect(pattern.test(src), `${file} mentions ${label}`).toBe(false);
      }
    }
  });

  it('the word "constructor" appears only as a denied key, never as an access', () => {
    // errors.ts deliberately builds branded plain Errors instead of an Error
    // subclass: a `class` body would put the identifier `constructor` into this
    // directory, and this gate would then have to distinguish a harmless one
    // from `x.constructor` — which is exactly the "blocklist with exceptions"
    // shape the whole design rejects.
    for (const file of modules()) {
      const src = code(file);
      expect(/\.\s*constructor\b/.test(src), `${file} reads .constructor`).toBe(false);
      expect(/\bclass\s+\w/.test(src), `${file} declares a class`).toBe(false);
      if (file === 'allowlist.ts') continue;
      expect(/\bconstructor\b/.test(src), `${file} names constructor`).toBe(false);
    }
    // In allowlist.ts it may appear only inside DENY_KEYS.
    const allow = code('allowlist.ts');
    const denyBlock = allow.slice(allow.indexOf('DENY_KEYS'), allow.indexOf('MAX_KEY_LENGTH'));
    expect((allow.match(/\bconstructor\b/g) ?? []).length).toBe(1);
    expect(denyBlock).toContain("'constructor'");
  });

  /**
   * Base expressions that may be indexed with a computed key. Every one is a
   * table this module owns — a frozen allowlist, an arrow-frame array, an AST
   * child list, the scope's own getter/setter records, or a result object being
   * built. None is a value that arrived from state, JSON, an attribute or the
   * DOM.
   *
   * This is a closed list on purpose, and it holds no name the source does not
   * currently use: an allowlist carrying entries "in case someone needs them"
   * is the same mistake as widening dispatch, one file further out.
   */
  const OWNED_TABLES = new Set([
    'ELEMENT_HOST_PROPS', 'ELEMENT_METHOD_RESULT', 'HOF_CALLBACK_PARAMS', 'SAFE_GLOBALS',
    'tbl', 'members', 'ctx.scope.getters', 'ctx.scope.setters',
    'f.values', 'node.exprs', 'node.quasis', 'node.values',
    'plain', 'list', 'out',
  ]);

  it('the owned-table list has no name the source does not use', () => {
    // Keeps the list above honest in the other direction: an entry that stops
    // being used is an entry that could quietly re-authorise a `recv[key]`
    // whose base happens to share its name.
    const seen = new Set<string>();
    for (const file of ['interp.ts', 'host.ts']) {
      for (const m of code(file).matchAll(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\[\s*([^\]\n]+)\]/g)) {
        const key = m[2]!;
        if (/^\s*$/.test(key) || /^\d+$/.test(key) || /^(HOST|Symbol\.\w+)$/.test(key.trim())) continue;
        seen.add(m[1]!);
      }
    }
    expect([...OWNED_TABLES].sort()).toEqual([...seen].sort());
  });

  it('no property is read off a value with a computed key outside safeRead', () => {
    // THE rule. `recv[key]` is the shape that made every constructor bypass
    // work in the engine this replaces, so it does not appear at all: host
    // members go through Reflect.get on a wrapped DOM target, and plain data
    // goes through Object.getOwnPropertyDescriptor inside ownDataValue.
    for (const file of ['interp.ts', 'host.ts']) {
      const src = code(file);
      for (const m of src.matchAll(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\[\s*([^\]\n]+)\]/g)) {
        const [, base, key] = m;
        // `Foo[]` in a type position, and literal indices, are not lookups.
        if (/^\s*$/.test(key!) || /^\d+$/.test(key!)) continue;
        if (/^(HOST|Symbol\.\w+)$/.test(key!.trim())) continue;
        expect(OWNED_TABLES.has(base!), `${file}: ${base}[${key}] is not an interpreter-owned table`)
          .toBe(true);
      }
    }
  });

  it('the only member reads on a wrapped target are Reflect.get / Reflect.set', () => {
    // Host receivers ($el, $event, classList, style, dataset) are DOM objects
    // the RUNTIME created, so their methods are read off the target — but only
    // after the name has been checked against the fixed per-kind table, and
    // only through Reflect, never through a dynamic index.
    const interp = code('interp.ts');
    const reads = [...interp.matchAll(/Reflect\.(get|set|apply)\(/g)].map((m) => m[1]);
    expect(reads).toContain('get');
    expect(reads).toContain('apply');
    // Nothing else in the directory touches a target at all.
    for (const file of modules()) {
      if (file === 'interp.ts') continue;
      expect(/\bReflect\.(get|set)\b/.test(code(file)), `${file} reads a target`).toBe(false);
    }
  });

  it('the interpreter never answers a denial with undefined', () => {
    // R1: `{ok:true, value:undefined}` is a legitimate result, so `undefined`
    // can never double as an error signal. A swallowing catch is how that rule
    // gets broken, so the shape is banned outright.
    for (const file of modules()) {
      const src = code(file);
      expect(/catch\s*(?:\([^)]*\))?\s*\{\s*return\s+undefined/.test(src), file).toBe(false);
      expect(/catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(src), `${file} swallows an error`).toBe(false);
    }
  });
});
