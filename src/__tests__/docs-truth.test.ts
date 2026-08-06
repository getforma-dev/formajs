/**
 * Checks the factual claims in the markdown against the repo itself.
 *
 * The audit that produced these tests found version pins five minors stale, a
 * CDN artifact that no longer exists, a subpath documented with an API shape it
 * never had, and a coverage figure that was simply wrong. Every one of those is
 * mechanically checkable, so from here on it is checked rather than reviewed.
 *
 * Claims that need behaviour (does the README's markup actually run? is the
 * eval fallback really off?) live in readme-examples.test.ts and
 * runtime-csp-default.test.ts — this file only pins what can be read.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { CDN_URL_ARTIFACTS } from '../../scripts/build-defines.mjs';
import * as rootEntry from '../index.js';
import * as tc39 from '../reactive/tc39-compat.js';

const ROOT = process.cwd();
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8');

const pkg = JSON.parse(read('package.json'));
const README = read('README.md');
const SECURITY = read('SECURITY.md');
const CSP = read('CSP.md');
const CHANGELOG = read('CHANGELOG.md');
const CONTRIBUTING = read('CONTRIBUTING.md');
const LEDGER = read('docs/archive/2026-08-05-hardening-audit.md');
const PERFORMANCE = read('docs/PERFORMANCE.md');

// The 2026-08-06 split moved the narrative out of README.md into these pages.
// They are read here for the same reason the README always was: an unchecked
// claim in docs/ is exactly as expensive as an unchecked claim in the README,
// and there are now six more places for one to hide.
const API_DOC = read('docs/API.md');
const RUNTIME_DOC = read('docs/HTML-RUNTIME.md');
const ISLANDS_DOC = read('docs/ISLANDS.md');
const CDN_DOC = read('docs/CDN-AND-EXPORTS.md');
const STABILITY_DOC = read('docs/STABILITY.md');
const COMPARISONS_DOC = read('docs/COMPARISONS.md');

/** Island/hydration suites the Stability row counts. */
const ISLAND_TEST_FILES = [
  'activate',
  'activate-isolation',
  'activate-reactivate',
  'activate-triggers',
  'activate-visible',
  'activate-visible-leak',
  'deactivate',
  'hydrate',
  'hydrate-cleanup',
  'list-hydration',
  'multi-island-integration',
  'shared-signals-across-islands',
];

describe('version pins', () => {
  it('every documented CDN pin is the current package version', () => {
    // Scanned across the README and both pages that carry CDN snippets, so a
    // version bump cannot leave a stale pin behind in docs/.
    const pinned = [README, RUNTIME_DOC, CDN_DOC].join('\n');
    const pins = [...pinned.matchAll(/@getforma\/core@([\d.]+)/g)].map((m) => m[1]);
    expect(pins.length, 'the docs should still contain concrete pins').toBeGreaterThan(0);
    for (const pin of pins) expect(pin).toBe(pkg.version);
  });

  it("the runtime header's CDN pin is the current package version", () => {
    // src/runtime.ts opens with a copy-pasteable CDN snippet. It sat on 1.0.1
    // through five minor releases, so anyone following the file's own usage
    // example pinned a runtime that predated the CSP-safe default.
    const runtime = read('src/runtime.ts');
    const pins = [...runtime.matchAll(/@getforma\/core@([\d.]+)/g)].map((m) => m[1]);
    expect(pins.length, 'src/runtime.ts should still carry its CDN usage example').toBe(1);
    expect(pins[0]).toBe(pkg.version);
  });

  it('the changelog has an Unreleased section above the newest release', () => {
    const unreleased = CHANGELOG.indexOf('## [Unreleased]');
    const newest = CHANGELOG.indexOf(`## [${pkg.version}]`);
    expect(unreleased, 'CHANGELOG.md needs an ## [Unreleased] heading').toBeGreaterThan(-1);
    expect(newest).toBeGreaterThan(unreleased);
  });

  it("CSP.md's version history ends at the shipped version, then Unreleased", () => {
    // The last row used to read "> 1.5.0" while package.json said 1.5.0 — a
    // description of a build nobody could install, correct on the day it was
    // written and wrong the moment a release was cut without touching it. The
    // row is now labelled like the CHANGELOG's own heading, and the row above
    // it must end at the version that is actually published, which is what
    // turns "remember to update CSP.md when you release" into a failing test.
    const table = CSP.slice(CSP.indexOf('## Version History'));
    const rows = [...table.matchAll(/^\| ([^|]+?) \|/gm)].map((m) => m[1]!.trim());
    expect(rows[0], 'CSP.md should still have a version-history table').toBe('Version');
    expect(rows.length, 'the table should still have rows').toBeGreaterThan(2);
    expect(rows.at(-1), 'the newest row describes a build nobody can install yet').toBe('Unreleased');
    expect(
      rows.at(-2)!.endsWith(pkg.version),
      `CSP.md's last released row ("${rows.at(-2)}") must end at ${pkg.version}`,
    ).toBe(true);
  });

  it('SECURITY.md supports the version that is actually shipping', () => {
    // The table listed only 1.0.x while 1.5.0 was on npm, so a reporter reading
    // it concluded the current release was out of support.
    const [major, minor] = pkg.version.split('.');
    const table = SECURITY.slice(SECURITY.indexOf('## Supported Versions'));
    expect(table).toContain(`${major}.${minor}.x`);
  });
});

