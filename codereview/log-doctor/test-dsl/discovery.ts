/**
 * @fileoverview Sovran Test DSL — test discovery.
 *
 * Globs `<repo>/tests/*.sov`, parses each file via the parser, and builds
 * a flat lookup of every test that's been defined. The runner uses this
 * to resolve `phone test <name>` requests, list available tests, and run
 * everything via `phone test all`.
 *
 * Test name disambiguation: if two `.sov` files declare a `test` with
 * the same human name, the second one is keyed by `<file-basename>::<name>`
 * so both remain reachable. The first instance keeps the bare name for
 * backward compatibility with single-file repos.
 */

import * as fs from 'fs';
import * as nodePath from 'path';

import { type Define, type MatrixDef, type Suite, type Test } from './ast';
import { parseSuite } from './parser';

interface DiscoveredTest {
  /** The Test AST node. */
  test: Test;
  /** The Suite the test came from (used for `run` define resolution). */
  suite: Suite;
  /** Absolute path of the .sov file. */
  file: string;
  /** Display name (may have a `<file>::` prefix on collision). */
  displayName: string;
}

interface DiscoveredMatrix {
  /** The Matrix AST node. */
  matrix: MatrixDef;
  /** The Suite the matrix came from (used for variant define resolution). */
  suite: Suite;
  /** Absolute path of the .sov file. */
  file: string;
  /** Display name (may have a `<file>::` prefix on collision). */
  displayName: string;
}

interface DiscoveryResult {
  /**
   * Map keyed by display name (kebab-cased test name, optionally
   * `file::` prefixed). Only holds hand-written `test` blocks —
   * matrices live in the separate `matrices` map below so the CLI can
   * render them with a different marker in the listing.
   */
  tests: Map<string, DiscoveredTest>;
  /**
   * Map keyed by display name (kebab-cased matrix title, optionally
   * `file::` prefixed). Matrix names share the same namespace as test
   * names for collision purposes — a matrix whose key collides with a
   * test gets the `<file>::` prefix so `phone test <name>` always
   * resolves to exactly one runnable.
   */
  matrices: Map<string, DiscoveredMatrix>;
  /** Suites that were parsed, keyed by absolute file path. Useful for re-emit. */
  suites: Map<string, Suite>;
  /**
   * Merged defines from every parsed suite, keyed by define name. The
   * executor uses this as a fallback when `run <name>` doesn't resolve
   * in the local suite — so utilities in `tests/_shared/*.sov` can be
   * called from any flow file without duplicating them. Ties between
   * suites are won by whichever file parsed FIRST (alphabetically),
   * which is why `_shared/*.sov` — leading-underscore files sort
   * before lowercase letters — takes precedence when both define the
   * same name.
   */
  globalDefines: Map<string, Define>;
}

/**
 * Discover all `.sov` files under the given root and parse them into a
 * flat test lookup.
 *
 * The default root is `<cwd>/tests`. Files are discovered via a single-
 * level readdir (no recursion) — flat layout encourages flat naming.
 */
