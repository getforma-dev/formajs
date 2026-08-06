/**
 * Unit tests for the shared bundle-size gate (scripts/check-size.mjs).
 *
 * The gate it replaced weighed dist/index.js alone while the entry's shared
 * chunks — where most of the core lives — went unmeasured, so code moved out of
 * the entry was free. These cases pin the graph walk that makes it honest.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { parseImportSpecifiers, collectGraph, gzipTotal, GATES, measure } from '../../scripts/check-size.mjs';
import { CDN_URL_ARTIFACTS } from '../../scripts/build-defines.mjs';

/** Build a throwaway dist tree and hand its root to `fn`. */
function withFixture(files: Record<string, string>, fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'forma-size-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(root, rel);
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, content);
    }
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('parseImportSpecifiers', () => {
  it('parses static, side-effect, dynamic and require specifiers', () => {
    const code = [
      'import { a } from "./chunk-A.js";',
      'import {',
      '  b',
      '} from "./chunk-B.js";',
      'export * from "./chunk-C.js";',
      'import "./side-effect.js";',
      'const late = await import("./lazy.js");',
      'const cjs = require("./chunk-D.cjs");',
      'import x from "alien-signals";',
    ].join('\n');

    expect(parseImportSpecifiers(code).sort()).toEqual([
      './chunk-A.js',
      './chunk-B.js',
      './chunk-C.js',
      './chunk-D.cjs',
      './lazy.js',
      './side-effect.js',
      'alien-signals',
    ]);
  });

  it('does not mistake an identifier or attribute ending in "from" for an import', () => {
    // dist really contains `el.getAttribute("data-forma-from") ?? el.getAttribute("…")`,
    // which a naive /from\s*["']/ matches.
    const code = 'const v = el.getAttribute("data-forma-from") ?? el.getAttribute("x");';
    expect(parseImportSpecifiers(code)).toEqual([]);
  });
});

describe('collectGraph', () => {
  it('walks a chunked module graph transitively', () => {
    withFixture(
      {
        'dist/index.js': 'export * from "./chunk-A.js";\nimport "./chunk-B.js";',
        'dist/chunk-A.js': 'import { x } from "./chunk-C.js";\nexport const a = x;',
        'dist/chunk-B.js': 'export const b = 1;',
        'dist/chunk-C.js': 'import s from "alien-signals";\nexport const x = s;',
        'dist/unreferenced.js': 'export const nope = 1;',
      },
      (root) => {
        const graph = collectGraph('dist/index.js', root);
        expect(graph.files).toEqual([
          'dist/chunk-A.js',
          'dist/chunk-B.js',
          'dist/chunk-C.js',
          'dist/index.js',
        ]);
        // Bare specifiers are reported, not weighed, and not followed.
        expect(graph.external).toEqual(['alien-signals']);
        expect(graph.files).not.toContain('dist/unreferenced.js');
      }
    );
  });

  it('survives a cycle between chunks', () => {
    withFixture(
      {
        'dist/a.js': 'import "./b.js";',
        'dist/b.js': 'import "./a.js";',
      },
      (root) => {
        expect(collectGraph('dist/a.js', root).files).toEqual(['dist/a.js', 'dist/b.js']);
      }
    );
  });

  it('fails loudly when a chunk import cannot be resolved', () => {
    withFixture({ 'dist/a.js': 'import "./gone.js";' }, (root) => {
      expect(() => collectGraph('dist/a.js', root)).toThrow(/imports missing file \.\/gone\.js/);
    });
  });

  it('sums the gzipped size of the whole graph, not just the entry', () => {
    const entry = 'export * from "./chunk-A.js";\n';
    const chunk = `export const big = ${JSON.stringify('x'.repeat(4096))};\n`;
    withFixture({ 'dist/index.js': entry, 'dist/chunk-A.js': chunk }, (root) => {
      const { files } = collectGraph('dist/index.js', root);
      const total = gzipTotal(files, root);
      expect(total).toBe(gzipSync(entry).length + gzipSync(chunk).length);
      expect(total).toBeGreaterThan(gzipSync(entry).length);
    });
  });
});

describe('the gate list', () => {
  // `dist/formajs-runtime-hardened.global.js` — the artifact the docs point
  // CSP-strict users at, and the one the exports map calls `runtime-csp` —
  // was gated NOWHERE: not here, not in ci.yml, not in release.yml. It could
  // have doubled in size between releases with nothing to say so.

  it('gates every CDN runtime artifact the docs point at', () => {
    const gated = new Set(GATES.map((g) => g.entry));
    const runtimeCdnArtifacts = CDN_URL_ARTIFACTS.filter((a) => /runtime.*\.global\.js$/.test(a));
    expect(runtimeCdnArtifacts.length, 'the CDN list should still name runtime IIFE bundles')
      .toBeGreaterThan(1);
    for (const artifact of runtimeCdnArtifacts) {
      expect(gated, `${artifact} must have a size gate`).toContain(artifact);
    }
    // The two runtime bundles carry the expression engine, so their gates are
    // set close to the measurement rather than at the +20% the other entries
    // use. Anything looser than +10% over the recorded size is not a gate.
    for (const [entry, measured] of [
      ['dist/formajs-runtime.global.js', 31763],
      ['dist/formajs-runtime-hardened.global.js', 30764],
    ] as const) {
      const gate = GATES.find((g) => g.entry === entry);
      expect(gate, `${entry} needs its own gate`).toBeDefined();
      expect(gate!.limit, `${entry} gate is too loose to catch a regression`)
        .toBeLessThanOrEqual(Math.round(measured * 1.1));
      expect(gate!.limit, `${entry} gate is below its own recorded size`)
        .toBeGreaterThan(measured);
    }
  });

  // The README size table is kept in step with these limits by
  // docs-truth.test.ts > "the size table quotes the limits the CI gate actually
  // enforces", which checks the count AND the values. Asserting it a second
  // time here would be a weaker copy of the same claim.

  it('a gate reports over when its graph exceeds the limit', () => {
    // The gate's verdict, not just its measurement: a comparison written the
    // wrong way round would satisfy every other case in this file. The chunk
    // is incompressible so gzip cannot rescue it below the limit.
    let seed = 12345;
    const incompressible = Array.from({ length: 40_000 }, () => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return String.fromCharCode(33 + (seed % 90));
    }).join('');
    withFixture(
      {
        'dist/entry.js': 'export * from "./chunk.js";',
        'dist/chunk.js': `export const x = ${JSON.stringify(incompressible)};`,
      },
      (root) => {
        const gate = { entry: 'dist/entry.js', limit: 1000, note: 'fixture' };
        expect(measure(gate, root).over).toBe(true);
        expect(measure({ ...gate, limit: 10_000_000 }, root).over).toBe(false);
      },
    );
  });
});