describe('CDN artifacts', () => {
  it('the All builds table lists exactly the CDN artifacts the build emits', () => {
    const open = CDN_DOC.indexOf('## Every CDN artifact');
    const close = CDN_DOC.indexOf('## Subpath exports');
    expect(open, 'docs/CDN-AND-EXPORTS.md needs an "Every CDN artifact" section').toBeGreaterThan(-1);
    expect(close, 'the artifact table must be bounded by "## Subpath exports"').toBeGreaterThan(open);
    const section = CDN_DOC.slice(open, close);
    const listed = [...section.matchAll(/\| `([\w.-]+\.js)` \|/g)].map((m) => `dist/${m[1]}`);
    expect(new Set(listed)).toEqual(new Set(CDN_URL_ARTIFACTS));
  });

  it('does not point the browser ESM recipe at the code-split npm entry', () => {
    // dist/index.js imports the bare specifier "alien-signals" and its own
    // chunks; a browser can resolve neither, so the old snippet never ran.
    for (const doc of [README, CDN_DOC]) expect(doc).not.toMatch(/@getforma\/core@[\d.]+\/dist\/index\.js/);
    expect(CDN_DOC).toContain('/dist/forma.esm.js');
  });

  it('mentions no artifact the build no longer produces', () => {
    // dist/formajs.global.js was a 461 KB orphan with no exports subpath and no
    // documented row; it is gone, and nothing may reintroduce a reference to it.
    for (const doc of [README, SECURITY, CSP, CDN_DOC, RUNTIME_DOC]) {
      expect(doc).not.toContain('formajs.global.js');
    }
  });
});

