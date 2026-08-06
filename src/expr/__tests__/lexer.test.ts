/**
 * The lexer is the first allowlist gate (G1). If a byte does not lex, no later
 * stage has to have an opinion about it — which is why the escape policy lives
 * here rather than in a semantic check that a clever spelling could route
 * around.
 */
import { describe, expect, it } from 'vitest';
import { lex } from '../lexer';
import { isExprError } from '../errors';

/** Lex and return the token list without the trailing EOF. */
function toks(src: string) {
  return lex(src).slice(0, -1);
}

function lexError(src: string) {
  try {
    lex(src);
  } catch (err) {
    if (isExprError(err)) return err;
    throw err;
  }
  throw new Error(`expected ${src} to be rejected`);
}

describe('lexer', () => {
  it('every punctuator in the grammar round-trips', () => {
    const punctuators = [
      '===', '!==', '?.', '??', '=>', '&&', '||', '++', '--', '+=', '-=', '*=', '/=',
      '==', '!=', '<=', '>=', '(', ')', '[', ']', '{', '}', ',', '.', ';', ':', '?',
      '+', '-', '*', '/', '%', '!', '<', '>', '=',
    ];
    for (const p of punctuators) {
      const [tok, ...rest] = toks(p);
      expect(rest, p).toEqual([]);
      expect(tok, p).toMatchObject({ t: 'punc', v: p });
    }
  });

  it('prefers the longest punctuator', () => {
    expect(toks('a===b').map((t) => t.v)).toEqual(['a', '===', 'b']);
    expect(toks('a==b').map((t) => t.v)).toEqual(['a', '==', 'b']);
    expect(toks('a?.b').map((t) => t.v)).toEqual(['a', '?.', 'b']);
    expect(toks('a??b').map((t) => t.v)).toEqual(['a', '??', 'b']);
  });

  it('rejects an operator the grammar does not have', () => {
    // Bitwise operators, exponentiation and the comma-less oddities are not
    // "unsupported at the semantic layer" — they have no token.
    for (const src of ['a & b', 'a | b', 'a ^ b', '~a', 'a @ b', 'a # b']) {
      expect(lexError(src).code, src).toBe('FORMA_E_SYNTAX');
    }
    // `**` and `>>` lex as two single-character punctuators and die in the
    // parser instead; either way they are never evaluated.
    expect(toks('a ** b').map((t) => t.v)).toEqual(['a', '*', '*', 'b']);
    expect(toks('a >> b').map((t) => t.v)).toEqual(['a', '>', '>', 'b']);
  });

  it('decodes only the eight permitted escapes', () => {
    expect(toks("'a\\nb'")[0]).toMatchObject({ t: 'str', v: 'a\nb' });
    expect(toks("'a\\tb'")[0]).toMatchObject({ t: 'str', v: 'a\tb' });
    expect(toks("'it\\'s'")[0]).toMatchObject({ t: 'str', v: "it's" });
    expect(toks('"a\\\\b"')[0]).toMatchObject({ t: 'str', v: 'a\\b' });
  });

  it('rejects \\u, \\x and octal escapes', () => {
    // This is what kills the unicode-escaped-key bypass at the lexer:
    // `obj['constructor']` cannot even be spelled.
    for (const src of ["'\\u0063'", "'\\x63'", "'\\101'", "`\\u0063`"]) {
      const err = lexError(src);
      expect(err.code, src).toBe('FORMA_E_SYNTAX');
      expect(err.message, src).toMatch(/escape sequence/);
    }
  });

  it('reports a column for an unterminated string or template', () => {
    expect(lexError("a + 'oops").column).toBe(4);
    expect(lexError('a + `oops').column).toBe(4);
    expect(lexError('a + `${b`').message).toMatch(/unterminated/);
  });

  it('captures template interpolations as raw source, with offsets', () => {
    const [tok] = toks('`a${x + 1}b${y}`');
    expect(tok).toMatchObject({ t: 'tmpl', quasis: ['a', 'b', ''], exprs: ['x + 1', 'y'] });
    // The offset is what makes a column inside `${…}` point at the real source.
    expect(tok!.exprAt).toEqual([4, 13]);
  });

  it('handles braces, quotes and nested templates inside an interpolation', () => {
    const [tok] = toks('`${ obj["}"] }${ `in${ner}` }`');
    expect(tok!.exprs).toEqual([' obj["}"] ', ' `in${ner}` ']);
  });

  it('lexes decimals but refuses malformed numbers', () => {
    expect(toks('1.5')[0]).toMatchObject({ t: 'num', n: 1.5 });
    expect(toks('12')[0]).toMatchObject({ t: 'num', n: 12 });
    // `1.2.3`, `0x10` and `1e5` are all rejected rather than silently coerced.
    for (const src of ['1.2.3', '0x10', '1e5']) {
      expect(lexError(src).code, src).toBe('FORMA_E_SYNTAX');
    }
  });

  it('does not treat a number followed by a dot as member access', () => {
    // `1.toFixed(2)` is a JavaScript SyntaxError; it is one here too, rather
    // than lexing as `1` `.` `toFixed`.
    expect(lexError('1.toFixed(2)').code).toBe('FORMA_E_SYNTAX');
  });
});
