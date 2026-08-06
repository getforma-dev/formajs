/**
 * Closed-token-set lexer (guarantee G1).
 *
 * The lexer never hands source text to JavaScript. It recognises identifiers,
 * decimal numbers, single/double-quoted strings, template literals and a FIXED
 * punctuator list; every other byte is a syntax error with a column. That is
 * what makes the grammar an allowlist at the very first stage: an operator we
 * do not implement (`&`, `|`, `~`, `**`, `=>>`) is not "unsupported later", it
 * does not lex.
 *
 * Escape policy: only `\n \t \r \\ \' \" \` \0` are decoded. `\u`, `\x` and
 * octal escapes are REJECTED, which kills the unicode-escaped-key bypass
 * (`obj['constructor']`) before any semantics exist to bypass.
 * Verified by: src/expr/__tests__/lexer.test.ts > "rejects \\u, \\x and octal escapes"
 */
import { exprError } from './errors';

export type TokenType = 'num' | 'str' | 'tmpl' | 'name' | 'punc' | 'eof';

export interface Token {
  t: TokenType;
  /** Punctuator text, identifier name, decoded string value, or ''. */
  v: string;
  /** Numeric value for `num` tokens. */
  n?: number;
  /** Static chunks of a template literal (always exprs.length + 1 entries). */
  quasis?: string[];
  /** Raw `${…}` sources of a template literal, in order. */
  exprs?: string[];
  /** Source offsets of each `${…}` source, for column-accurate sub-errors. */
  exprAt?: number[];
  /** 0-based column of the token's first character. */
  i: number;
}

/**
 * Every punctuator the grammar has, longest first so `===` wins over `==` and
 * `?.` / `??` win over `?`. Adding a row here is adding a language feature and
 * is gated by the allowlist snapshot test.
 */
const PUNCTUATORS: readonly string[] = [
  '===', '!==',
  '?.', '??', '=>', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '==', '!=', '<=', '>=',
  '(', ')', '[', ']', '{', '}', ',', '.', ';', ':', '?', '+', '-', '*', '/', '%', '!', '<', '>', '=',
];

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  n: '\n',
  t: '\t',
  r: '\r',
  '\\': '\\',
  '\'': '\'',
  '"': '"',
  '`': '`',
  '0': '\0',
});

const SQ = String.fromCharCode(39);
const DQ = String.fromCharCode(34);
const BT = String.fromCharCode(96);
const BS = String.fromCharCode(92);

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isIdentStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$';
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch);
}

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

/** Decode one escape sequence. Throws for every escape outside the policy. */
function readEscape(src: string, i: number, base: number): { text: string; next: number } {
  const ch = src[i + 1];
  if (ch === undefined) {
    throw exprError('FORMA_E_SYNTAX', 'unterminated escape sequence', base + i);
  }
  const decoded = Object.hasOwn(SIMPLE_ESCAPES, ch) ? SIMPLE_ESCAPES[ch] : undefined;
  if (decoded === undefined) {
    throw exprError(
      'FORMA_E_SYNTAX',
      `escape sequence "\\${ch}" is not allowed (only \\n \\t \\r \\\\ \\' \\" \\\` \\0)`,
      base + i,
    );
  }
  return { text: decoded, next: i + 2 };
}

/**
 * Read a template literal starting at the opening backtick. Interpolations are
 * captured as RAW SOURCE and parsed recursively by the parser, so nested
 * templates, strings and braces inside `${…}` all behave.
 */
function readTemplate(src: string, start: number, base: number): { tok: Token; next: number } {
  const quasis: string[] = [];
  const exprs: string[] = [];
  const exprAt: number[] = [];
  let chunk = '';
  let i = start + 1;

  while (i < src.length) {
    const ch = src[i]!;
    if (ch === BT) {
      quasis.push(chunk);
      return {
        tok: { t: 'tmpl', v: '', quasis, exprs, exprAt, i: base + start },
        next: i + 1,
      };
    }
    if (ch === BS) {
      const esc = readEscape(src, i, base);
      chunk += esc.text;
      i = esc.next;
      continue;
    }
    if (ch === '$' && src[i + 1] === '{') {
      quasis.push(chunk);
      chunk = '';
      const inner = readInterpolation(src, i + 2, base);
      exprs.push(inner.text);
      exprAt.push(base + i + 2);
      i = inner.next;
      continue;
    }
    chunk += ch;
    i++;
  }
  throw exprError('FORMA_E_SYNTAX', 'unterminated template literal', base + start);
}