describe('API shapes the docs assert', () => {
  it('the tc39 subpath exports State and Computed, not a Signal namespace', () => {
    expect(Object.keys(tc39).sort()).toEqual(['Computed', 'State']);
    expect((tc39 as Record<string, unknown>).Signal).toBeUndefined();
    // The docs must not imply the namespace shape that does not exist.
    expect(README).not.toMatch(/Signal\.State/);
    expect(README).not.toMatch(/Signal\.Computed/);
  });

  it('documents every symbol the root entry exports', () => {
    const exported = Object.keys(rootEntry).filter((n) => n !== 'default');
    // The export tables moved to docs/API.md, and the pages either side of it
    // document symbols API.md only lists — so the haystack is the whole set of
    // user-facing pages, not any one of them.
    const haystack = [README, API_DOC, RUNTIME_DOC, ISLANDS_DOC, CDN_DOC].join('\n');
    // `$` and `$$` have no word boundary, so match the backticked form too.
    const undocumented = exported.filter(
      (name) => !haystack.includes(`\`${name}\``) && !new RegExp(`\\b${name}\\b`).test(haystack)
    );
    expect(undocumented, 'add these to the export tables in docs/API.md').toEqual([]);
  });

  it('names the unsanitized HTML sinks reachable from the core entry', () => {
    // CSP.md answers "innerHTML — FormaJS uses it? No" for library-generated
    // markup; that is only honest if the opt-in sinks are LISTED, each with
    // what it does. A bare `toContain` over the whole file was satisfied by the
    // `Verified by` line that happens to quote a test name containing "srcdoc",
    // so deleting the row from the table left this test green — the two
    // haystacks below are the enumerations a reader actually finds the sink in.
    const hatches = API_DOC.slice(API_DOC.indexOf('## Escape hatches'));
    const rows = hatches.split('\n').filter((line) => line.startsWith('| '));
    const bullets = SECURITY.split('\n').filter((line) => line.startsWith('- '));
    expect(rows.length, 'docs/API.md needs the escape-hatch table').toBeGreaterThan(3);

    for (const sink of ['dangerouslySetInnerHTML', 'setHTMLUnsafe', 'srcdoc']) {
      expect(
        rows.some((row) => row.includes(sink)),
        `docs/API.md's escape-hatch table must have a row for ${sink}`,
      ).toBe(true);
      expect(
        bullets.some((bullet) => bullet.includes(sink)),
        `SECURITY.md must list ${sink} among the unsanitized sinks`,
      ).toBe(true);
    }
  });

  it('links alien-signals to the repository of the installed dependency', () => {
    const dep = JSON.parse(read('node_modules/alien-signals/package.json'));
    const url = String(dep.repository?.url ?? '')
      .replace(/^git\+/, '')
      .replace(/\.git$/, '');
    expect(url).toMatch(/^https:\/\/github\.com\//);
    expect(README).toContain(url);
  });
});

describe('"Verified by" citations', () => {
  // The docs carry the same convention as the code comments: a claim about a
  // security or behavioural property names the test that proves it. A citation
  // that does not resolve is worse than none, so all of them are resolved here.
  // Anchored on the `.test.ts` suffix rather than on the backticks: the same
  // citation is written with backticks in prose and without them inside fenced
  // code samples, and both forms have to resolve. Anchoring here also means the
  // convention's own placeholder (`<repo-relative test path>`) is not mistaken
  // for a citation.
  const CITATION = /Verified by:?\s+`?([^`\s]+\.test\.ts)`?\s*>\s*"([^"]+)"/g;

  // Every markdown file that makes a claim and names its proof. The hardening
  // ledger is here for the same reason the others are: an entry marked FIXED
  // that cites a test which does not exist is a worse record than no record.
  const DOCS = {
    'README.md': README,
    'SECURITY.md': SECURITY,
    'CSP.md': CSP,
    'CONTRIBUTING.md': CONTRIBUTING,
    'docs/archive/2026-08-05-hardening-audit.md': LEDGER,
    // The performance doc makes behavioural claims too — every "this guard buys
    // us X" verdict rests on a test, and a verdict resting on a test that does
    // not exist is how a guard gets removed for being slow.
    'docs/PERFORMANCE.md': PERFORMANCE,
    // The six pages the README delegates to. Most of the repo's citations moved
    // here in the 2026-08-06 split; without these entries the split would have
    // silently stopped checking them, which is the exact failure mode the split
    // exists to prevent.
    'docs/API.md': API_DOC,
    'docs/HTML-RUNTIME.md': RUNTIME_DOC,
    'docs/ISLANDS.md': ISLANDS_DOC,
    'docs/CDN-AND-EXPORTS.md': CDN_DOC,
    'docs/STABILITY.md': STABILITY_DOC,
    'docs/COMPARISONS.md': COMPARISONS_DOC,
  };

  it('every citation names a test file that exists and a test that is in it', () => {
    let checked = 0;
    for (const [doc, text] of Object.entries(DOCS)) {
      for (const [, file, name] of text.matchAll(CITATION)) {
        checked += 1;
        let source: string;
        try {
          source = read(file!);
        } catch {
          throw new Error(`${doc}: cited test file does not exist: ${file}`);
        }
        const declared =
          source.includes(`'${name}'`) || source.includes(`"${name}"`) || source.includes(`\`${name}\``);
        expect(declared, `${doc} cites "${name}" in ${file}, which has no such test`).toBe(true);
      }
    }
    expect(checked, 'the docs should still carry citations').toBeGreaterThan(150);
  });

  // Same rule for source comments — see CONTRIBUTING.md, "Comments that assert
  // must cite their proof". The code form drops the backticks:
  //   // Verified by: <repo-relative test path> > "<exact test name>"
  const CODE_CITATION = /Verified by:\s+(\S+\.test\.ts)\s*>\s*"([^"]+)"/g;

  /**
   * Every .ts/.mjs file under src/ and scripts/, the tsup config, and the CI
   * workflows — a citation in a YAML comment is a claim like any other, and the
   * one on the engines floor is load-bearing.
   */
  function sourceFiles(): string[] {
    const found: string[] = [];
    const walk = (dir: string, ext: RegExp): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, ext);
        else if (ext.test(name)) found.push(p);
      }
    };
    walk(resolve(ROOT, 'src'), /\.(ts|mjs)$/);
    walk(resolve(ROOT, 'scripts'), /\.(ts|mjs)$/);
    walk(resolve(ROOT, '.github/workflows'), /\.ya?ml$/);
    found.push(resolve(ROOT, 'tsup.config.ts'));
    return found;
  }

  // A performance claim cites the benchmark that produced it, in the same shape
  // and for the same reason a behavioural claim cites its test:
  //   Benchmarked by: bench/<file>.bench.ts > "<exact bench name>"
  // A benchmark is renamed far more casually than a test — its name carries the
  // repeat count and the fixture size — so an unresolved perf citation is a
  // realistic failure, not a hypothetical one.
  const BENCH_CITATION = /Benchmarked by:?\s+`?(bench\/[\w.-]+\.bench\.ts)`?\s*>\s*"([^"]+)"/g;

  // Benchmark names are assembled from template literals — `(×${NODES})`,
  // `${width} effects on one signal` — so they cannot be grepped out of the
  // source the way a test name can. They are resolved instead against
  // docs/performance-baseline.json, the committed record of what the suite
  // actually ran, which holds every RENDERED name. Renaming a benchmark means
  // re-running `npm run bench:doc`, which rewrites that file, which is what
  // makes a stale citation fail here.
  it('every benchmark citation names a benchmark the suite actually ran', () => {
    const baseline = JSON.parse(read('docs/performance-baseline.json')) as {
      entries: Array<{ file: string; name: string }>;
    };
    const ran = new Set(baseline.entries.map((e) => `${e.file} > ${e.name}`));
    expect(ran.size, 'the committed baseline should list the whole suite').toBeGreaterThan(50);

    // The baseline must describe benchmark files that still exist.
    for (const file of new Set(baseline.entries.map((e) => e.file))) {
      expect(existsSync(resolve(ROOT, file)), `${file} is in the baseline but not on disk`).toBe(true);
    }

    let checked = 0;
    for (const [doc, text] of Object.entries(DOCS)) {
      for (const [, file, name] of text.matchAll(BENCH_CITATION)) {
        checked += 1;
        expect(
          ran.has(`${file} > ${name}`),
          `${doc} cites "${name}" in ${file}; no such benchmark in docs/performance-baseline.json`,
        ).toBe(true);
      }
    }
    expect(checked, 'the docs should carry benchmark citations').toBeGreaterThan(4);
  });

  it('every code comment citation resolves to a test that exists', () => {
    const broken: string[] = [];
    let checked = 0;
    for (const file of sourceFiles()) {
      const rel = relative(ROOT, file).replace(/\\/g, '/');
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(CODE_CITATION)) {
        checked += 1;
        const [, cited, name] = m;
        const line = text.slice(0, m.index).split('\n').length;
        if (!existsSync(resolve(ROOT, cited!))) {
          broken.push(`${rel}:${line} → missing file ${cited}`);
          continue;
        }
        // A test name may be declared with any quote style, so accept all three.
        const source = read(cited!);
        const declared =
          source.includes(`'${name}'`) || source.includes(`"${name}"`) || source.includes(`\`${name}\``);
        if (!declared) {
          broken.push(`${rel}:${line} → no test named "${name}" in ${cited}`);
        }
      }
    }
    expect(broken, 'fix or remove these citations').toEqual([]);
    expect(checked, 'the source should still carry citations').toBeGreaterThan(50);
  });
});

