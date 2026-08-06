/**
 * The mutation-probe corpus, kept honest.
 *
 * Separate from `test-policy.test.ts` for one reason, and it is a load-bearing
 * one: these checks read PRODUCTION source, and a probe run mutates production
 * source. Left in the main suite, "every probe still applies" fails for every
 * probe by construction — the probe edits the line the check is anchored on —
 * and every mutant scores as CAUGHT whether or not any real test noticed. The
 * first run of this lane's own measurement reported 93/93 for exactly that
 * reason, and it was wrong.
 *
 * `scripts/run-probes.mjs` therefore excludes this file, and only this file,
 * while it runs. Nothing else in the suite may be anchored on the text of a
 * production file the way these are.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();

describe('test policy: the mutation-probe corpus stays honest', () => {
  const corpus = JSON.parse(readFileSync(resolve(ROOT, 'probes/corpus.json'), 'utf8')) as Array<{
    id: string; file: string; find: string; replace: string; note: string; tags?: string[];
    all?: boolean; equivalent?: string;
  }>;

  it('every probe still applies to the file it names', () => {
    // A probe whose anchor has rotted silently stops being a mutant, and the
    // detection rate quietly climbs while the coverage it measured disappears.
    const broken: string[] = [];
    for (const p of corpus) {
      let source: string;
      try {
        source = readFileSync(resolve(ROOT, p.file), 'utf8').replace(/\r\n/g, '\n');
      } catch {
        broken.push(`${p.id} → ${p.file} does not exist`);
        continue;
      }
      const hits = source.split(p.find.replace(/\r\n/g, '\n')).length - 1;
      if (hits === 0) broken.push(`${p.id} → anchor not found in ${p.file}`);
      else if (hits > 1 && !p.all) broken.push(`${p.id} → anchor matches ${hits}× in ${p.file}`);
    }
    expect(broken, 'run `node scripts/run-probes.mjs --check` and re-anchor these').toEqual([]);
  });

  it('no probe is a no-op', () => {
    // Five entries in the corpus this file inherited had `find === replace`.
    // They can never be caught, so they were permanent, invisible drag on the
    // measured rate.
    const noops = corpus.filter((p) => p.find === p.replace).map((p) => p.id);
    expect(noops).toEqual([]);
  });

  it('every probe id is unique and every probe explains itself', () => {
    expect(new Set(corpus.map((p) => p.id)).size).toBe(corpus.length);
    expect(corpus.filter((p) => !p.note || p.note.length < 10).map((p) => p.id)).toEqual([]);
  });

  it('every equivalent-mutant exemption carries its proof', () => {
    // An `equivalent` marking removes a probe from the detection rate, so it is
    // the one field in this file that can flatter the number. It may only be
    // set with an argument written out in full, in the corpus, next to the
    // probe it excuses — never in a commit message or a report.
    for (const p of corpus.filter((x) => x.equivalent !== undefined)) {
      expect(typeof p.equivalent, p.id).toBe('string');
      expect(p.equivalent!.length, `${p.id}: state WHY it cannot change behaviour`).toBeGreaterThan(80);
    }
    // And the exemption stays rare. If this ever needs raising, the honest move
    // is almost always to write the test instead.
    expect(corpus.filter((x) => x.equivalent !== undefined).length).toBeLessThanOrEqual(5);
  });

  it('the security subset is large enough to be a rate', () => {
    const security = corpus.filter((p) => (p.tags ?? []).includes('security'));
    expect(security.length).toBeGreaterThanOrEqual(30);
  });
});
