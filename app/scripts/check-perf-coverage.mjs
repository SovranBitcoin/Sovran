#!/usr/bin/env node
/**
 * Page instrumentation coverage gate.
 *
 * Per-page performance logging is mounted in exactly two places: `Screen`
 * (`shared/ui/composed/Screen.tsx` — `ui.screen`, `screen.mount`,
 * `nav.transition`, `render.why`) and the bare `<Log>` boundary (`ui.screen`
 * only). A page whose component tree reaches neither is invisible to
 * log-doctor: no mount time, no render count, no screen boundary. Nothing
 * fails when that happens — the page simply never shows up in a report, which
 * reads as "no problem here". This gate turns the silence into a signal.
 *
 * It walks the canonical page registry (`e2e/schema/pages.ts`) through its
 * route aliases (`e2e/schema/page-routes.ts`) and, for each route file, follows
 * the components it renders until one of them renders `Screen` or `<Log>`.
 *
 * HOW A ROUTE IS FOLLOWED. Statically, by symbol — no bundler, no type
 * checker. From a file, the walk follows each imported name that the file
 * renders as JSX, re-exports, or default-exports, resolving it THROUGH feature
 * barrels (`export { X } from`, `export * from`) to the file that defines it.
 * Two limits keep "reaches" meaning what a reader expects:
 *
 *   - Hops stay inside `app/`, `features/`, `shared/blocks/` (cross-feature
 *     pages) and `shared/ui/composed/` (page shells). Without that, nearly
 *     every page would "reach" a `<Log>` through some shared leaf widget.
 *   - A bare `<Log>` only counts in `app/`, `features/` or `shared/blocks/` —
 *     a page-level boundary, not one buried in a shared component.
 *   - At most `MAX_HOPS` component hops from the route file.
 *
 * This is a heuristic and it errs in a known direction: a page can be reported
 * covered because a deep child renders `Screen`. It cannot report an
 * instrumented page as uncovered unless the page is wired in a way the walk
 * does not follow (a component passed as a prop value, a registry lookup) —
 * in which case the fix is to teach the walk, not to grow the baseline.
 *
 * Gaps are ratcheted, not banned: `scripts/perf-coverage-baseline.json` holds
 * the pages known to be uncovered and the pages with no route to check. A NEW
 * entry in either fails the gate; a page that becomes covered must leave the
 * list (run with `--update`), so the list can only shrink.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import { CANONICAL_PAGES } from '../e2e/schema/pages.ts';
import { PAGE_ROUTES } from '../e2e/schema/page-routes.ts';
import { writeRatchetArtifact } from './lib/ratchet-artifact.mjs';

const APP_DIR = resolve(import.meta.dirname, '..');
const ROUTES_DIR = resolve(APP_DIR, 'app');
const BASELINE_PATH = resolve(APP_DIR, 'scripts/perf-coverage-baseline.json');

const SCREEN_FILE = resolve(APP_DIR, 'shared/ui/composed/Screen.tsx');
/** Modules a `Log` import may come from: the public barrel or its source. */
const LOG_FILES = new Set([
  resolve(APP_DIR, 'shared/lib/logger.ts'),
  resolve(APP_DIR, 'shared/lib/loggerUI.tsx'),
]);

/** Directories a component hop may land in. See the header for why. */
const HOP_ROOTS = ['app', 'features', 'shared/blocks', 'shared/ui/composed'].map((root) =>
  resolve(APP_DIR, root)
);
/** Directories where a bare `<Log>` counts as a page boundary. */
const LOG_ROOTS = ['app', 'features', 'shared/blocks'].map((root) => resolve(APP_DIR, root));
const MAX_HOPS = 4;

/**
 * Metro picks one platform variant per bundle; the gate cannot know which, so
 * a specifier resolves to EVERY variant that exists and all of them are walked.
 */
const EXTENSIONS = ['.tsx', '.ts', '.ios.tsx', '.android.tsx', '.native.tsx', '.liquid.tsx'];

const shouldUpdate = process.argv.includes('--update');

const isUnder = (file, roots) => roots.some((root) => file.startsWith(`${root}/`));
const isFile = (path) => existsSync(path) && statSync(path).isFile();

/** Resolve an import specifier to the source files it can mean, or none. */
function resolveSpecifier(fromFile, specifier) {
  let base;
  if (specifier.startsWith('@/')) base = resolve(APP_DIR, specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier);
  else return []; // a package, or the `assets/` alias — never a page component
  if (isFile(base)) return [base];
  const direct = EXTENSIONS.map((ext) => base + ext).filter(isFile);
  if (direct.length > 0) return direct;
  return EXTENSIONS.map((ext) => resolve(base, `index${ext}`)).filter(isFile);
}

/** `a, b as c, type d` → [{ imported, local }], dropping type-only names. */
function parseNamedList(list) {
  return list
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.startsWith('type '))
    .map((part) => {
      const [imported, local] = part.split(/\s+as\s+/).map((name) => name.trim());
      return { imported, local: local ?? imported };
    });
}