describe('the runtime file map', () => {
  // src/runtime.ts is a deliberate 3.7k-line monolith and navigates by a map in
  // its header. The map used to list line ranges; four of them were stale, and
  // the one naming the security blocklist pointed 150 lines above it. It now
  // names the section MARKERS, which this test keeps honest.
  const RUNTIME = read('src/runtime.ts');
  const header = RUNTIME.slice(RUNTIME.indexOf('── FILE MAP'), RUNTIME.indexOf('── SUPPORTED DIRECTIVES'));

  it('the runtime file map names every section marker, in order', () => {
    const markers = [...RUNTIME.matchAll(/^\/\/ ── (.+?) ──$/gm)].map((m) => m[1]!);
    expect(markers.length, 'runtime.ts should still be sectioned with // ── … ── markers')
      .toBeGreaterThan(20);

    // Each map row starts with the marker name (markers may carry a trailing
    // explanation the row omits, e.g. "Debug logger — enable via …").
    const rows = header
      .split('\n')
      .map((l) => l.replace(/^\s*\*\s?/, '').trimEnd())
      .filter((l) => /^ {2,}\S/.test(l))
      .map((l) => l.trim());

    expect(rows.length, 'the map should list one row per section').toBe(markers.length);
    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i]!;
      const row = rows[i]!;
      expect(
        marker.startsWith(row.split(/ {2,}/)[0]!),
        `map row ${i + 1} ("${row.split(/ {2,}/)[0]}") does not match section marker "${marker}"`,
      ).toBe(true);
    }
  });

  it('no section marker is duplicated', () => {
    const markers = [...RUNTIME.matchAll(/^\/\/ ── (.+?) ──$/gm)].map((m) => m[1]!);
    expect(new Set(markers).size).toBe(markers.length);
  });
});

