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
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
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

/** Island/hydration suites the README's Stability row counts. */
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
    const pins = [...README.matchAll(/@getforma\/core@([\d.]+)/g)].map((m) => m[1]);
    expect(pins.length, 'README should still contain concrete pins').toBeGreaterThan(0);
    for (const pin of pins) expect(pin).toBe(pkg.version);
  });

  it('the changelog has an Unreleased section above the newest release', () => {
    const unreleased = CHANGELOG.indexOf('## [Unreleased]');
    const newest = CHANGELOG.indexOf(`## [${pkg.version}]`);
    expect(unreleased, 'CHANGELOG.md needs an ## [Unreleased] heading').toBeGreaterThan(-1);
    expect(newest).toBeGreaterThan(unreleased);
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
    const section = README.slice(README.indexOf('### All builds'), README.indexOf('## Subpath Exports'));
    const listed = [...section.matchAll(/\| `([\w.-]+\.js)` \|/g)].map((m) => `dist/${m[1]}`);
    expect(new Set(listed)).toEqual(new Set(CDN_URL_ARTIFACTS));
  });

  it('does not point the browser ESM recipe at the code-split npm entry', () => {
    // dist/index.js imports the bare specifier "alien-signals" and its own
    // chunks; a browser can resolve neither, so the old snippet never ran.
    expect(README).not.toMatch(/@getforma\/core@[\d.]+\/dist\/index\.js/);
    expect(README).toContain('/dist/forma.esm.js');
  });

  it('mentions no artifact the build no longer produces', () => {
    // dist/formajs.global.js was a 461 KB orphan with no exports subpath and no
    // README row; it is gone, and nothing may reintroduce a reference to it.
    for (const doc of [README, SECURITY, CSP]) {
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
    // `$` and `$$` have no word boundary, so match the backticked form too.
    const undocumented = exported.filter(
      (name) => !README.includes(`\`${name}\``) && !new RegExp(`\\b${name}\\b`).test(README)
    );
    expect(undocumented, 'add these to the Core API tables in README.md').toEqual([]);
  });

  it('names the unsanitized HTML sinks reachable from the core entry', () => {
    // CSP.md answers "innerHTML — FormaJS uses it? No" for library-generated
    // markup; that is only honest if the opt-in sinks are named somewhere.
    for (const sink of ['dangerouslySetInnerHTML', 'setHTMLUnsafe', 'srcdoc']) {
      expect(README, sink).toContain(sink);
      expect(SECURITY, sink).toContain(sink);
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
  const CITATION = /Verified by:?\s+`([^`]+)`\s*>\s*"([^"]+)"/g;
  const DOCS = { 'README.md': README, 'SECURITY.md': SECURITY, 'CSP.md': CSP };

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
        expect(source, `${doc} cites "${name}" in ${file}`).toContain(`'${name}'`);
      }
    }
    expect(checked, 'the docs should still carry citations').toBeGreaterThan(20);
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
      expect(present.has(file), `${file} is named in the README figure`).toBe(true);
      cases += (read(`src/dom/__tests__/${file}`).match(/^\s*(?:it|test)[(.]/gm) ?? []).length;
    }
    const claimed = /Islands \(`activateIslands`[^|]*\|[^|]*\|\s*(\d+) tests across (\d+)/.exec(README);
    expect(claimed, 'the Stability row must state "<n> tests across <m> dedicated files"').not.toBeNull();
    expect(Number(claimed![1])).toBe(cases);
    expect(Number(claimed![2])).toBe(ISLAND_TEST_FILES.length);
  });

  it('the size table quotes the limits the CI gate actually enforces', () => {
    const gate = read('scripts/check-size.mjs');
    const limits = [...README.matchAll(/\| ([\d,]{5,}) B \|/g)].map((m) =>
      Number(m[1].replace(/,/g, ''))
    );
    expect(limits.length, 'the README size table lists a CI limit per artifact').toBe(3);
    for (const limit of limits) expect(gate).toContain(`limit: ${limit}`);
  });
});