const parsedFiles = new Map();

/** The import / export facts the walk needs from one file, parsed once. */
function parseFile(file) {
  const cached = parsedFiles.get(file);
  if (cached) return cached;
  const source = readFileSync(file, 'utf8');

  // local name → { specifier, imported } for every value import.
  const imports = new Map();
  for (const match of source.matchAll(
    /import\s+(?!type\b)([\w$]+\s*,\s*)?(?:\{([^}]*)\}|\*\s+as\s+([\w$]+)|([\w$]+))?\s*from\s*['"]([^'"]+)['"]/g
  )) {
    const [, defaultWithComma, named, namespace, defaultOnly, specifier] = match;
    const defaultName = defaultOnly ?? defaultWithComma?.replace(/[\s,]/g, '');
    if (defaultName) imports.set(defaultName, { specifier, imported: 'default' });
    if (namespace) imports.set(namespace, { specifier, imported: '*' });
    for (const { imported, local } of parseNamedList(named ?? '')) {
      imports.set(local, { specifier, imported });
    }
  }

  // exported name → { specifier, imported } for `export { a as b } from`.
  const reexports = new Map();
  for (const match of source.matchAll(
    /export\s+(?!type\b)\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g
  )) {
    for (const { imported, local } of parseNamedList(match[1])) {
      reexports.set(local, { specifier: match[2], imported });
    }
  }
  const starExports = [...source.matchAll(/export\s+\*\s+from\s*['"]([^'"]+)['"]/g)].map(
    (match) => match[1]
  );
  const lazyImports = [...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map(
    (match) => match[1]
  );
  const defaultExpression = source.match(/export\s+default\s+([^;\n]*)/)?.[1] ?? '';

  const parsed = { source, imports, reexports, starExports, lazyImports, defaultExpression };
  parsedFiles.set(file, parsed);
  return parsed;
}

/** Does `file` render the component bound to `local` as a JSX element? */
const rendersJsx = (source, local) =>
  new RegExp(`<${local.replace(/\$/g, '\\$')}[\\s/>.]`).test(source);

const declares = (source, name) =>
  new RegExp(`\\b(?:function|const|let|var|class)\\s+${name.replace(/\$/g, '\\$')}\\b`).test(
    source
  );

/**
 * Follow `name` from `file` through re-exports to the file(s) that define it.
 * A barrel is never the answer: it renders nothing.
 */
function resolveSymbol(file, name, seen = new Set()) {
  const key = `${file}#${name}`;
  if (seen.has(key)) return [];
  seen.add(key);
  const { source, imports, reexports, starExports, defaultExpression } = parseFile(file);

  const reexport = reexports.get(name);
  if (reexport) {
    return resolveSpecifier(file, reexport.specifier).flatMap((target) =>
      resolveSymbol(target, reexport.imported, seen)
    );
  }
  // `import X from …; export default X` — a route file forwarding a screen.
  const forwarded = name === 'default' ? imports.get(defaultExpression.trim()) : undefined;
  if (forwarded) {
    return resolveSpecifier(file, forwarded.specifier).flatMap((target) =>
      resolveSymbol(target, forwarded.imported, seen)
    );
  }
  if (name !== 'default' && name !== '*' && !declares(source, name) && starExports.length > 0) {
    const viaStar = starExports.flatMap((specifier) =>
      resolveSpecifier(file, specifier).flatMap((target) => resolveSymbol(target, name, seen))
    );
    if (viaStar.length > 0) return viaStar;
  }
  return [file];
}

/** Does this file itself render `Screen`, or a page-level `<Log>`? */
function rendersBoundary(file) {
  const { source, imports } = parseFile(file);
  for (const [local, { specifier, imported }] of imports) {
    const targets = resolveSpecifier(file, specifier);
    const isScreen = imported === 'Screen' && targets.includes(SCREEN_FILE);
    const isLog =
      imported === 'Log' &&
      targets.some((target) => LOG_FILES.has(target)) &&
      isUnder(file, LOG_ROOTS);
    if ((isScreen || isLog) && rendersJsx(source, local)) return true;
  }
  return false;
}

/** The files `file` hands rendering to: rendered, re-exported or default-exported. */
function componentTargets(file) {
  const { source, imports, reexports, lazyImports, defaultExpression } = parseFile(file);
  const targets = new Set();
  const follow = (specifier, name) => {
    for (const resolved of resolveSpecifier(file, specifier)) {
      for (const target of resolveSymbol(resolved, name)) targets.add(target);
    }
  };
  for (const [local, { specifier, imported }] of imports) {
    const inDefault = new RegExp(`\\b${local.replace(/\$/g, '\\$')}\\b`).test(defaultExpression);
    if (rendersJsx(source, local) || inDefault) follow(specifier, imported);
  }
  for (const { specifier, imported } of reexports.values()) follow(specifier, imported);
  for (const specifier of lazyImports) follow(specifier, 'default');
  targets.delete(file);
  return [...targets].filter((target) => isUnder(target, HOP_ROOTS));
}