export function discoverTests(testsDir?: string): DiscoveryResult {
  const dir = testsDir ?? nodePath.resolve(process.cwd(), 'tests');
  const result: DiscoveryResult = {
    tests: new Map(),
    matrices: new Map(),
    suites: new Map(),
    globalDefines: new Map(),
  };

  if (!fs.existsSync(dir)) {
    return result; // empty discovery — caller decides whether to error
  }

  // Walk the tests dir one level deep PLUS recurse into `_shared/` —
  // utilities live there and we need them to parse before any flow
  // file that might `run` them. Recursion is deliberately shallow
  // (just `_shared/`) so flat-layout conventions still work and we
  // don't accidentally pick up tests from archived/backup dirs.
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir).sort()) {
    const filePath = nodePath.join(dir, entry);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory() && entry.startsWith('_')) {
      // Recurse into shared/library dirs. Their files parse first
      // (sort-order wise, `_shared` beats any letter-named file).
      for (const inner of fs.readdirSync(filePath).sort()) {
        if (inner.endsWith('.sov')) files.push(nodePath.join(filePath, inner));
      }
      continue;
    }
    if (stat.isFile() && entry.endsWith('.sov')) {
      files.push(filePath);
    }
  }
  // Shared dir entries should come first in the load order. readdir
  // ordering already puts `_*` before letters, but once we flatten we
  // need to re-sort with the prefix-aware comparator so `_shared/foo`
  // precedes `mint-lightning.sov` regardless of how the walk emitted them.
  files.sort((a, b) => {
    const aShared = a.includes(`${nodePath.sep}_`);
    const bShared = b.includes(`${nodePath.sep}_`);
    if (aShared && !bShared) return -1;
    if (bShared && !aShared) return 1;
    return a.localeCompare(b);
  });

  for (const filePath of files) {
    const entry = nodePath.basename(filePath);
    const source = fs.readFileSync(filePath, 'utf-8');
    const suite = parseSuite(source, filePath);
    result.suites.set(filePath, suite);

    // Merge defines into the global lookup — first one wins so
    // `_shared/` utilities can't be shadowed by a per-flow define
    // with the same name. Duplicates WITHIN one suite are already
    // rejected by the parser.
    for (const [name, def] of suite.defines) {
      if (!result.globalDefines.has(name)) {
        result.globalDefines.set(name, def);
      }
    }

    // Register tests. Matrix titles share the display-name namespace
    // with tests — a name used by either kind anywhere in the suite set
    // causes subsequent collisions to be qualified with `<file>::` so
    // `phone test <name>` resolves to exactly one runnable.
    const fileBase = entry.replace(/\.sov$/, '');
    for (const test of suite.tests) {
      const baseName = nameToKey(test.name);
      const colliding = result.tests.has(baseName) || result.matrices.has(baseName);
      const displayName = colliding ? `${fileBase}::${baseName}` : baseName;
      result.tests.set(displayName, {
        test,
        suite,
        file: filePath,
        displayName,
      });
    }

    // Register matrices.
    for (const matrix of suite.matrices) {
      const baseName = nameToKey(matrix.title);
      const colliding = result.tests.has(baseName) || result.matrices.has(baseName);
      const displayName = colliding ? `${fileBase}::${baseName}` : baseName;
      result.matrices.set(displayName, {
        matrix,
        suite,
        file: filePath,
        displayName,
      });
    }
  }

  return result;
}

/**
 * Convert a test name to its lookup key. Strips surrounding whitespace,
 * lowercases, and replaces non-alphanumeric runs with single dashes —
 * matches the kebab-case convention used by the existing CLI.
 */
function nameToKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Find a single test by its key. Returns undefined if not found. Used by
 * `phone test <name>` — the caller renders the available list on miss.
 */
export function findTest(result: DiscoveryResult, name: string): DiscoveredTest | undefined {
  return result.tests.get(name) ?? result.tests.get(nameToKey(name));
}

/**
 * Find a matrix by its key. Mirror of `findTest` — the caller decides
 * whether to prefer a test or a matrix on ambiguous input (today's CLI
 * tries test first then falls back to matrix, which matches the common
 * case of adding a matrix to a file that already has unit tests).
 */
export function findMatrix(result: DiscoveryResult, name: string): DiscoveredMatrix | undefined {
  return result.matrices.get(name) ?? result.matrices.get(nameToKey(name));
}

/**
 * Render a discovery as a one-line-per-entry list, in stable file
 * order. Used by `phone test list` and the not-found error message.
 * Matrices are marked with a `[matrix]` tag so authors can tell them
 * apart from single `test` blocks when scanning the list.
 */
export function formatTestList(result: DiscoveryResult): string {
  const out: string[] = [];
  for (const [key, t] of result.tests) {
    const verified = t.test.verified
      ? `verified ${t.test.verified.date}${t.test.verified.device ? ` — ${t.test.verified.device}` : ''}`
      : '(unverified)';
    const file = nodePath.relative(process.cwd(), t.file);
    out.push(`  ${key.padEnd(40)} ${verified}`);
    out.push(`      ${file}  — ${t.test.name}`);
  }
  for (const [key, m] of result.matrices) {
    const v = m.matrix.verification;
    const verified = v ? `verified ${v.date}${v.device ? ` — ${v.device}` : ''}` : '(unverified)';
    const file = nodePath.relative(process.cwd(), m.file);
    const cellCount = m.matrix.stages.reduce(
      (n, stage) => n * (stage.variantKind === 'bundleOf' ? 1 : stage.variants.length),
      1
    );
    out.push(
      `  ${key.padEnd(40)} [matrix · ${m.matrix.mode} · ~${cellCount} cell${cellCount === 1 ? '' : 's'}] ${verified}`
    );
    out.push(`      ${file}  — ${m.matrix.title}`);
  }
  if (out.length === 0) {
    return '(no tests found — create one in tests/*.sov)';
  }
  return out.join('\n');
}