/** Scan to the `}` that closes a `${`, honouring nested braces and literals. */
function readInterpolation(src: string, start: number, base: number): { text: string; next: number } {
  let depth = 0;
  let i = start;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === SQ || ch === DQ) {
      i = skipQuoted(src, i, ch, base);
      continue;
    }
    if (ch === BT) {
      i = readTemplate(src, i, base).next;
      continue;
    }
    if (ch === '{') { depth++; i++; continue; }
    if (ch === '}') {
      if (depth === 0) return { text: src.slice(start, i), next: i + 1 };
      depth--;
      i++;
      continue;
    }
    i++;
  }
  throw exprError('FORMA_E_SYNTAX', 'unterminated ${…} interpolation', base + start);
}

/** Skip a quoted string starting at `i` (which holds the quote). */
function skipQuoted(src: string, i: number, quote: string, base: number): number {
  let j = i + 1;
  while (j < src.length) {
    const ch = src[j]!;
    if (ch === BS) { j = readEscape(src, j, base).next; continue; }
    if (ch === quote) return j + 1;
    j++;
  }
  throw exprError('FORMA_E_SYNTAX', 'unterminated string literal', base + i);
}

/**
 * Tokenise `src`. `base` offsets reported columns so a template's `${…}` source
 * reports positions relative to the original expression.
 * Verified by: src/expr/__tests__/lexer.test.ts > "every punctuator in the grammar round-trips"
 */
export function lex(src: string, base = 0): Token[] {
  const out: Token[] = [];
  let i = 0;

  while (i < src.length) {
    const ch = src[i]!;

    if (isSpace(ch)) { i++; continue; }

    if (isDigit(ch)) {
      let j = i + 1;
      while (j < src.length && isDigit(src[j]!)) j++;
      if (src[j] === '.' && isDigit(src[j + 1] ?? '')) {
        j += 2;
        while (j < src.length && isDigit(src[j]!)) j++;
      }
      const text = src.slice(i, j);
      if (isIdentStart(src[j] ?? '') || src[j] === '.') {
        throw exprError('FORMA_E_SYNTAX', `malformed number "${text}${src[j]}"`, base + i);
      }
      out.push({ t: 'num', v: text, n: Number(text), i: base + i });
      i = j;
      continue;
    }

    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < src.length && isIdentPart(src[j]!)) j++;
      out.push({ t: 'name', v: src.slice(i, j), i: base + i });
      i = j;
      continue;
    }

    if (ch === SQ || ch === DQ) {
      let value = '';
      let j = i + 1;
      let closed = false;
      while (j < src.length) {
        const c = src[j]!;
        if (c === BS) { const esc = readEscape(src, j, base); value += esc.text; j = esc.next; continue; }
        if (c === ch) { closed = true; j++; break; }
        value += c;
        j++;
      }
      if (!closed) throw exprError('FORMA_E_SYNTAX', 'unterminated string literal', base + i);
      out.push({ t: 'str', v: value, i: base + i });
      i = j;
      continue;
    }

    if (ch === BT) {
      const { tok, next } = readTemplate(src, i, base);
      out.push(tok);
      i = next;
      continue;
    }

    let matched = '';
    for (const p of PUNCTUATORS) {
      if (src.startsWith(p, i)) { matched = p; break; }
    }
    if (!matched) {
      throw exprError('FORMA_E_SYNTAX', `unexpected character "${ch}"`, base + i);
    }
    out.push({ t: 'punc', v: matched, i: base + i });
    i += matched.length;
  }

  out.push({ t: 'eof', v: '', i: base + src.length });
  return out;
}