/** Breadth-first from a route file: is a boundary within `MAX_HOPS` hops? */
function reachesBoundary(routeFile) {
  const seen = new Set([routeFile]);
  let frontier = [routeFile];
  for (let hop = 0; hop <= MAX_HOPS && frontier.length > 0; hop += 1) {
    const next = [];
    for (const file of frontier) {
      if (rendersBoundary(file)) return true;
      for (const target of componentTargets(file)) {
        if (seen.has(target)) continue;
        seen.add(target);
        next.push(target);
      }
    }
    frontier = next;
  }
  return false;
}

function sweep() {
  const uncovered = new Map();
  const unrouted = [];
  let routeCount = 0;

  for (const page of CANONICAL_PAGES) {
    const routes = PAGE_ROUTES[page] ?? [];
    if (routes.length === 0) {
      unrouted.push(page);
      continue;
    }
    const failing = [];
    for (const route of routes) {
      routeCount += 1;
      const routeFile = resolve(ROUTES_DIR, route);
      if (!isFile(routeFile)) {
        console.error(`✗ ${page}: route ${route} does not exist under app/app.`);
        process.exit(2);
      }
      if (!reachesBoundary(routeFile)) failing.push(route);
    }
    if (failing.length > 0) uncovered.set(page, failing);
  }
  return { uncovered, unrouted: unrouted.sort(), routeCount };
}

const { uncovered, unrouted, routeCount } = sweep();

if (routeCount === 0) {
  console.error('✗ Checked 0 routes — empty page registry, or a moved routes directory?');
  process.exit(2);
}

if (shouldUpdate) {
  await writeRatchetArtifact(BASELINE_PATH, {
    $comment:
      'Canonical pages with no per-page performance instrumentation. `uncovered`: the listed route files (relative to app/app) never reach Screen or a page-level <Log>. `unrouted`: the page has no route alias in e2e/schema/page-routes.ts, so it cannot be checked. Ratcheted by scripts/check-perf-coverage.mjs — both lists may only shrink. Regenerate with `bun run check:perf-coverage:update`.',
    uncovered: Object.fromEntries([...uncovered].sort(([a], [b]) => a.localeCompare(b))),
    unrouted,
  });
  console.error(
    `✓ Banked ${uncovered.size} uncovered and ${unrouted.length} unrouted of ${CANONICAL_PAGES.length} canonical pages.`
  );
  process.exit(0);
}

if (!existsSync(BASELINE_PATH)) {
  console.error(`✗ Missing ${relative(APP_DIR, BASELINE_PATH)} — run with --update to create it.`);
  process.exit(2);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
const knownUncovered = new Set(Object.keys(baseline.uncovered ?? {}));
const knownUnrouted = new Set(baseline.unrouted ?? []);

const addedUncovered = [...uncovered.keys()].filter((page) => !knownUncovered.has(page)).sort();
const addedUnrouted = unrouted.filter((page) => !knownUnrouted.has(page));
const fixed = [
  ...[...knownUncovered].filter((page) => !uncovered.has(page)),
  ...[...knownUnrouted].filter((page) => !unrouted.includes(page)),
].sort();

console.error(
  `Perf coverage: ${CANONICAL_PAGES.length - uncovered.size - unrouted.length} of ${CANONICAL_PAGES.length} canonical pages reach Screen or <Log> (${routeCount} routes checked, ${uncovered.size} uncovered, ${unrouted.length} unrouted).`
);

if (addedUncovered.length > 0 || addedUnrouted.length > 0) {
  if (addedUncovered.length > 0) {
    console.error(`\n✗ ${addedUncovered.length} NEW page(s) with no instrumentation:\n`);
    for (const page of addedUncovered) {
      console.error(`    ${page}`);
      for (const route of uncovered.get(page)) console.error(`      app/app/${route}`);
    }
  }
  if (addedUnrouted.length > 0) {
    console.error(`\n✗ ${addedUnrouted.length} NEW page(s) with no route to check:\n`);
    for (const page of addedUnrouted) console.error(`    ${page}`);
  }
  console.error(
    '\n  Render the page inside `Screen` (shared/ui/composed/Screen.tsx) — it mounts\n' +
      '  mount, navigation and render timing by `name`. Where Screen cannot own the\n' +
      '  layout, wrap the page in `<Log name="…Screen">`. For a page with no route,\n' +
      '  register its alias in e2e/schema/page-routes.ts.'
  );
  process.exit(1);
}

if (fixed.length > 0) {
  console.error(`\n✗ ${fixed.length} page(s) are now covered and must leave the baseline:\n`);
  for (const page of fixed) console.error(`    ${page}`);
  console.error('\n  Ratchet down with: bun run check:perf-coverage:update');
  process.exit(1);
}

console.error(
  `\n✓ No new uninstrumented pages (${uncovered.size} uncovered, ${unrouted.length} unrouted, ratcheted).`
);
