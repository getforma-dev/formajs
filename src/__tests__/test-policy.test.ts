/**
 * The test suite, tested.
 *
 * Every rule here is derived from a test this repo actually shipped that could
 * not fail. They are lint-grade — the whole file runs in well under a second —
 * and they run inside `npm test`, so CI enforces them on every PR with no extra
 * job and no extra tooling. The prose version, with the reasoning, is in
 * CONTRIBUTING.md § "Writing a test that can fail".
 *
 * What this cannot check is whether a test that CAN fail actually WOULD fail
 * for the right reason. That is what the committed mutation-probe corpus is
 * for: `probes/corpus.json` + `node scripts/run-probes.mjs`.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = process.cwd();

function testFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.test\.tsx?$/.test(name)) found.push(p);
    }
  };
  walk(resolve(ROOT, 'src'));
  return found.sort();
}

const FILES = testFiles();
const rel = (p: string): string => relative(ROOT, p).replace(/\\/g, '/');

/**
 * Split a file into one chunk per `it(` / `test(` declaration, each running to
 * the start of the next declaration. Line-oriented on purpose: a real parser
 * would be more precise and would also be a dependency and a maintenance
 * surface, and every rule below only needs "what text belongs to this test".
 */
function testChunks(source: string): Array<{ name: string; body: string; line: number }> {
  const lines = source.split('\n');
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(?:it|test)\s*[(.]/.test(lines[i]!)) starts.push(i);
  }
  return starts.map((start, idx) => {
    const end = idx + 1 < starts.length ? starts[idx + 1]! : lines.length;
    const body = lines.slice(start, end).join('\n');
    const named = /^\s*(?:it|test)(?:\.\w+)?\s*(?:\([^]*?)?['"`](.+?)['"`]\s*,/.exec(body);
    return { name: named?.[1] ?? '(unnamed)', body, line: start + 1 };
  });
}

describe('test policy: a test must be able to fail', () => {
  it('every test declaration contains at least one expect()', () => {
    // Three tests in hydrate.test.ts called adoptNode() under a comment reading
    // "// Should not throw" and asserted nothing at all. One of them stated its
    // expected outcome in a trailing comment and did not assert it.
    const offenders: string[] = [];
    for (const file of FILES) {
      for (const chunk of testChunks(readFileSync(file, 'utf8'))) {
        if (!chunk.body.includes('expect(')) {
          offenders.push(`${rel(file)}:${chunk.line} → "${chunk.name}" has no expect()`);
        }
      }
    }
    expect(offenders, 'a test with no assertion is documentation with a green tick').toEqual([]);
  });

  it('every test file reaches production code, statically or dynamically', () => {
    // `runtime-blocklist.test.ts` re-implemented a private security function
    // inside the test body and asserted against the re-implementation. Deleting
    // the real blocklist left 10/10 passing. Touching no production code is the
    // mechanical tell. A file that reads repo SOURCE (the packaging surface,
    // the docs-truth checks, this file) is testing the repo itself and counts.
    const offenders: string[] = [];
    for (const file of FILES) {
      const source = readFileSync(file, 'utf8');
      const statics = [...source.matchAll(/^\s*import\s[^]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]!);
      const dynamics = [...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);
      const reachesCode = [...statics, ...dynamics].some(
        (s) => !s.startsWith('node:') && s !== 'vitest',
      );
      const readsRepo = /readFileSync|readdirSync/.test(source);
      if (!reachesCode && !readsRepo) {
        offenders.push(`${rel(file)} touches no production code — it tests nothing`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no test skips itself', () => {
    // `ir-roundtrip.test.ts` in the sibling compiler repo resolved a fixture to
    // a path outside the repo, warned, and returned — reporting PASSED. 28
    // assertions had never executed and CI was green the whole time.
    const offenders: string[] = [];
    for (const file of FILES) {
      const source = readFileSync(file, 'utf8');
      for (const m of source.matchAll(/\b(?:it|test|describe)\.(?:skip|todo)\b/g)) {
        offenders.push(`${rel(file)} → ${m[0]}`);
      }
      for (const chunk of testChunks(source)) {
        if (/if\s*\(!\s*(?:fs\.)?existsSync\([^]*?\)\s*\)\s*\{[^}]*\breturn\b/.test(chunk.body)) {
          offenders.push(`${rel(file)}:${chunk.line} → "${chunk.name}" skips on a missing fixture`);
        }
      }
    }
    expect(offenders, 'fixtures live in the repo; a missing one is a hard failure').toEqual([]);
  });

  it('no test asserts only that something EXISTS', () => {
    // All eight tests in `runtime-parsestate.test.ts` were
    // `expect(el).toBeTruthy()` on markup the helper had just written. The
    // function they were named for was never called; making `parseState` throw
    // unconditionally left 8/8 passing.
    //
    // A presence check observes that a value exists, never what it is, so a
    // test whose ONLY assertions are presence checks has pinned nothing about
    // behaviour. (Precise by design: a spy count is a weak assertion but it is
    // not this one, and flagging it here would drown the signal.)
    // `toBeInstanceOf` / `toBeTypeOf` are NOT in this set: they say what the
    // value is, which is the thing a presence check fails to say.
    const PRESENCE_ONLY = /\.(toBeTruthy|toBeDefined)\(/;
    const NEGATIVE_PRESENCE = /\.not\.(toBeNull|toBeUndefined)\(/;
    const offenders: string[] = [];
    for (const file of FILES) {
      for (const chunk of testChunks(readFileSync(file, 'utf8'))) {
        const assertions = [...chunk.body.matchAll(/expect\([^]*?\)\s*(\.[^\n;]*)/g)].map((m) => m[1]!);
        if (assertions.length === 0) continue;
        const allPresence = assertions.every(
          (a) => PRESENCE_ONLY.test(a) || NEGATIVE_PRESENCE.test(a),
        );
        if (allPresence) {
          offenders.push(`${rel(file)}:${chunk.line} → "${chunk.name}" only checks that something exists`);
        }
      }
    }
    expect(offenders, 'assert what the value IS, not that it is there').toEqual([]);
  });

  it('no test file is 90% one identical assertion', () => {
    // The coarse backstop behind the rule above: a whole file that repeats one
    // assertion verbatim is testing one thing many times, whatever that thing
    // is. Deliberately loose — files with a genuinely uniform subject (keyboard
    // combos, hydration triggers) sit in the 70s and are fine, because each of
    // those assertions is paired with an observable outcome.
    const offenders: string[] = [];
    for (const file of FILES) {
      const source = readFileSync(file, 'utf8');
      const assertions = [...source.matchAll(/expect\(([^()]{0,80}?)\)\s*\.\s*(\w+)\(([^()]{0,60}?)\)/g)]
        .map((m) => `${m[1]!.trim()}|${m[2]}|${m[3]!.trim()}`);
      if (assertions.length < 8) continue;
      const counts = new Map<string, number>();
      for (const a of assertions) counts.set(a, (counts.get(a) ?? 0) + 1);
      const [top, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
      const share = n / assertions.length;
      if (share > 0.9) {
        const [subject, matcher, arg] = top.split('|');
        offenders.push(
          `${rel(file)} → ${Math.round(share * 100)}% of assertions are expect(${subject}).${matcher}(${arg})`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no first-party module is replaced by vi.mock', () => {
    // Mocking the thing under test is how `forma-wasm.test.ts` ended up
    // asserting the literal string its own spy was configured to return.
    // Spying on a real implementation (`vi.mock` + `importOriginal`) is fine —
    // that observes the real function, it does not replace it.
    const offenders: string[] = [];
    for (const file of FILES) {
      const source = readFileSync(file, 'utf8');
      for (const m of source.matchAll(/vi\.mock\(\s*['"]([^'"]+)['"]([^]{0,200})/g)) {
        const [, specifier, tail] = m;
        // First-party = a module in THIS repo. A bare specifier that resolves
        // to nothing here (the WASM loader named by `window.__FORMA_WASM__`, a
        // CDN URL at runtime) is an external boundary, which is exactly what a
        // mock is for.
        const firstParty = specifier!.startsWith('.') || specifier! === 'forma' || specifier!.startsWith('forma/');
        if (firstParty && !tail!.includes('importOriginal')) {
          offenders.push(`${rel(file)} → vi.mock('${specifier}') without importOriginal`);
        }
      }
    }
    expect(offenders, 'mock the boundary, never the module under test').toEqual([]);
  });
});
