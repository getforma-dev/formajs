/**
 * The ordinary-search corpus (FORMA-028, carried from FORMA-137).
 *
 * A client-side search, `rows.filter(r => (r.title + ' ' + r.body)
 * .toLowerCase().includes(q))`, over records of 260 characters, is ordinary
 * widget code. Core 2.0.1 answers it until the step budget stops it, at about
 * 9,090 records. Core 2.0.3 priced lowercasing any text with a character
 * above Latin-1 at half a unit a character, so it refused the search past about
 * 1,716 records of Greek, Cyrillic, CJK or Latin Extended text. Core 2.1.0
 * prices those scripts by what lowercasing them measured (FORMA-028), so the
 * search answers as 2.0.1 does, at 900 and at 9,000 records, in every script
 * here; Latin-1 answers as it did in 2.0.3.
 *
 * "As 2.0.1 does" is checked against the same filter run as plain JavaScript:
 * 2.0.1 had no allocation budget, so below the step budget its answer is the
 * filter's answer.
 */
import { describe, expect, it } from 'vitest';
import { compileExpression, evaluateExpression, isExprError } from '../index';
import { scopeOf } from './helpers';

const SEARCH = "rows.filter(r => (r.title + ' ' + r.body).toLowerCase().includes(q)).length";

/** Words in each script, and a needle in that script. */
const SCRIPTS: Record<string, [words: string, needle: string]> = {
  ascii: ['alpha beta gamma delta epsilon zeta theta iota kappa lambda mu nu xi omicron pi rho ', 'needle'],
  'latin-1': ['café crème brûlée straße àéîõü déjà vu naïve façade jalapeño señor ', 'aiguillé'],
  punctuation: ['the fox’s jump — over the dog… €12 ™ said “quote” and ‘single’ ', 'needle'],
  greek: ['Η γρήγορη καφέ αλεπού πηδά πάνω από τον τεμπέλη σκύλο Σοφία Αθήνα ', 'βελόνα'],
  cyrillic: ['Съешь же ещё этих мягких французских булок да выпей чаю Москва ', 'иголка'],
  cjk: ['敏捷的棕色狐狸跳过了懒狗東京都の天気は晴れです今日は良い天気ですね', '针头'],
  'latin extended': ['Příliš žluťoučký kůň úpěl ďábelské ódy Zażółć gęślą jaźń Őrült ő İzmir ', 'jehła'],
};

/** `n` records of a 60-character title and a 200-character body; every tenth holds the needle. */
function records(words: string, needle: string, n: number): Array<{ title: string; body: string }> {
  return Array.from({ length: n }, (_, i) => ({
    title: `${i} ${words}`.repeat(2).slice(0, 60),
    body: `${i % 10 === 0 ? `${needle} ` : ''}${words}`.repeat(4).slice(0, 200),
  }));
}

function search(rows: unknown[], q: string): unknown {
  try {
    return evaluateExpression(compileExpression(SEARCH), scopeOf({ rows, q }));
  } catch (e) {
    if (!isExprError(e)) throw e;
    return e.code;
  }
}

describe('the ordinary-search corpus answers as core 2.0.1 does (FORMA-028)', () => {
  it.each(Object.keys(SCRIPTS))('a search over 900 and 9,000 records of %s text is answered', (script) => {
    const [words, needle] = SCRIPTS[script]!;
    for (const n of [900, 9000]) {
      const rows = records(words, needle, n);
      const expected = rows.filter((r) => (r.title + ' ' + r.body).toLowerCase().includes(needle)).length;
      expect(expected, `${script} ${n}: the corpus holds the needle`).toBe(n / 10);
      expect(search(rows, needle), `${script}, ${n} records`).toBe(expected);
    }
  });

  it('the step budget still stops the search where it stopped 2.0.1', () => {
    // About eleven steps a record: 9,090 records are answered, 9,200 are not,
    // in ASCII and in Greek alike, so the budget that limits the search is
    // the one that limited it before the cost preflight.
    for (const script of ['ascii', 'greek']) {
      const [words, needle] = SCRIPTS[script]!;
      expect(search(records(words, needle, 9090), needle), script).toBe(909);
      expect(search(records(words, needle, 9200), needle), script).toBe('FORMA_E_BUDGET');
    }
  });

  it('text whose case mapping measured costlier is still charged at the higher rate', () => {
    // Georgian and Cherokee lowercase at 22 to 39 ns a character, twice the
    // costliest script above, so their first character keeps them at half a
    // unit a character: the 9,000-record search is refused, 900 answered.
    const georgian = 'Ⴀ ქართული ენა მშვენიერია და ძველია ';
    const cherokee = 'Ꭰ ᏣᎳᎩ ᎦᏬᏂᎯᏍᏗ ᎠᏂᏴᏫ ';
    for (const words of [georgian, cherokee]) {
      expect(search(records(words, 'needle', 900), 'needle')).toBe(90);
      expect(search(records(words, 'needle', 9000), 'needle')).toBe('FORMA_E_BUDGET');
    }
  });
});