describe('documented known gaps', () => {
  // A gap stated in prose and nowhere else quietly stops being true (or stays
  // true long after someone believes they fixed it). These pin the two gaps
  // SECURITY.md and CSP.md admit to, so both move together with the code.

  it('the streaming swap scripts really do lack a nonce, as the caveat says', async () => {
    const { getSwapScript, getSwapTag } = await import('../ssr/client-script.js');
    expect(getSwapScript()).toMatch(/^<script>/);
    expect(getSwapScript()).not.toContain('nonce');
    expect(getSwapTag('forma-s:0', '<p>hi</p>')).toMatch(/^<script>/);
    expect(getSwapTag('forma-s:0', '<p>hi</p>')).not.toContain('nonce');
    // Neither function accepts one, which is why this is a gap and not a bug
    // in the caller.
    expect(getSwapScript.length).toBe(0);
    expect(getSwapTag.length).toBe(2);
    for (const doc of [CSP, SECURITY]) expect(doc).toContain('nonce');
  });

  it('a swap payload still cannot close the script block', async () => {
    const { getSwapTag } = await import('../ssr/client-script.js');
    const tag = getSwapTag('forma-s:0', '</script><img src=x onerror=alert(1)>');
    expect(tag).not.toContain('</script><img');
    expect(tag.match(/<\/script>/g)).toHaveLength(1);
  });
});

describe('coverage figures', () => {
  it('the island coverage figure matches the island test files', () => {
    const dir = resolve(ROOT, 'src/dom/__tests__');
    const present = new Set(readdirSync(dir));
    let cases = 0;
    for (const name of ISLAND_TEST_FILES) {
      const file = `${name}.test.ts`;
      expect(present.has(file), `${file} is named in the Stability figure`).toBe(true);
      cases += (read(`src/dom/__tests__/${file}`).match(/^\s*(?:it|test)[(.]/gm) ?? []).length;
    }
    const claimed = /Islands \(`activateIslands`[^|]*\|[^|]*\|\s*(\d+) tests across (\d+)/.exec(STABILITY_DOC);
    expect(claimed, 'the Stability row must state "<n> tests across <m> dedicated files"').not.toBeNull();
    expect(Number(claimed![1])).toBe(cases);
    expect(Number(claimed![2])).toBe(ISLAND_TEST_FILES.length);
  });

  it('the size table quotes the limits the CI gate actually enforces', () => {
    const gate = read('scripts/check-size.mjs');
    const gated = (gate.match(/limit: \d+/g) ?? []).length;
    const limits = [...README.matchAll(/\| ([\d,]{5,}) B \|/g)].map((m) =>
      Number(m[1].replace(/,/g, ''))
    );
    // One README row per gate — the hardened CDN bundle used to be gated
    // nowhere and listed nowhere, which is how it grew unwatched.
    expect(limits.length, 'the README size table lists a CI limit per gated artifact').toBe(gated);
    for (const limit of limits) expect(gate).toContain(`limit: ${limit}`);
  });
});
