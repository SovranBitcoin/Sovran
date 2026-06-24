#!/usr/bin/env node

/**
 * analyze-structure.mjs
 *
 * Walks the project tree and produces:
 *   - Annotated tree of files with their exports and imports.
 *   - Structural reports: fan-in, coupling, cycles, orphans, colocate, boundary.
 *   - Module-depth reports: shallow modules, pass-through suspects, hub-spoke
 *     coordinators, instability, re-export depth, importer reach.
 *   - Code-quality reports: cognitive-complexity hotspots, type-safety smells
 *     (any/!/as/@ts-*), React-component smells (large components, hook count,
 *     boolean-state soup, inline subcomponents, useEffect dependency density,
 *     StyleSheet size).
 *   - Symbol-level reports: duplicate export names, unused exports,
 *     default+named clashes, test colocation.
 *   - Conceptual reports: information-leakage clusters, concept locality
 *     (CONTEXT.md), vocabulary drift.
 *   - Architecture-rule violations (when .architecture.json is present).
 *   - History-based reports (opt-in `--history`): churn × complexity, temporal
 *     coupling, stale files.
 *   - LLM-friendly compact summary (`--llm`).
 *
 * Default reports run unless suppressed with `--no-<name>`.
 * Opt-in (off by default): --history, --reach, --leakage, --concept,
 *   --vocab-drift, --architecture, --boundary, --llm.
 *
 * Common usage:
 *   node scripts/analyze-structure.mjs                  # full default report
 *   node scripts/analyze-structure.mjs app              # subtree
 *   node scripts/analyze-structure.mjs --json           # machine-readable
 *   node scripts/analyze-structure.mjs --llm            # compact LLM-friendly summary
 *   node scripts/analyze-structure.mjs --history --since 6   # last 6 months of git
 *   node scripts/analyze-structure.mjs --architecture        # use .architecture.json
 *
 * Tuning flags (with defaults):
 *   --fanin-min 1
 *   --coupling-depth 1
 *   --colocate-threshold 0.7
 *   --shallow-min-exports 4         # files needing 4+ exports to qualify as shallow
 *   --shallow-max-depth 12          # depth ratio below this = shallow
 *   --component-lines 300           # component size warning threshold
 *   --hook-max 7                    # warn at >N hooks per component
 *   --prop-max 7                    # warn at >N props per component
 *   --complexity-threshold 25       # cognitive-complexity warning threshold
 *   --since 12                      # months of git history for --history
 *   --leakage-threshold 0.6         # Jaccard threshold for leakage clusters
 *   --reach-top 25                  # top-N high-reach files to surface
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join, extname, basename, relative, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

import { IGNORE_DIRS, IGNORE_FILES, IGNORE_PATH_PATTERNS, TS_EXTS } from '../shared/ignore.mjs';
import { stripCodeNoise, findMatchingBrace } from '../shared/source.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

// ─── Config ──────────────────────────────────────────────────────────────────

// Order matters: bare extensions first, then platform variants (.ios.* before
// .android.* matches Metro's preference on iOS-targeted dev), then `/index.*`
// fallbacks for directory imports. Without the platform variants the resolver
// misses any module whose only files are `.ios.tsx` / `.android.tsx`, and every
// such file shows up as an orphan even though Metro happily imports it.
const RESOLVE_EXTS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.ios.ts',
  '.ios.tsx',
  '.ios.js',
  '.ios.jsx',
  '.android.ts',
  '.android.tsx',
  '.android.js',
  '.android.jsx',
  '.native.ts',
  '.native.tsx',
  '.native.js',
  '.native.jsx',
  '.web.ts',
  '.web.tsx',
  '.web.js',
  '.web.jsx',
  '/index.ts',
  '/index.tsx',
  '/index.js',
  '/index.jsx',
  '/index.ios.ts',
  '/index.ios.tsx',
  '/index.android.ts',
  '/index.android.tsx',
  '/index.native.ts',
  '/index.native.tsx',
  '/index.web.ts',
  '/index.web.tsx',
];

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const showJson = args.includes('--json');
const showLlm = args.includes('--llm');
const hideTypes = args.includes('--no-types');
const hideSame = args.includes('--no-reexport');
const showImports = !args.includes('--no-imports');
const hideExternal = args.includes('--no-ext');
const showLoc = !args.includes('--no-loc');

// Existing structural reports (default ON; pass --no-X to disable)
const showFanin = !args.includes('--no-fanin');
const showCoupling = !args.includes('--no-coupling');
const showCycles = !args.includes('--no-cycles');
const showOrphans = !args.includes('--no-orphans');
const showColocate = !args.includes('--no-colocate');

// New default-on reports
const showShallow = !args.includes('--no-shallow');
const showPassthrough = !args.includes('--no-passthrough');
const showComplexity = !args.includes('--no-complexity');
const showTypesafety = !args.includes('--no-typesafety');
const showComponent = !args.includes('--no-component');
const showHubSpoke = !args.includes('--no-hub');
const showInstability = !args.includes('--no-instability');
const showReexportDepth = !args.includes('--no-reexport-depth');
const showDupExports = !args.includes('--no-dup-exports');
const showUnusedExports = !args.includes('--no-unused-exports');
const showTestColocation = !args.includes('--no-test-colocation');
const showScore = !args.includes('--no-score');

// New opt-in reports
const showLeakage = args.includes('--leakage');
const showVocabDrift = args.includes('--vocab-drift');
const showReach = args.includes('--reach');
const showHistory = args.includes('--history');

// --concept may be opt-in or auto-detected when CONTEXT.md exists
const conceptFlagPresent = args.includes('--concept');
const conceptCandidate = join(ROOT, 'CONTEXT.md');
const showConcept = conceptFlagPresent || existsSync(conceptCandidate);

// --architecture <path?> opt-in (auto-detects .architecture.json)
const archIdx = args.indexOf('--architecture');
let architecturePath = null;
if (archIdx !== -1) {
  const next = args[archIdx + 1];
  architecturePath =
    next && !next.startsWith('--') ? resolve(ROOT, next) : join(ROOT, '.architecture.json');
} else {
  const auto = join(ROOT, '.architecture.json');
  if (existsSync(auto)) architecturePath = auto;
}
const showArchitecture = !!architecturePath && existsSync(architecturePath);

// --boundary <folderA> <folderB>
const boundaryIdx = args.indexOf('--boundary');
let boundaryA = null;
let boundaryB = null;
if (boundaryIdx !== -1) {
  const remaining = args.slice(boundaryIdx + 1).filter((a) => !a.startsWith('--'));
  boundaryA = remaining[0] || null;
  boundaryB = remaining[1] || null;
  if (!boundaryA || !boundaryB) {
    console.error(
      'Error: --boundary requires two folder paths, e.g. --boundary features/mints features/payments'
    );
    process.exit(1);
  }
}

function getNumericArg(flag, defaultVal) {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  const val = parseFloat(args[idx + 1]);
  return isNaN(val) ? defaultVal : val;
}

const faninMin = getNumericArg('--fanin-min', 1);
const couplingDepth = getNumericArg('--coupling-depth', 1);
const colocateThreshold = getNumericArg('--colocate-threshold', 0.7);
const shallowMinExports = getNumericArg('--shallow-min-exports', 4);
const shallowMaxDepth = getNumericArg('--shallow-max-depth', 12);
const componentLineThreshold = getNumericArg('--component-lines', 300);
const hookMaxThreshold = getNumericArg('--hook-max', 7);
const propMaxThreshold = getNumericArg('--prop-max', 7);
const complexityThreshold = getNumericArg('--complexity-threshold', 25);
const sinceMonths = getNumericArg('--since', 12);
const leakageThreshold = getNumericArg('--leakage-threshold', 0.6);
const reachTop = getNumericArg('--reach-top', 25);

// Target directory — skip flags and their value args
const flagsWithValue = new Set([
  '--fanin-min',
  '--coupling-depth',
  '--colocate-threshold',
  '--boundary',
  '--shallow-min-exports',
  '--shallow-max-depth',
  '--component-lines',
  '--hook-max',
  '--prop-max',
  '--complexity-threshold',
  '--since',
  '--leakage-threshold',
  '--reach-top',
  '--architecture',
]);
const allFlags = new Set([
  '--json',
  '--llm',
  '--no-types',
  '--no-reexport',
  '--no-imports',
  '--no-ext',
  '--no-loc',
  '--no-fanin',
  '--no-coupling',
  '--no-cycles',
  '--no-orphans',
  '--no-colocate',
  '--no-shallow',
  '--no-passthrough',
  '--no-complexity',
  '--no-typesafety',
  '--no-component',
  '--no-hub',
  '--no-instability',
  '--no-reexport-depth',
  '--no-dup-exports',
  '--no-unused-exports',
  '--no-test-colocation',
  '--no-score',
  '--leakage',
  '--vocab-drift',
  '--reach',
  '--history',
  '--concept',
  ...flagsWithValue,
]);

let targetArg = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (allFlags.has(a)) {
    if (a === '--boundary') {
      i += 2;
      continue;
    }
    if (a === '--architecture') {
      // Optional value: skip if next is non-flag
      if (args[i + 1] && !args[i + 1].startsWith('--')) i++;
      continue;
    }
    if (flagsWithValue.has(a)) i++;
    continue;
  }
  if (!a.startsWith('--')) {
    targetArg = a;
    break;
  }
}
const targetDir = targetArg ? join(ROOT, targetArg) : ROOT;

// Whether any analysis mode is active (controls whether to build the dep graph)
const anyAnalysis =
  showFanin ||
  showCoupling ||
  showCycles ||
  showOrphans ||
  showColocate ||
  showShallow ||
  showPassthrough ||
  showComplexity ||
  showTypesafety ||
  showComponent ||
  showHubSpoke ||
  showInstability ||
  showReexportDepth ||
  showDupExports ||
  showUnusedExports ||
  showTestColocation ||
  showScore ||
  showLeakage ||
  showVocabDrift ||
  showReach ||
  showConcept ||
  showHistory ||
  showArchitecture ||
  !!boundaryA;

// ─── Path resolution ─────────────────────────────────────────────────────────

function resolveImport(importPath, fromFile) {
  let base;

  if (importPath.startsWith('.')) {
    base = resolve(dirname(fromFile), importPath);
  } else if (importPath.startsWith('@/')) {
    base = resolve(ROOT, importPath.slice(2));
  } else if (!importPath.startsWith('@') && !importPath.includes('/')) {
    return null;
  } else if (importPath.startsWith('@') && !importPath.startsWith('@/')) {
    base = resolve(ROOT, importPath);
    if (!tryResolveFile(base)) return null;
  } else {
    base = resolve(ROOT, importPath);
  }

  return tryResolveFile(base);
}

function tryResolveFile(base) {
  if (existsSync(base) && isFile(base)) return base;
  for (const ext of RESOLVE_EXTS) {
    const candidate = base + ext;
    if (existsSync(candidate) && isFile(candidate)) return candidate;
  }
  return null;
}

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

// Source utilities (stripCodeNoise, findMatchingBrace) imported from
// ../shared/source.mjs — see top of file.

// ─── LOC counting (cloc-style) ───────────────────────────────────────────────

function countLines(src) {
  const lines = src.split('\n');
  let blank = 0,
    comment = 0,
    code = 0;
  let inBlock = false;

  for (const raw of lines) {
    const t = raw.trim();
    if (t === '') {
      blank++;
      continue;
    }
    if (inBlock) {
      comment++;
      if (t.includes('*/')) inBlock = false;
      continue;
    }
    if (t.startsWith('/*') || t.startsWith('*')) {
      comment++;
      const closeIdx = t.indexOf('*/');
      if (closeIdx === -1) inBlock = true;
      continue;
    }
    if (t.startsWith('//')) {
      comment++;
      continue;
    }
    code++;
    const openIdx = t.indexOf('/*');
    if (openIdx !== -1) {
      const closeIdx = t.indexOf('*/', openIdx + 2);
      if (closeIdx === -1) inBlock = true;
    }
  }
  return { total: lines.length, code, blank, comment };
}

// ─── Cognitive / cyclomatic complexity (regex/scanner approximation) ─────────

const COMPLEXITY_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch']);

function computeComplexity(src) {
  const code = stripCodeNoise(src);
  let cognitive = 0;
  let cyclomatic = 1;
  let nesting = 0;
  let nestingMax = 0;
  const len = code.length;
  let i = 0;
  while (i < len) {
    const ch = code[i];
    if (ch === '{') {
      nesting++;
      if (nesting > nestingMax) nestingMax = nesting;
      i++;
      continue;
    }
    if (ch === '}') {
      if (nesting > 0) nesting--;
      i++;
      continue;
    }
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_') {
      let j = i;
      while (j < len && /[\w]/.test(code[j])) j++;
      const word = code.slice(i, j);
      if (COMPLEXITY_KEYWORDS.has(word)) {
        cognitive += 1 + nesting;
        cyclomatic++;
      } else if (word === 'case') {
        cognitive++;
        cyclomatic++;
      }
      i = j;
      continue;
    }
    if (ch === '&' && code[i + 1] === '&') {
      cognitive++;
      cyclomatic++;
      i += 2;
      continue;
    }
    if (ch === '|' && code[i + 1] === '|') {
      cognitive++;
      cyclomatic++;
      i += 2;
      continue;
    }
    if (ch === '?' && code[i + 1] !== '.' && code[i + 1] !== '?') {
      cognitive++;
      cyclomatic++;
      i++;
      continue;
    }
    i++;
  }
  return { cognitive, cyclomatic, nestingMax };
}

// ─── Type-safety smell counts ────────────────────────────────────────────────

function countTypeSmells(src) {
  const code = stripCodeNoise(src);
  const anyMatches =
    code.match(
      /(?::\s*any\b)|(?:\bas\s+any\b)|(?:<\s*any\s*[>,])|(?:\bany\[\])|(?:\bArray<\s*any\s*>)/g
    ) || [];
  const bangs = code.match(/[\w\)\]][!](?=[.\[\)\;\,\s])/g) || [];
  const allCasts = code.match(/\bas\s+[A-Za-z_][\w<>.,\s|&]*/g) || [];
  const casts = allCasts.filter((m) => !/^as\s+const\b/.test(m) && !/^as\s+unknown\b/.test(m));
  const ignores = src.match(/@ts-(?:ignore|expect-error|nocheck)/g) || [];
  return {
    any: anyMatches.length,
    bangs: bangs.length,
    casts: casts.length,
    tsIgnore: ignores.length,
  };
}

// ─── React component analysis (regex + brace matching) ───────────────────────

const HOOK_RE = /\buse[A-Z]\w*\s*\(/g;
const USESTATE_BOOL_RE = /useState\s*<\s*boolean\s*>|useState\s*\(\s*(?:true|false)\s*[,\)]/g;
const INLINE_COMP_RE = /(?:^|\n)\s*(?:const|function)\s+([A-Z]\w*)\s*[=:(<]/g;
const USEEFFECT_DEPS_RE = /useEffect\s*\([\s\S]*?,\s*\[([^\]]*)\]\s*\)/g;

function analyzeReactComponents(src) {
  const code = stripCodeNoise(src);

  const defs = [];
  // function ComponentName(<args>) {
  for (const m of code.matchAll(
    /(?:^|\n)\s*(?:export\s+(?:default\s+)?)?function\s+([A-Z]\w*)\s*\(([^)]*)\)/g
  )) {
    defs.push({ name: m[1], paramStr: m[2], idx: m.index });
  }
  // const ComponentName = (...) =>
  for (const m of code.matchAll(
    /(?:^|\n)\s*(?:export\s+(?:default\s+)?)?const\s+([A-Z]\w*)\s*(?::\s*[^=]+)?=\s*\(([^)]*)\)\s*(?::\s*[^=]+)?=>/g
  )) {
    defs.push({ name: m[1], paramStr: m[2], idx: m.index });
  }
  // const ComponentName = memo|forwardRef(<...>)
  for (const m of code.matchAll(
    /(?:^|\n)\s*(?:export\s+(?:default\s+)?)?const\s+([A-Z]\w*)\s*=\s*(?:React\.)?(?:memo|forwardRef)\s*\(/g
  )) {
    defs.push({ name: m[1], paramStr: '', idx: m.index, wrapped: true });
  }

  const seen = new Set();
  const dedup = defs.filter((d) => {
    if (seen.has(d.name)) return false;
    seen.add(d.name);
    return true;
  });

  const components = [];
  for (const def of dedup) {
    const after = code.slice(def.idx);
    // Find first `{` at the function-body level (skip type annotations etc.)
    let openIdx = after.indexOf('{');
    if (openIdx === -1) continue;
    const closeIdx = findMatchingBrace(after, openIdx);
    if (closeIdx === -1) continue;
    const body = after.slice(openIdx, closeIdx + 1);

    // Props: look at paramStr first; for wrapped (memo/forwardRef) peek past `(`.
    let propStr = def.paramStr || '';
    if (def.wrapped) {
      const wrapBody = code.slice(def.idx, def.idx + 600);
      const m = wrapBody.match(/\(\s*\(([^)]*)\)/);
      if (m) propStr = m[1];
    }
    let propCount = 0;
    const destruct = propStr.match(/\{([^}]*)\}/);
    if (destruct) {
      propCount = destruct[1].split(',').filter((p) => p.trim().length > 0).length;
    } else if (propStr.trim() && /\bprops\b/.test(propStr)) {
      propCount = 1;
    }

    const hookCount = [...body.matchAll(HOOK_RE)].length;
    const booleanStates = [...body.matchAll(USESTATE_BOOL_RE)].length;
    const inlineComponents = [...body.matchAll(INLINE_COMP_RE)]
      .map((m) => m[1])
      .filter((n) => n !== def.name).length;
    const effects = [...body.matchAll(USEEFFECT_DEPS_RE)];
    const effectDepCounts = effects.map(
      (e) => e[1].split(',').filter((s) => s.trim().length > 0).length
    );
    const maxEffectDeps = effectDepCounts.length ? Math.max(...effectDepCounts) : 0;
    const lineCount = body.split('\n').length;

    components.push({
      name: def.name,
      propCount,
      hookCount,
      booleanStates,
      inlineComponents,
      maxEffectDeps,
      lineCount,
    });
  }

  // StyleSheet.create size
  let styleSheetSize = 0;
  const ssMatch = code.match(/StyleSheet\.create\s*\(\s*\{/);
  if (ssMatch) {
    const open = ssMatch.index + ssMatch[0].length - 1;
    const close = findMatchingBrace(code, open);
    if (close > open) styleSheetSize = code.slice(open, close + 1).split('\n').length;
  }

  return { components, styleSheetSize };
}

// ─── Identifier extraction (for vocab drift / concept locality) ──────────────

const JS_KEYWORDS = new Set([
  'var',
  'let',
  'const',
  'function',
  'if',
  'else',
  'return',
  'for',
  'while',
  'switch',
  'case',
  'break',
  'continue',
  'do',
  'try',
  'catch',
  'finally',
  'throw',
  'new',
  'this',
  'typeof',
  'instanceof',
  'in',
  'of',
  'class',
  'extends',
  'super',
  'import',
  'export',
  'from',
  'as',
  'default',
  'async',
  'await',
  'static',
  'public',
  'private',
  'protected',
  'readonly',
  'interface',
  'type',
  'enum',
  'namespace',
  'declare',
  'true',
  'false',
  'null',
  'undefined',
  'void',
  'any',
  'never',
  'unknown',
  'string',
  'number',
  'boolean',
  'object',
  'symbol',
  'yield',
  'with',
  'package',
  'implements',
  'abstract',
]);

function extractIdentifiers(src) {
  const code = stripCodeNoise(src);
  const set = new Set();
  for (const m of code.matchAll(/\b([A-Za-z_][A-Za-z0-9_]{2,})\b/g)) {
    const w = m[1];
    if (!JS_KEYWORDS.has(w)) set.add(w);
  }
  return set;
}

// ─── Pass-through detection ──────────────────────────────────────────────────

function detectPassThrough(src, exports) {
  if (!exports || exports.length === 0) return { isPassThrough: false, ratio: 0 };
  if (exports.every((e) => e.kind === 'reexport' || e.tag === 'reexport')) {
    return { isPassThrough: true, ratio: 1 };
  }
  const code = stripCodeNoise(src);
  let shortBodies = 0;
  let inspected = 0;
  for (const exp of exports) {
    if (exp.kind === 'type' || exp.kind === 'reexport') continue;
    inspected++;
    const namePat = exp.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(
      `(?:^|\\n)\\s*export\\s+(?:default\\s+)?(?:async\\s+)?(?:function\\s+|const\\s+|class\\s+|let\\s+|var\\s+)?${namePat}\\b`
    );
    const m = code.match(re);
    if (!m) continue;
    const idx = m.index + m[0].length;
    const after = code.slice(idx, idx + 800);
    const openBrace = after.indexOf('{');
    const arrowIdx = after.indexOf('=>');
    let body = '';
    if (openBrace !== -1 && (arrowIdx === -1 || openBrace < arrowIdx + 5)) {
      const close = findMatchingBrace(after, openBrace);
      if (close !== -1) body = after.slice(openBrace + 1, close);
    } else if (arrowIdx !== -1) {
      const semi = after.indexOf(';', arrowIdx);
      body = after.slice(arrowIdx + 2, semi === -1 ? arrowIdx + 200 : semi);
    } else {
      const semi = after.indexOf(';');
      body = after.slice(0, semi === -1 ? 200 : semi);
    }
    const codeLines = body.split('\n').filter((l) => l.trim().length > 0).length;
    if (codeLines > 0 && codeLines <= 3) shortBodies++;
  }
  if (inspected === 0) return { isPassThrough: false, ratio: 0 };
  const ratio = shortBodies / inspected;
  return { isPassThrough: ratio >= 0.7 && inspected >= 2, ratio };
}

// ─── Module depth (Ousterhout-style) ─────────────────────────────────────────

function computeModuleDepth(fileNode) {
  const exps = (fileNode.exports || []).filter(
    (e) => e.kind !== 'reexport' && e.tag !== 'reexport'
  );
  if (exps.length === 0) return null;
  // Surface weight: 1 per export (regex parse can't see real surface area).
  // Components add a bit more for each prop, types add for each member -- but
  // we don't have those here, so weight==exportCount is a fair approximation.
  const weight = exps.length;
  const impl = fileNode.loc?.code || 0;
  return {
    surface: weight,
    impl,
    depth: impl / weight,
    exportCount: exps.length,
  };
}

// ─── Test colocation helper ──────────────────────────────────────────────────

function hasColocatedTest(fileNode) {
  const fp = fileNode.fullPath;
  const dir = dirname(fp);
  const base = basename(fp).replace(/\.(tsx?|jsx?|mjs)$/, '');
  const candidates = [
    join(dir, `${base}.test.ts`),
    join(dir, `${base}.test.tsx`),
    join(dir, `${base}.test.js`),
    join(dir, `${base}.test.jsx`),
    join(dir, `${base}.spec.ts`),
    join(dir, `${base}.spec.tsx`),
    join(dir, '__tests__', `${base}.test.ts`),
    join(dir, '__tests__', `${base}.test.tsx`),
    join(dir, '__tests__', `${base}.test.js`),
    join(dir, '__tests__', `${base}.test.jsx`),
    // Repo-wide __tests__ folder
    join(ROOT, '__tests__', `${base}.test.ts`),
    join(ROOT, '__tests__', `${base}.test.tsx`),
    join(ROOT, '__tests__', `${base}.test.js`),
    join(ROOT, '__tests__', `${base}.test.jsx`),
  ];
  return candidates.some((c) => existsSync(c));
}

// ─── Export extraction ───────────────────────────────────────────────────────

function extractExports(src) {
  const results = [];
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*/g, '');
  const add = (kind, name, tag) => results.push({ kind, name, tag });

  for (const m of stripped.matchAll(/export\s+default\s+(?:async\s+)?function\s*\*?\s*(\w+)/g)) {
    add('default', m[1], classify(m[1], 'fn'));
  }
  for (const m of stripped.matchAll(/export\s+default\s+class\s+(\w+)/g)) {
    add('default', m[1], 'class');
  }
  for (const m of stripped.matchAll(/export\s+default\s+([\w.]+)\((\w+)\)\s*;?/g)) {
    add('default', `${m[1]}(${m[2]})`, classify(m[2], 'wrapped'));
  }
  for (const m of stripped.matchAll(/export\s+default\s+(?!function|class|async|new)(\w+)\s*;/g)) {
    if (!results.some((r) => r.kind === 'default' && r.name.endsWith(m[1] + ')'))) {
      add('default', m[1], classify(m[1], 'value'));
    }
  }

  for (const m of stripped.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)) {
    add('named', m[1], classify(m[1], 'fn'));
  }
  for (const m of stripped.matchAll(/^export\s+(?:const|let|var)\s+(\w+)/gm)) {
    const idx = m.index + m[0].length;
    const rest = stripped.slice(idx, idx + 120);
    const isArrowComponent =
      /=\s*(?:React\.memo\(|React\.forwardRef\(|\([\w,\s:={}[\]]*\)\s*(?::\s*\w[\w.<>|&, ]*?)?\s*=>)/.test(
        rest
      );
    add('named', m[1], classify(m[1], isArrowComponent ? 'fn' : 'const'));
  }
  for (const m of stripped.matchAll(/^export\s+class\s+(\w+)/gm)) {
    add('named', m[1], 'class');
  }

  if (!hideTypes) {
    for (const m of stripped.matchAll(/^export\s+type\s+(\w+)/gm)) {
      add('type', m[1], 'type');
    }
    for (const m of stripped.matchAll(/^export\s+interface\s+(\w+)/gm)) {
      add('type', m[1], 'interface');
    }
    // The brace form `export type { X }` (with or without `from '...'`) is
    // handled by the combined regex below — it dispatches to the right kind
    // (type/reexport) so we don't double-count.
  }

  for (const m of stripped.matchAll(
    /^export\s+(type\s+)?\{([^}]+)\}(\s+from\s+['"][^'"]+['"])?/gm
  )) {
    const isFromReexport = !!m[3];
    const isTypeOnly = !!m[1];
    for (const chunk of m[2].split(',')) {
      const parts = chunk.trim().split(/\s+as\s+/);
      const name = (parts[parts.length - 1] || '').trim().replace(/^type\s+/, '');
      if (name && /^\w+$/.test(name)) {
        // `export { Foo } from './x'` is a re-export, not a definition — mark
        // both kind AND tag so downstream dup-detection skips it. Without the
        // explicit kind, barrel files look like they define every name they
        // forward.
        if (isFromReexport) {
          add('reexport', name, 'reexport');
        } else if (isTypeOnly) {
          if (!hideTypes) add('type', name, 'type');
        } else {
          add('named', name, classify(name, 'reexport'));
        }
      }
    }
  }

  for (const m of stripped.matchAll(/^export\s+\*\s+from\s+['"]([^'"]+)['"]/gm)) {
    add('reexport', `* from '${m[1]}'`, 'reexport');
  }

  const seen = new Set();
  return results.filter((r) => {
    const key = `${r.kind}:${r.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Import extraction ───────────────────────────────────────────────────────

function extractImports(src) {
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/\/\/.*/g, '');

  const byModule = new Map();
  // `export ... from '...'` is a re-export edge, semantically identical to
  // `import + export` for graph-reachability purposes. Without it, every file
  // imported only via a barrel (`features/foo/index.ts: export { Bar } from './Bar'`)
  // looks orphaned. Tag the re-exports as `isType` only when they are
  // `export type ...` so we still know they are erased at runtime.
  const REEXPORT_NAMED = /^export\s+(type\s+)?\{([\s\S]*?)\}\s+from\s+['"]([^'"]+)['"]/gm;
  const REEXPORT_STAR = /^export\s+(type\s+)?\*\s+(?:as\s+\w+\s+)?from\s+['"]([^'"]+)['"]/gm;
  for (const m of stripped.matchAll(REEXPORT_NAMED)) {
    const isType = !!m[1];
    const namesRaw = m[2];
    const mod = m[3];
    const isExternal = !mod.startsWith('.') && !mod.startsWith('@/');
    if (!byModule.has(mod)) {
      byModule.set(mod, { module: mod, names: [], isType, isExternal, isReexport: true });
    }
    const entry = byModule.get(mod);
    entry.isReexport = true;
    for (const chunk of namesRaw.split(',')) {
      const parts = chunk.trim().split(/\s+as\s+/);
      // Take the SOURCE name (`Foo` in `Foo as Bar`) since the upstream file
      // exports that, not the re-exported alias. Strip a per-specifier `type`
      // keyword so `export { type Foo } from './x'` records `Foo`.
      const name = (parts[0] || '').trim().replace(/^type\s+/, '');
      if (name && /^\w+$/.test(name)) entry.names.push(name);
    }
  }
  for (const m of stripped.matchAll(REEXPORT_STAR)) {
    const isType = !!m[1];
    const mod = m[2];
    const isExternal = !mod.startsWith('.') && !mod.startsWith('@/');
    if (!byModule.has(mod)) {
      byModule.set(mod, { module: mod, names: [], isType, isExternal, isReexport: true });
    }
    byModule.get(mod).isReexport = true;
    byModule.get(mod).names.push('*');
  }

  const RE = /^import\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm;

  for (const m of stripped.matchAll(RE)) {
    const isType = !!m[1];
    const clause = m[2].replace(/\s+/g, ' ').trim();
    const mod = m[3];
    const isExternal = !mod.startsWith('.') && !mod.startsWith('@/');

    if (!byModule.has(mod)) {
      byModule.set(mod, { module: mod, names: [], isType, isExternal });
    }
    const entry = byModule.get(mod);
    if (isType) entry.isType = true;

    const starMatch = clause.match(/^\*\s+as\s+(\w+)$/);
    if (starMatch) {
      entry.names.push(`* as ${starMatch[1]}`);
      continue;
    }

    const braceOpen = clause.indexOf('{');
    const braceClose = clause.lastIndexOf('}');

    const beforeBrace = (braceOpen === -1 ? clause : clause.slice(0, braceOpen))
      .replace(/,\s*$/, '')
      .trim();

    if (beforeBrace) entry.names.push(beforeBrace);

    if (braceOpen !== -1 && braceClose !== -1) {
      const inside = clause.slice(braceOpen + 1, braceClose);
      for (const chunk of inside.split(',')) {
        const parts = chunk.trim().split(/\s+as\s+/);
        // For `Foo as Bar` we need the SOURCE name (`Foo`) — that's what the
        // exporting file actually exports. Take the LEFT side, not the right.
        // Strip a leading per-specifier `type` keyword so inline-type imports
        // like `import { type Foo, Bar }` resolve back to the bare name.
        // Otherwise the unused-export detector treats `type Foo` as a literal
        // identifier and reports `Foo` as never imported.
        const name = (parts[0] || '').trim().replace(/^type\s+/, '');
        if (name) entry.names.push(name);
      }
    }
  }

  // ── Dynamic imports & CommonJS require ──────────────────────────────────────
  // The static `import … from` / `export … from` forms above miss runtime-lazy
  // edges: `await import('…')`, `void import('…')`, and `require('…')`. A module
  // reached ONLY this way (a lazy route, a deferred side-effect import, or a
  // `require()` the bundler resolves) otherwise reports as a dead orphan, and a
  // symbol pulled only via `const { x } = await import('…')` reports as an unused
  // export. Record the module edge in every case, plus the destructured binding
  // names when the call site binds them. These are tagged `isDynamic` so they
  // feed fan-in (orphan detection) and imported-names (unused-export detection)
  // WITHOUT participating in static-coupling metrics — a lazy import is precisely
  // how a static cycle is broken, so it must not count as a cycle/fanout edge.
  const recordDynamic = (mod, namesRaw) => {
    const isExternal = !mod.startsWith('.') && !mod.startsWith('@/');
    if (!byModule.has(mod)) {
      byModule.set(mod, { module: mod, names: [], isExternal, isDynamic: true });
    }
    const entry = byModule.get(mod);
    if (!namesRaw) return;
    for (const chunk of namesRaw.split(',')) {
      const parts = chunk.trim().split(/\s+as\s+/);
      const name = (parts[0] || '').trim().replace(/^type\s+/, '');
      if (name && /^\w+$/.test(name)) entry.names.push(name);
    }
  };
  // `const { a, b } = await import('mod')` / `… = require('mod')` — names + edge.
  const DYNAMIC_DESTRUCTURE =
    /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:await\s+)?(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of stripped.matchAll(DYNAMIC_DESTRUCTURE)) recordDynamic(m[2], m[1]);
  // Any remaining `import('mod')` / `require('mod')` — side-effect or
  // member-accessed; edge only (bound names are not recoverable from the form).
  const DYNAMIC_BARE = /(?<![\w$.])(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of stripped.matchAll(DYNAMIC_BARE)) recordDynamic(m[1], null);

  return [...byModule.values()];
}

function classify(name, hint) {
  if (!name) return hint;
  if (name.startsWith('use') && /^use[A-Z]/.test(name)) return 'hook';
  if (/^[A-Z]/.test(name)) return 'component';
  if (hint === 'fn' || hint === 'wrapped') return hint;
  if (name === name.toUpperCase() && name.length > 1) return 'constant';
  return hint;
}

// ─── Formatting ───────────────────────────────────────────────────────────────

const ICONS = {
  component: '⚛',
  hook: 'ʰ',
  fn: 'ƒ',
  wrapped: '⚛',
  class: '◆',
  type: '⊤',
  interface: '⊤',
  const: '·',
  constant: '·',
  value: '·',
  reexport: '↗',
  default: '·',
};

const KIND_LABEL = {
  default: '[default]',
  named: '[export]',
  type: '[type]',
  reexport: '[re-export]',
};

function formatExport(exp) {
  const icon = ICONS[exp.tag] || '·';
  const label = KIND_LABEL[exp.kind] || '';
  return `${icon} ${exp.name} ${label}`.trimEnd();
}

function formatLoc(loc) {
  if (showLoc) {
    return `  \x1b[2mcode:${loc.code}  blank:${loc.blank}  comment:${loc.comment}  total:${loc.total}\x1b[0m`;
  }
  return `  \x1b[2m${loc.code} loc\x1b[0m`;
}

function formatImport(imp) {
  const MAX_NAMES = 6;
  const prefix = imp.isType ? '⊤ ' : '← ';
  const mod = imp.module;
  const names = imp.names;
  let nameStr;
  if (names.length === 0) nameStr = '(side-effect)';
  else if (names.length <= MAX_NAMES) nameStr = `{ ${names.join(', ')} }`;
  else nameStr = `{ ${names.slice(0, MAX_NAMES).join(', ')}, +${names.length - MAX_NAMES} more }`;
  return `${prefix}'${mod}'  ${nameStr}`;
}

// ─── Tree walker ──────────────────────────────────────────────────────────────

function walk(dirPath, prefix = '') {
  let entries;
  try {
    entries = readdirSync(dirPath).sort((a, b) => {
      const aDir = statSync(join(dirPath, a)).isDirectory();
      const bDir = statSync(join(dirPath, b)).isDirectory();
      if (aDir && !bDir) return -1;
      if (!aDir && bDir) return 1;
      return a.localeCompare(b);
    });
  } catch {
    return [];
  }

  const filtered = entries.filter((e) => {
    if (e.startsWith('.')) return false;
    if (IGNORE_DIRS.has(e)) return false;
    if (IGNORE_FILES.has(e)) return false;
    return true;
  });

  const nodes = [];

  filtered.forEach((entry, idx) => {
    const fullPath = join(dirPath, entry);
    const isLast = idx === filtered.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const childPfx = prefix + (isLast ? '    ' : '│   ');

    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      return;
    }

    if (stat.isDirectory()) {
      if (IGNORE_PATH_PATTERNS.some((re) => re.test(fullPath))) return;
      const children = walk(fullPath, childPfx);
      nodes.push({ type: 'dir', name: entry, connector, prefix, children });
    } else if (TS_EXTS.has(extname(entry))) {
      let exports = [];
      let imports = [];
      let loc = { total: 0, code: 0, blank: 0, comment: 0 };
      let metrics = null;
      let identifiers = null;
      try {
        const src = readFileSync(fullPath, 'utf8');
        exports = extractExports(src);
        imports = extractImports(src);
        loc = countLines(src);
        metrics = {
          complexity: computeComplexity(src),
          smells: countTypeSmells(src),
          react: analyzeReactComponents(src),
          passthrough: detectPassThrough(src, exports),
        };
        if (showVocabDrift || showConcept) {
          identifiers = extractIdentifiers(src);
        }
      } catch {
        /* skip unreadable */
      }

      nodes.push({
        type: 'file',
        name: entry,
        connector,
        prefix,
        childPfx,
        exports,
        imports,
        loc,
        metrics,
        identifiers,
        fullPath,
      });
    } else {
      nodes.push({ type: 'other', name: entry, connector, prefix });
    }
  });

  return nodes;
}

// ─── Render tree ──────────────────────────────────────────────────────────────

function renderTree(nodes) {
  const lines = [];
  for (const node of nodes) {
    if (node.type === 'dir') {
      lines.push(`${node.prefix}${node.connector}${node.name}/`);
      lines.push(...renderTree(node.children));
    } else if (node.type === 'file') {
      const locBadge = node.loc ? formatLoc(node.loc) : '';
      lines.push(`${node.prefix}${node.connector}${node.name}${locBadge}`);

      const imps = showImports
        ? (node.imports || []).filter((i) => !(hideExternal && i.isExternal))
        : [];
      const exps = node.exports.filter((e) => {
        if (hideSame && e.kind === 'named' && e.tag === 'reexport') return false;
        return true;
      });
      const all = [
        ...imps.map((i) => ({ _imp: true, i })),
        ...exps.map((e) => ({ _imp: false, e })),
      ];
      all.forEach(({ _imp, i, e }, idx) => {
        const last = idx === all.length - 1;
        const conn = last ? '└── ' : '├── ';
        const text = _imp ? formatImport(i) : formatExport(e);
        lines.push(`${node.childPfx}${conn}${text}`);
      });
    } else {
      lines.push(`${node.prefix}${node.connector}${node.name}`);
    }
  }
  return lines;
}

// ─── JSON tree projection ────────────────────────────────────────────────────

function toJson(nodes, dirPath) {
  return nodes.map((node) => {
    if (node.type === 'dir') {
      return {
        type: 'dir',
        name: node.name,
        children: toJson(node.children, join(dirPath, node.name)),
      };
    }
    if (node.type === 'file') {
      return {
        type: 'file',
        name: node.name,
        fullPath: node.fullPath,
        loc: node.loc || null,
        imports: node.imports || [],
        exports: node.exports,
        metrics: node.metrics
          ? {
              complexity: node.metrics.complexity,
              smells: node.metrics.smells,
              styleSheetSize: node.metrics.react?.styleSheetSize ?? 0,
              components: node.metrics.react?.components ?? [],
              passthrough: node.metrics.passthrough,
            }
          : null,
      };
    }
    return { type: 'other', name: node.name };
  });
}

// ─── Totals ───────────────────────────────────────────────────────────────────

function collectTotals(nodes) {
  const totals = { files: 0, code: 0, blank: 0, comment: 0, total: 0 };
  for (const node of nodes) {
    if (node.type === 'dir') {
      const sub = collectTotals(node.children);
      totals.files += sub.files;
      totals.code += sub.code;
      totals.blank += sub.blank;
      totals.comment += sub.comment;
      totals.total += sub.total;
    } else if (node.type === 'file' && node.loc) {
      totals.files++;
      totals.code += node.loc.code;
      totals.blank += node.loc.blank;
      totals.comment += node.loc.comment;
      totals.total += node.loc.total;
    }
  }
  return totals;
}

function renderSummary(totals) {
  const w = (n) => String(n).padStart(6);
  return [
    '',
    '\x1b[2m─────────────────────────────────────────\x1b[0m',
    `\x1b[1m  Files   \x1b[0m\x1b[2m${w(totals.files)}\x1b[0m`,
    `\x1b[1m  Code    \x1b[0m\x1b[32m${w(totals.code)}\x1b[0m`,
    `\x1b[1m  Blank   \x1b[0m\x1b[2m${w(totals.blank)}\x1b[0m`,
    `\x1b[1m  Comment \x1b[0m\x1b[2m${w(totals.comment)}\x1b[0m`,
    `\x1b[1m  Total   \x1b[0m\x1b[2m${w(totals.total)}\x1b[0m`,
    '\x1b[2m─────────────────────────────────────────\x1b[0m',
  ].join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEPENDENCY GRAPH
// ═══════════════════════════════════════════════════════════════════════════════

function collectAllFiles(nodes, result = []) {
  for (const node of nodes) {
    if (node.type === 'dir') {
      collectAllFiles(node.children, result);
    } else if (node.type === 'file' && node.fullPath) {
      result.push(node);
    }
  }
  return result;
}

function getTopFolder(relPath, depth = 1) {
  const parts = relPath.split('/').filter(Boolean);
  if (parts.length <= depth) return parts.slice(0, -1).join('/') || '(root)';
  return parts.slice(0, depth).join('/');
}

function isReexportLike(exp) {
  return exp?.tag === 'reexport' || exp?.kind === 'reexport' || exp?.kind === 'type';
}

function isLikelyBarrelFile(fileNode) {
  if (!fileNode || !/^index\.[jt]sx?$/.test(fileNode.name)) return false;
  return (fileNode.exports || []).length > 0;
}

function isThinReExportProxy(fileNode) {
  // A few-LOC file whose only export is an alias of something it imported —
  // typically the Expo Router pattern: `import { Screen } from '@/features/x';`
  // followed by `export default Screen;`. Counting these as duplicate
  // definitions of `Screen` is a false positive — the name has one source of
  // truth and the proxy file is a routing alias.
  if (!fileNode) return false;
  const code = fileNode.loc?.code || 0;
  if (code === 0 || code > 5) return false;
  const exports = fileNode.exports || [];
  if (exports.length === 0) return false;
  const importedNames = new Set();
  for (const imp of fileNode.imports || []) {
    for (const n of imp.names || []) {
      if (n.startsWith('* as ')) importedNames.add(n.slice(5));
      else importedNames.add(n);
    }
  }
  // Every export's name (or its `<name>(arg)` wrapper form) must trace back to
  // an imported binding for the file to qualify as a pure proxy.
  return exports.every((e) => {
    const baseName = e.name.split('(')[0];
    return importedNames.has(baseName) || importedNames.has(e.name);
  });
}

function isLikelyCompatibilitySurface(fileNode) {
  if (!fileNode) return false;
  const exports = fileNode.exports || [];
  if (exports.length === 0) return false;
  if (isLikelyBarrelFile(fileNode)) return true;
  return (fileNode.loc?.code || 0) <= 20 && (fileNode.imports || []).length === 0;
}

function buildDependencyGraph(allFiles) {
  const pathToNode = new Map();
  for (const f of allFiles) pathToNode.set(f.fullPath, f);

  // resolvedTarget → [ { importer: resolvedSourcePath, names: [...] } ]
  const faninMap = new Map();
  // edges: { source, target, names: [...] }
  const edges = [];
  const fileToFolder = new Map();
  // For unused-export tracking: per-target file, the set of imported names.
  const importedNamesByTarget = new Map();
  // For each source file, the resolved targets (used for fanout, reach)
  const fanoutMap = new Map();

  for (const f of allFiles) {
    const relPath = relative(targetDir, f.fullPath);
    fileToFolder.set(f.fullPath, getTopFolder(relPath, couplingDepth));

    for (const imp of f.imports || []) {
      if (imp.isExternal) continue;
      const resolved = resolveImport(imp.module, f.fullPath);
      if (!resolved) continue;

      if (!fileToFolder.has(resolved)) {
        fileToFolder.set(resolved, getTopFolder(relative(targetDir, resolved), couplingDepth));
      }

      if (!faninMap.has(resolved)) faninMap.set(resolved, []);
      faninMap.get(resolved).push({
        importer: f.fullPath,
        names: imp.names,
        isReexport: !!imp.isReexport,
        isDynamic: !!imp.isDynamic,
      });

      // Re-exports inflate fanout for barrels (`features/foo/index.ts` re-exports
      // from every screen in the folder). Counting them makes every barrel look
      // like a hub-spoke god module. Keep fanout to value-imports only. Dynamic
      // edges are excluded too — a lazy import is deferred, not a static
      // dependency, so it must not inflate fanout/reach or forge a cycle.
      if (!imp.isReexport && !imp.isDynamic) {
        if (!fanoutMap.has(f.fullPath)) fanoutMap.set(f.fullPath, new Set());
        fanoutMap.get(f.fullPath).add(resolved);
      }

      if (!importedNamesByTarget.has(resolved)) importedNamesByTarget.set(resolved, new Set());
      const set = importedNamesByTarget.get(resolved);
      for (const n of imp.names) {
        // strip "* as X" → '*'
        if (n.startsWith('* as ')) set.add('*');
        else set.add(n);
      }

      // Dynamic edges stay out of edges[] entirely: cycles, instability, and
      // importer-reach are all static-coupling views and a deferred import is
      // not static coupling. fan-in and imported-names (above) already carry it.
      if (!imp.isDynamic) {
        edges.push({
          source: f.fullPath,
          target: resolved,
          names: imp.names,
          isReexport: !!imp.isReexport,
        });
      }
    }
  }

  // Metro resolves `import './Foo'` to whichever of `Foo.ios.tsx` / `Foo.android.tsx`
  // / `Foo.tsx` it picks per-platform — and a `.types.ts` companion is part of the
  // same logical module. The static resolver above only finds one variant, so the
  // siblings look orphaned. Propagate fan-in / imported-names across `(dir, strippedBase)`
  // groups so all platform/companion variants share the membership of the import that
  // hit any one of them.
  propagatePlatformSiblings({
    allFiles,
    faninMap,
    fanoutMap,
    importedNamesByTarget,
  });

  return { faninMap, fanoutMap, edges, fileToFolder, pathToNode, importedNamesByTarget };
}

function propagatePlatformSiblings({ allFiles, faninMap, fanoutMap, importedNamesByTarget }) {
  // Group files by `dirname + strippedBase` (the latter folds `.ios`/`.android`/
  // `.native`/`.web`/`.types`/`.styles`/`.constants` and the file extension).
  const groups = new Map();
  for (const f of allFiles) {
    const key = `${dirname(f.fullPath)} ${strippedBase(f.name)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f.fullPath);
  }

  for (const paths of groups.values()) {
    if (paths.length < 2) continue;

    // Union the inbound importers across all variants, dedup by importer path.
    const seenImporter = new Map(); // importer → names[]
    for (const p of paths) {
      const fans = faninMap.get(p);
      if (!fans) continue;
      for (const entry of fans) {
        if (!seenImporter.has(entry.importer)) {
          seenImporter.set(entry.importer, [...entry.names]);
        }
      }
    }
    if (seenImporter.size === 0) continue;
    const unionFans = [...seenImporter.entries()].map(([importer, names]) => ({
      importer,
      names,
    }));

    // Union the imported-name sets across all variants.
    const unionNames = new Set();
    for (const p of paths) {
      const s = importedNamesByTarget.get(p);
      if (s) for (const n of s) unionNames.add(n);
    }

    // Stamp the union back onto every variant so each appears imported in
    // orphan / fan-in / unused-export passes.
    for (const p of paths) {
      faninMap.set(p, unionFans.slice());
      if (unionNames.size > 0) {
        if (!importedNamesByTarget.has(p)) importedNamesByTarget.set(p, new Set());
        const tgt = importedNamesByTarget.get(p);
        for (const n of unionNames) tgt.add(n);
      }
    }

    // Mirror on the importer side so fanout includes all sibling targets — keeps
    // hub-spoke / coupling counts consistent with what Metro would actually link.
    for (const importer of seenImporter.keys()) {
      const out = fanoutMap.get(importer);
      if (!out) continue;
      for (const p of paths) out.add(p);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXISTING REPORT RENDERERS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 1. Fan-in ───────────────────────────────────────────────────────────────

function renderFanin(faninMap, fileToFolder) {
  const lines = [];
  lines.push('');
  lines.push('\x1b[1;36m══ Fan-in: Reverse Dependency Ranking ══\x1b[0m');
  lines.push('\x1b[2mFiles ranked by number of internal importers (who imports this file?)\x1b[0m');
  lines.push('');

  const entries = [...faninMap.entries()]
    .map(([file, importers]) => ({
      file: relative(targetDir, file),
      importers: importers.map((i) => relative(targetDir, i.importer)),
      count: importers.length,
      folders: [...new Set(importers.map((i) => fileToFolder.get(i.importer) || '?'))],
    }))
    .filter((e) => e.count >= faninMin)
    .sort((a, b) => b.count - a.count);

  if (entries.length === 0) {
    lines.push('  (no files with fan-in >= ' + faninMin + ')');
    return lines;
  }

  const maxCount = entries[0].count;
  const countWidth = String(maxCount).length;

  for (const e of entries) {
    const bar = '█'.repeat(Math.min(e.count, 40));
    const folderTag =
      e.folders.length === 1
        ? `\x1b[2m(only from ${e.folders[0]})\x1b[0m`
        : `\x1b[33m(${e.folders.length} folders: ${e.folders.join(', ')})\x1b[0m`;

    lines.push(
      `  \x1b[1m${String(e.count).padStart(countWidth)}\x1b[0m  \x1b[32m${bar}\x1b[0m  ${e.file}  ${folderTag}`
    );
  }

  lines.push('');
  lines.push(`\x1b[2m  ${entries.length} files shown (min fan-in: ${faninMin})\x1b[0m`);
  return lines;
}

// ─── 2. Coupling matrix ──────────────────────────────────────────────────────

function renderCoupling(edges, fileToFolder) {
  const lines = [];
  lines.push('');
  lines.push('\x1b[1;36m══ Coupling: Inter-Folder Dependency Matrix ══\x1b[0m');
  lines.push(
    `\x1b[2mCross-boundary import counts (folder depth: ${couplingDepth}). Read as: row → imports from → column\x1b[0m`
  );
  lines.push('');

  const matrix = new Map();
  const allFolders = new Set();
  for (const { source, target } of edges) {
    const sf = fileToFolder.get(source) || '?';
    const tf = fileToFolder.get(target) || '?';
    if (sf === tf) continue;
    allFolders.add(sf);
    allFolders.add(tf);
    if (!matrix.has(sf)) matrix.set(sf, new Map());
    const row = matrix.get(sf);
    row.set(tf, (row.get(tf) || 0) + 1);
  }

  const folders = [...allFolders].sort();
  if (folders.length === 0) {
    lines.push('  (no cross-folder imports detected)');
    return lines;
  }

  const maxNameLen = Math.max(...folders.map((f) => f.length), 6);
  const colWidth = Math.max(...folders.map((f) => f.length), 4);

  const header =
    ' '.repeat(maxNameLen + 2) +
    folders.map((f) => f.slice(0, colWidth).padStart(colWidth)).join('  ');
  lines.push(`  \x1b[2m${header}\x1b[0m`);

  for (const sf of folders) {
    const row = matrix.get(sf) || new Map();
    const cells = folders.map((tf) => {
      if (sf === tf) return '\x1b[2m-\x1b[0m'.padStart(colWidth + 6);
      const count = row.get(tf) || 0;
      if (count === 0) return '\x1b[2m·\x1b[0m'.padStart(colWidth + 6);
      if (count >= 20) return `\x1b[31m${String(count).padStart(colWidth)}\x1b[0m`;
      if (count >= 10) return `\x1b[33m${String(count).padStart(colWidth)}\x1b[0m`;
      return String(count).padStart(colWidth);
    });
    lines.push(`  \x1b[1m${sf.padEnd(maxNameLen)}\x1b[0m  ${cells.join('  ')}`);
  }
  return lines;
}

// ─── 3. Cycles ───────────────────────────────────────────────────────────────

function detectCycles(edges) {
  // Re-export edges (`export { X } from './X'`) form barrel↔leaf "cycles" that
  // are idiomatic in any module organised around an `index.ts`: the leaf
  // imports a sibling type from the barrel, the barrel re-exports the leaf.
  // These are not architectural cycles in the runtime sense — the re-export
  // path is name-only and erases under bundlers — so excluding them keeps
  // `detectCycles` focused on real value-import cycles.
  const adj = new Map();
  const allNodes = new Set();
  for (const { source, target, isReexport } of edges) {
    if (isReexport) continue;
    allNodes.add(source);
    allNodes.add(target);
    if (!adj.has(source)) adj.set(source, []);
    adj.get(source).push(target);
  }

  let index = 0;
  const stack = [];
  const onStack = new Set();
  const indices = new Map();
  const lowlinks = new Map();
  const sccs = [];

  // Iterative Tarjan to avoid recursion limits on big graphs.
  function strongconnect(start) {
    const work = [{ v: start, ai: 0 }];
    indices.set(start, index);
    lowlinks.set(start, index);
    index++;
    stack.push(start);
    onStack.add(start);

    while (work.length) {
      const frame = work[work.length - 1];
      const v = frame.v;
      const succ = adj.get(v) || [];
      if (frame.ai < succ.length) {
        const w = succ[frame.ai++];
        if (!indices.has(w)) {
          indices.set(w, index);
          lowlinks.set(w, index);
          index++;
          stack.push(w);
          onStack.add(w);
          work.push({ v: w, ai: 0 });
        } else if (onStack.has(w)) {
          lowlinks.set(v, Math.min(lowlinks.get(v), indices.get(w)));
        }
      } else {
        if (lowlinks.get(v) === indices.get(v)) {
          const scc = [];
          let w;
          do {
            w = stack.pop();
            onStack.delete(w);
            scc.push(w);
          } while (w !== v);
          if (scc.length > 1) sccs.push(scc);
        }
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1].v;
          lowlinks.set(parent, Math.min(lowlinks.get(parent), lowlinks.get(v)));
        }
      }
    }
  }

  for (const node of allNodes) {
    if (!indices.has(node)) strongconnect(node);
  }
  return sccs;
}

function renderCycles(edges) {
  const lines = [];
  lines.push('');
  lines.push('\x1b[1;36m══ Cycles: Circular Import Detection ══\x1b[0m');
  lines.push(
    '\x1b[2mStrongly connected components in the import graph (files that import each other)\x1b[0m'
  );
  lines.push('');

  const sccs = detectCycles(edges);
  if (sccs.length === 0) {
    lines.push('  \x1b[32m✓ No circular imports detected!\x1b[0m');
    return lines;
  }

  lines.push(`  \x1b[31m✗ Found ${sccs.length} cycle(s):\x1b[0m`);
  lines.push('');
  for (let i = 0; i < sccs.length; i++) {
    const scc = sccs[i];
    lines.push(`  \x1b[1mCycle ${i + 1}\x1b[0m (${scc.length} files):`);
    for (const file of scc) lines.push(`    → ${relative(targetDir, file)}`);
    lines.push('');
  }
  return lines;
}

// ─── 4. Orphans ──────────────────────────────────────────────────────────────

function renderOrphans(allFiles, faninMap) {
  const lines = [];
  lines.push('');
  lines.push('\x1b[1;36m══ Orphans: Files Never Imported ══\x1b[0m');
  lines.push(
    '\x1b[2mFiles with zero inbound edges, separated into likely dead code vs expected entry/barrel surfaces\x1b[0m'
  );
  lines.push('');

  const importedPaths = new Set(faninMap.keys());

  const orphans = allFiles
    .filter((f) => !importedPaths.has(f.fullPath))
    .map((f) => {
      const rel = relative(targetDir, f.fullPath);
      const isEntryPoint = /^app[/\\]/.test(rel);
      return {
        file: rel,
        isEntryPoint,
        isBarrel: isLikelyBarrelFile(f),
        isCompatibilitySurface: isLikelyCompatibilitySurface(f),
        loc: f.loc?.code || 0,
      };
    })
    .sort((a, b) => {
      const aRank = a.isEntryPoint ? 2 : a.isBarrel || a.isCompatibilitySurface ? 1 : 0;
      const bRank = b.isEntryPoint ? 2 : b.isBarrel || b.isCompatibilitySurface ? 1 : 0;
      if (aRank !== bRank) return aRank - bRank;
      return b.loc - a.loc;
    });

  if (orphans.length === 0) {
    lines.push('  \x1b[32m✓ No orphan files found!\x1b[0m');
    return lines;
  }

  const nonEntry = orphans.filter(
    (o) => !o.isEntryPoint && !o.isBarrel && !o.isCompatibilitySurface
  );
  const barrels = orphans.filter(
    (o) => !o.isEntryPoint && (o.isBarrel || o.isCompatibilitySurface)
  );
  const entryPoints = orphans.filter((o) => o.isEntryPoint);

  if (nonEntry.length > 0) {
    lines.push(`  \x1b[33mPotentially dead code (${nonEntry.length} files):\x1b[0m`);
    for (const o of nonEntry) {
      lines.push(`    \x1b[2m${String(o.loc).padStart(5)} loc\x1b[0m  ${o.file}`);
    }
    lines.push('');
  }
  if (barrels.length > 0) {
    lines.push(
      `  \x1b[2mExpected public barrels / compatibility surfaces (${barrels.length} files):\x1b[0m`
    );
    for (const o of barrels) {
      lines.push(`    \x1b[2m${String(o.loc).padStart(5)} loc  ${o.file}\x1b[0m`);
    }
    lines.push('');
  }
  if (entryPoints.length > 0) {
    lines.push(`  \x1b[2mEntry points (${entryPoints.length} app/ route files — expected):\x1b[0m`);
    for (const o of entryPoints) {
      lines.push(`    \x1b[2m${String(o.loc).padStart(5)} loc  ${o.file}\x1b[0m`);
    }
  }
  return lines;
}

// ─── 5. Colocate ─────────────────────────────────────────────────────────────

function renderColocate(faninMap, fileToFolder, pathToNode) {
  const lines = [];
  lines.push('');
  lines.push('\x1b[1;36m══ Colocate: Suggested File Moves ══\x1b[0m');
  lines.push(
    `\x1b[2mFiles where ≥${Math.round(colocateThreshold * 100)}% of importers live in a single folder (and ≥2 importers)\x1b[0m`
  );
  lines.push('');

  const suggestions = [];
  for (const [file, importers] of faninMap) {
    if (importers.length < 2) continue;
    const fileNode = pathToNode.get(file);
    if (isLikelyBarrelFile(fileNode) || isLikelyCompatibilitySurface(fileNode)) continue;

    const currentFolder = fileToFolder.get(file) || '?';
    const folderCounts = {};
    for (const imp of importers) {
      const folder = fileToFolder.get(imp.importer) || 'unknown';
      folderCounts[folder] = (folderCounts[folder] || 0) + 1;
    }
    const sorted = Object.entries(folderCounts).sort((a, b) => b[1] - a[1]);
    const [topFolder, topCount] = sorted[0] || [];
    const total = importers.length;

    if (topCount / total >= colocateThreshold && topFolder !== currentFolder) {
      suggestions.push({
        file: relative(targetDir, file),
        currentFolder,
        suggestedFolder: topFolder,
        importerCount: total,
        topCount,
        pct: Math.round((topCount / total) * 100),
      });
    }
  }

  suggestions.sort((a, b) => b.importerCount - a.importerCount);

  if (suggestions.length === 0) {
    lines.push('  \x1b[32m✓ All files appear well-colocated!\x1b[0m');
    return lines;
  }

  for (const s of suggestions) {
    lines.push(`  \x1b[33mMOVE?\x1b[0m  ${s.file}`);
    lines.push(`         \x1b[2mcurrently in:\x1b[0m ${s.currentFolder}`);
    lines.push(
      `         \x1b[2m→ move to:\x1b[0m   \x1b[1m${s.suggestedFolder}\x1b[0m  (${s.topCount}/${s.importerCount} importers = ${s.pct}%)`
    );
    lines.push('');
  }
  lines.push(`\x1b[2m  ${suggestions.length} move suggestion(s)\x1b[0m`);
  return lines;
}

// ─── 6. Boundary ─────────────────────────────────────────────────────────────

function renderBoundary(edges, folderA, folderB) {
  const lines = [];
  lines.push('');
  lines.push(`\x1b[1;36m══ Boundary: Cross-Boundary Import Report ══\x1b[0m`);
  lines.push(`\x1b[2mImports crossing between "${folderA}" and "${folderB}"\x1b[0m`);
  lines.push('');

  const absA = resolve(targetDir, folderA);
  const absB = resolve(targetDir, folderB);
  const isInFolder = (filePath, absFolder) =>
    filePath.startsWith(absFolder + '/') || filePath === absFolder;

  const aToB = [];
  const bToA = [];
  for (const { source, target } of edges) {
    if (isInFolder(source, absA) && isInFolder(target, absB)) {
      aToB.push({ from: relative(targetDir, source), to: relative(targetDir, target) });
    }
    if (isInFolder(source, absB) && isInFolder(target, absA)) {
      bToA.push({ from: relative(targetDir, source), to: relative(targetDir, target) });
    }
  }

  if (aToB.length === 0 && bToA.length === 0) {
    lines.push(`  \x1b[32m✓ Clean boundary! No imports cross between these folders.\x1b[0m`);
    return lines;
  }
  if (aToB.length > 0) {
    lines.push(`  \x1b[1m${folderA} → ${folderB}\x1b[0m  (${aToB.length} imports):`);
    for (const e of aToB) lines.push(`    ${e.from}  →  ${e.to}`);
    lines.push('');
  }
  if (bToA.length > 0) {
    lines.push(`  \x1b[1m${folderB} → ${folderA}\x1b[0m  (${bToA.length} imports):`);
    for (const e of bToA) lines.push(`    ${e.from}  →  ${e.to}`);
    lines.push('');
  }
  const total = aToB.length + bToA.length;
  lines.push(`\x1b[2m  ${total} total cross-boundary import(s)\x1b[0m`);
  return lines;
}

// ═══════════════════════════════════════════════════════════════════════════════
// NEW REPORT RENDERERS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Shallow modules (Ousterhout depth) ──────────────────────────────────────

function buildSiblingGroupSet(allFiles) {
  // Set of fullPaths that share a `(dirname, strippedBase)` key with another
  // file — i.e. they are one variant of a multi-file logical module. Used to
  // suppress false "shallow / pass-through" flags on `.types.ts` companions
  // and platform-split siblings: those files are facets of a single module,
  // not standalone modules with their own depth/coupling story.
  const groups = new Map();
  for (const f of allFiles) {
    const key = `${dirname(f.fullPath)} ${strippedBase(f.name)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f.fullPath);
  }
  const out = new Set();
  for (const paths of groups.values()) {
    if (paths.length >= 2) for (const p of paths) out.add(p);
  }
  return out;
}

function computeShallow(allFiles) {
  const siblings = buildSiblingGroupSet(allFiles);
  const rows = [];
  for (const f of allFiles) {
    if (isLikelyBarrelFile(f)) continue; // barrels are known-shallow on purpose
    if (siblings.has(f.fullPath)) continue; // companion of a sibling — not standalone
    const d = computeModuleDepth(f);
    if (!d) continue;
    if (d.exportCount < shallowMinExports) continue;
    if (d.depth >= shallowMaxDepth) continue;
    rows.push({
      file: relative(targetDir, f.fullPath),
      depth: +d.depth.toFixed(1),
      exports: d.exportCount,
      code: d.impl,
    });
  }
  rows.sort((a, b) => a.depth - b.depth);
  return rows;
}

function renderShallow(allFiles) {
  const lines = [];
  lines.push('');
  lines.push('\x1b[1;36m══ Shallow Modules: Surface vs Depth ══\x1b[0m');
  lines.push(
    `\x1b[2mFiles with ≥${shallowMinExports} exports and depth (LOC/exports) below ${shallowMaxDepth}\x1b[0m`
  );
  lines.push('');

  const rows = computeShallow(allFiles);
  if (rows.length === 0) {
    lines.push('  \x1b[32m✓ No shallow modules detected.\x1b[0m');
    return lines;
  }
  for (const r of rows) {
    lines.push(
      `  \x1b[33mdepth ${String(r.depth).padStart(5)}\x1b[0m  exports:${String(r.exports).padStart(2)}  code:${String(r.code).padStart(4)}  ${r.file}`
    );
  }
  lines.push('');
  lines.push(`\x1b[2m  ${rows.length} shallow file(s)\x1b[0m`);
  return lines;
}

// ─── Pass-through suspects ───────────────────────────────────────────────────

function computePassThrough(allFiles, faninMap, fanoutMap) {
  const siblings = buildSiblingGroupSet(allFiles);
  const rows = [];
  for (const f of allFiles) {
    if (!f.metrics?.passthrough) continue;
    if (!f.metrics.passthrough.isPassThrough) continue;
    if (isLikelyBarrelFile(f)) continue; // already understood as barrel
    if (siblings.has(f.fullPath)) continue; // companion of a sibling — not standalone
    // Re-export edges don't make a file a pass-through — barrels routinely
    // re-export every leaf, so counting that fanin here would flag every
    // small leaf with `isPassThrough` as a pass-through suspect.
    const fanin = (faninMap.get(f.fullPath) || []).filter((e) => !e.isReexport && !e.isDynamic)
      .length;
    const fanout = fanoutMap.get(f.fullPath)?.size || 0;
    if (fanin === 0) continue; // also an orphan — covered by the Orphans report
    rows.push({
      file: relative(targetDir, f.fullPath),
      ratio: +f.metrics.passthrough.ratio.toFixed(2),
      exports: (f.exports || []).length,
      code: f.loc?.code || 0,
      fanin,
      fanout,
    });
  }
  rows.sort((a, b) => b.ratio - a.ratio);
  return rows;
}

function renderPassThrough(allFiles, faninMap, fanoutMap) {
  const lines = [];
  lines.push('');
  lines.push('\x1b[1;36m══ Pass-through / Middle-Man Suspects ══\x1b[0m');
  lines.push(
    '\x1b[2mFiles whose exports are mostly 1–3 line bodies — usually shallow wrappers.\x1b[0m'
  );
  lines.push('');

  const rows = computePassThrough(allFiles, faninMap, fanoutMap);
  if (rows.length === 0) {
    lines.push('  \x1b[32m✓ No pass-through suspects.\x1b[0m');
    return lines;
  }
  for (const r of rows) {
    lines.push(
      `  \x1b[33mratio ${r.ratio.toFixed(2)}\x1b[0m  exports:${String(r.exports).padStart(2)}  code:${String(r.code).padStart(4)}  fanin:${String(r.fanin).padStart(3)}  fanout:${String(r.fanout).padStart(3)}  ${r.file}`
    );
  }
  return lines;
}

// ─── Cognitive complexity hotspots ───────────────────────────────────────────

function computeComplexityHotspots(allFiles) {
  return allFiles
    .filter((f) => f.metrics?.complexity)
    .map((f) => ({
      file: relative(targetDir, f.fullPath),
      cognitive: f.metrics.complexity.cognitive,
      cyclomatic: f.metrics.complexity.cyclomatic,
      nesting: f.metrics.complexity.nestingMax,
      code: f.loc?.code || 0,
    }))
    .filter((r) => r.cognitive >= complexityThreshold)
    .sort((a, b) => b.cognitive - a.cognitive);
}

function renderComplexity(allFiles) {
  const lines = [];
  lines.push('');
  lines.push('\x1b[1;36m══ Cognitive Complexity Hotspots ══\x1b[0m');
  lines.push(
    `\x1b[2mFiles with cognitive complexity ≥ ${complexityThreshold} (control flow + nesting + boolean ops).\x1b[0m`
  );
  lines.push('');

  const rows = computeComplexityHotspots(allFiles);
  if (rows.length === 0) {
    lines.push('  \x1b[32m✓ No files exceed the complexity threshold.\x1b[0m');
    return lines;
  }
  for (const r of rows.slice(0, 50)) {
    const tag =
      r.cognitive >= complexityThreshold * 3
        ? '\x1b[31m'
        : r.cognitive >= complexityThreshold * 2
          ? '\x1b[33m'
          : '';
    lines.push(
      `  ${tag}cog:${String(r.cognitive).padStart(4)}\x1b[0m  cyc:${String(r.cyclomatic).padStart(3)}  nest:${String(r.nesting).padStart(2)}  code:${String(r.code).padStart(4)}  ${r.file}`
    );
  }
  if (rows.length > 50) lines.push(`\x1b[2m  …and ${rows.length - 50} more\x1b[0m`);
  return lines;
}

// ─── Type-safety smells ──────────────────────────────────────────────────────

function computeTypesafety(allFiles) {
  return allFiles
    .filter((f) => f.metrics?.smells)
    .map((f) => {
      const s = f.metrics.smells;
      const score = s.any * 3 + s.bangs * 2 + s.casts + s.tsIgnore * 4;
      return {
        file: relative(targetDir, f.fullPath),
        any: s.any,
        bangs: s.bangs,
        casts: s.casts,
        tsIgnore: s.tsIgnore,
        score,
        code: f.loc?.code || 0,
      };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

function renderTypesafety(allFiles) {
  const lines = [];
  lines.push('');
  lines.push('\x1b[1;36m══ Type-Safety Smells ══\x1b[0m');
  lines.push(
    `\x1b[2manyN, !N (non-null assertions), asN (type assertions), tsN (@ts-ignore/expect-error). Score = 3·any + 2·! + as + 4·ts.\x1b[0m`
  );
  lines.push('');

  const rows = computeTypesafety(allFiles);
  if (rows.length === 0) {
    lines.push('  \x1b[32m✓ No type-safety smells detected.\x1b[0m');
    return lines;
  }
  for (const r of rows.slice(0, 50)) {
    const heavy = r.score > 30 ? '\x1b[31m' : r.score > 15 ? '\x1b[33m' : '';
    lines.push(
      `  ${heavy}score:${String(r.score).padStart(4)}\x1b[0m  any:${String(r.any).padStart(3)}  !:${String(r.bangs).padStart(3)}  as:${String(r.casts).padStart(3)}  ts:${String(r.tsIgnore).padStart(2)}  ${r.file}`
    );
  }
  if (rows.length > 50) lines.push(`\x1b[2m  …and ${rows.length - 50} more\x1b[0m`);
  return lines;
}

// ─── Component smells ────────────────────────────────────────────────────────

function computeComponentSmells(allFiles) {
  const rows = [];
  for (const f of allFiles) {
    const comps = f.metrics?.react?.components || [];
    const styleSheetSize = f.metrics?.react?.styleSheetSize || 0;
    for (const c of comps) {
      const flags = [];
      if (c.lineCount >= componentLineThreshold) flags.push(`large(${c.lineCount}L)`);
      if (c.hookCount > hookMaxThreshold) flags.push(`hooks(${c.hookCount})`);
      if (c.propCount > propMaxThreshold) flags.push(`props(${c.propCount})`);
      if (c.booleanStates >= 3) flags.push(`bool-state(${c.booleanStates})`);
      if (c.inlineComponents > 0) flags.push(`inline-subcomp(${c.inlineComponents})`);
      if (c.maxEffectDeps >= 5) flags.push(`effect-deps(${c.maxEffectDeps})`);
      if (flags.length === 0) continue;
      rows.push({
        file: relative(targetDir, f.fullPath),
        component: c.name,
        ...c,
        flags,
        styleSheetSize,
      });
    }
    if (styleSheetSize >= 200) {
      rows.push({
        file: relative(targetDir, f.fullPath),
        component: '(file-level)',
        propCount: 0,
        hookCount: 0,
        booleanStates: 0,
        inlineComponents: 0,
        maxEffectDeps: 0,
        lineCount: 0,
        flags: [`stylesheet(${styleSheetSize}L)`],
        styleSheetSize,
      });
    }
  }
  // Sort by "weight" of issues
  const weight = (r) => r.flags.length * 100 + r.lineCount + r.hookCount * 10;
  rows.sort((a, b) => weight(b) - weight(a));
  return rows;
}

function renderComponent(allFiles) {
  const lines = [];
  lines.push('');
  lines.push('\x1b[1;36m══ React Component Smells ══\x1b[0m');
  lines.push(
    `\x1b[2mLarge (≥${componentLineThreshold}L) / hooks(>${hookMaxThreshold}) / props(>${propMaxThreshold}) / boolean-state ≥3 / inline subcomponents / effect-deps ≥5 / stylesheet ≥200L.\x1b[0m`
  );
  lines.push('');

  const rows = computeComponentSmells(allFiles);
  if (rows.length === 0) {
    lines.push('  \x1b[32m✓ No component smells detected.\x1b[0m');
    return lines;
  }
  for (const r of rows.slice(0, 60)) {
    const flagStr = r.flags.join(' ');
    lines.push(`  \x1b[33m${r.component}\x1b[0m  \x1b[2m${flagStr}\x1b[0m  ${r.file}`);
  }
  if (rows.length > 60) lines.push(`\x1b[2m  …and ${rows.length - 60} more\x1b[0m`);
  return lines;
}

// ─── Hub-spoke (high fanin × fanout) ─────────────────────────────────────────

function computeHubSpoke(allFiles, faninMap, fanoutMap) {
  return allFiles
    .map((f) => {
      // Dynamic edges are deferred, not static coupling — a hub is a static
      // coordination point, so count only static (non-dynamic) fan-in here.
      const fanin = (faninMap.get(f.fullPath) || []).filter((e) => !e.isDynamic).length;
      const fanout = fanoutMap.get(f.fullPath)?.size || 0;
      return {
        file: relative(targetDir, f.fullPath),
        fanin,
        fanout,
        product: fanin * fanout,
      };
    })
    .filter((r) => r.fanin >= 3 && r.fanout >= 3)
    .sort((a, b) => b.product - a.product);
}

function renderHubSpoke(allFiles, faninMap, fanoutMap) {
  const lines = [];
  lines.push('');
  lines.push('\x1b[1;36m══ Hub-Spoke: High Fan-in × Fan-out ══\x1b[0m');
  lines.push(
    `\x1b[2mFiles that both pull from many places and are pulled by many — usually coordination layers.\x1b[0m`
  );
  lines.push('');

  const rows = computeHubSpoke(allFiles, faninMap, fanoutMap);
  if (rows.length === 0) {
    lines.push(
      '  \x1b[32m✓ No hub-spoke files (all files have either low fan-in or low fan-out).\x1b[0m'
    );
    return lines;
  }
  for (const r of rows.slice(0, 30)) {
    lines.push(
      `  \x1b[33min:${String(r.fanin).padStart(3)}  out:${String(r.fanout).padStart(3)}  ×=${String(r.product).padStart(4)}\x1b[0m  ${r.file}`
    );
  }
  if (rows.length > 30) lines.push(`\x1b[2m  …and ${rows.length - 30} more\x1b[0m`);
  return lines;
}

// ─── Instability per folder (Ce / (Ce+Ca)) ───────────────────────────────────

function computeInstability(edges, fileToFolder) {
  const folderCe = new Map(); // folder → outgoing edges (to other folders)
  const folderCa = new Map(); // folder → incoming edges (from other folders)
  const allFolders = new Set();

  for (const { source, target } of edges) {
    const sf = fileToFolder.get(source) || '?';
    const tf = fileToFolder.get(target) || '?';
    allFolders.add(sf);
    allFolders.add(tf);
    if (sf === tf) continue;
    folderCe.set(sf, (folderCe.get(sf) || 0) + 1);
    folderCa.set(tf, (folderCa.get(tf) || 0) + 1);
  }

  const rows = [];
  for (const folder of allFolders) {
    const ce = folderCe.get(folder) || 0;
    const ca = folderCa.get(folder) || 0;
    const i = ce + ca === 0 ? null : ce / (ce + ca);
    rows.push({ folder, ce, ca, instability: i });
  }
  rows.sort((a, b) => (b.instability ?? -1) - (a.instability ?? -1));
  return rows;
}

function renderInstability(edges, fileToFolder) {
  const lines = [];
  lines.push('');
  lines.push('\x1b[1;36m══ Instability: Ce / (Ce + Ca) per folder ══\x1b[0m');
  lines.push(
    '\x1b[2m1 = unstable (mostly outgoing); 0 = stable (mostly incoming). Stable folders should not depend on unstable ones.\x1b[0m'
  );
  lines.push('');

  const rows = computeInstability(edges, fileToFolder);
  if (rows.length === 0) {
    lines.push('  (no inter-folder edges found)');
    return lines;
  }
  const w = Math.max(...rows.map((r) => r.folder.length), 6);
  for (const r of rows) {
    const i = r.instability;
    const tag = i === null ? '   -' : i.toFixed(2);
    const color = i === null ? '' : i >= 0.7 ? '\x1b[31m' : i <= 0.3 ? '\x1b[32m' : '\x1b[33m';
    lines.push(
      `  ${color}I=${tag}\x1b[0m  Ce:${String(r.ce).padStart(3)}  Ca:${String(r.ca).padStart(3)}  ${r.folder.padEnd(w)}`
    );
  }
  return lines;
}

// ─── Re-export depth ─────────────────────────────────────────────────────────

function computeReexportDepth(allFiles, edges) {
  const isReexportFile = (file) =>
    isLikelyBarrelFile(file) ||
    (file.exports || []).every((e) => e.kind === 'reexport' || e.tag === 'reexport');

  // Build adj: reexport file → targets
  const reexportTargets = new Map();
  for (const f of allFiles) {
    if (!isReexportFile(f)) continue;
    const targets = new Set();
    for (const { source, target } of edges) {
      if (source === f.fullPath) targets.add(target);
    }
    reexportTargets.set(f.fullPath, [...targets]);
  }

  // For each re-export file, longest chain length until non-reexport.
  function chainLen(start) {
    let depth = 0;
    let current = [start];
    const seen = new Set([start]);
    while (current.length) {
      const next = [];
      for (const c of current) {
        const targets = reexportTargets.get(c);
        if (!targets || targets.length === 0) continue;
        for (const t of targets) {
          if (seen.has(t)) continue;
          seen.add(t);
          if (reexportTargets.has(t)) next.push(t);
        }
      }
      if (next.length === 0) break;
      depth++;
      current = next;
    }
    return depth;
  }

  const rows = [];
  for (const f of allFiles) {
    if (!isReexportFile(f)) continue;
    const d = chainLen(f.fullPath);
    if (d >= 1) {
      rows.push({
        file: relative(targetDir, f.fullPath),
        depth: d,
        exports: (f.exports || []).length,
      });
    }
  }
  rows.sort((a, b) => b.depth - a.depth);
  return rows;
}

function renderReexportDepth(allFiles, edges) {
  const lines = [];
  lines.push('');
  lines.push('\x1b[1;36m══ Re-export Depth (Barrel Hops) ══\x1b[0m');
  lines.push(
    '\x1b[2mNumber of barrel hops a symbol takes before reaching a definition. Deep chains hurt tree-shaking and AI navigation.\x1b[0m'
  );
  lines.push('');

  const rows = computeReexportDepth(allFiles, edges);
  if (rows.length === 0) {
    lines.push('  (no re-export chains found)');
    return lines;
  }
  for (const r of rows.slice(0, 40)) {
    const tag = r.depth >= 3 ? '\x1b[31m' : r.depth >= 2 ? '\x1b[33m' : '';
    lines.push(`  ${tag}depth ${r.depth}\x1b[0m  exports:${r.exports}  ${r.file}`);
  }
  if (rows.length > 40) lines.push(`\x1b[2m  …and ${rows.length - 40} more\x1b[0m`);
  return lines;
}

// ─── Duplicate exports / default+named clash ─────────────────────────────────

function strippedBase(filename) {
  // Strip platform variant (.ios.tsx, .android.tsx, .web.tsx, .native.tsx) and extension.
  // Also fold colocated companion suffixes (.types, .styles, .constants) so a
  // component folder like `Foo/Foo.types.ts` + `Foo/index.ios.tsx` collapses to
  // a single logical module — those are not "duplicate exports", they are one
  // component split across the conventional sibling files.
  return filename
    .replace(/\.(ios|android|web|native|web\.native)\.[jt]sx?$/, '')
    .replace(/\.[jt]sx?$/, '')
    .replace(/\.m?js$/, '')
    .replace(/\.(types|styles|constants)$/, '');
}

function computeDupExports(allFiles) {
  const byName = new Map(); // name → [{file, fileNode, kind, tag}]
  const defaultPlusNamed = []; // files with both default & named export of same identifier
  const fileByPath = new Map(); // relative file path → fileNode
  for (const f of allFiles) {
    fileByPath.set(relative(targetDir, f.fullPath), f);
    const exps = f.exports || [];
    // Barrel files re-export from siblings — their "exports" are not definitions.
    // Treat thin route/proxy files (e.g. Expo Router `app/foo/bar.tsx` doing
    // `export default Foo;` after a single import) the same way: their export
    // is an alias for another file's definition, not a duplicate of it.
    const isBarrel = isLikelyBarrelFile(f) || isThinReExportProxy(f);
    const identifierByKind = new Map();
    for (const e of exps) {
      if (!/^[A-Za-z_]\w*$/.test(e.name)) continue;
      if (e.kind === 'reexport') continue;
      if (e.tag === 'reexport') continue;
      if (isBarrel) continue;
      if (!byName.has(e.name)) byName.set(e.name, []);
      byName.get(e.name).push({
        file: relative(targetDir, f.fullPath),
        fileNode: f,
        kind: e.kind,
      });

      if (!identifierByKind.has(e.name)) identifierByKind.set(e.name, new Set());
      identifierByKind.get(e.name).add(e.kind);
    }
    for (const [name, kinds] of identifierByKind) {
      if (kinds.has('default') && kinds.has('named')) {
        defaultPlusNamed.push({ file: relative(targetDir, f.fullPath), name });
      }
    }
  }

  const dupRows = [];
  for (const [name, locs] of byName) {
    const fileSet = new Set(locs.map((l) => l.file));
    if (fileSet.size < 2) continue;

    // Skip when every file is a known barrel (re-exports the same name).
    const allBarrels = locs.every((l) => isLikelyBarrelFile(l.fileNode));
    if (allBarrels) continue;

    // Skip component-folder twin sets: a component dir conventionally holds
    // `index.ios.tsx` + `index.android.tsx` + `<Name>.types.ts` (and friends),
    // which all legitimately re-declare the same Props / hook / type. Pure
    // platform pairs strip to one base; companion + index pairs strip to two
    // bases (e.g. `BalancePill` and `index`) but still share a single dir, so
    // accept either signal.
    const strippedBases = new Set(locs.map((l) => strippedBase(l.fileNode.name)));
    const dirs = new Set(locs.map((l) => dirname(l.file)));
    const allCompanionShapes = locs.every((l) => {
      const stripped = strippedBase(l.fileNode.name);
      // Index file (resolves to the dir) or matches the dir's basename
      // (the conventional `<Component>/<Component>.types.ts` shape).
      return stripped === 'index' || stripped === basename(dirname(l.file));
    });
    // When every loc lives in one component directory and the duplicate name
    // mentions that directory's basename (`FiatCurrencyPillProps` inside a
    // `FiatCurrencyPill/` folder), the colocation makes the "duplicate" a
    // single component's surface area redeclared across its convention files
    // (`index.ios`, `useFiatCurrencyPill`, `*.types`, etc).
    const componentNamedSibling =
      dirs.size === 1 &&
      locs.length <= 5 &&
      (() => {
        const dirBase = basename([...dirs][0]);
        return dirBase && name.toLowerCase().includes(dirBase.toLowerCase());
      })();
    const sameSibling =
      (strippedBases.size === 1 && dirs.size <= 2 && locs.length <= 4) ||
      (dirs.size === 1 && allCompanionShapes && locs.length <= 5) ||
      componentNamedSibling;
    if (sameSibling) continue;

    // Expo Router convention: every modal route names its default-exported
    // component `ModalScreen` (and similar boilerplate names) — those are not
    // duplicate definitions of one symbol but routing entry points that share
    // a conventional name. If every loc lives under `app/**`, treat as a
    // routing-name convention rather than a duplicate.
    const allUnderApp = locs.every((l) => /^app[/\\]/.test(l.file));
    if (allUnderApp) continue;

    // A name shared between an app source and its build-time generator script
    // (e.g. `config/backgroundImageThemes.ts` + `scripts/build-background-themes.js`)
    // is a generation pipeline, not a real duplicate. Drop tooling-only locs;
    // if fewer than 2 app-side locs remain, the duplicate doesn't exist in
    // shipping code.
    const appLocs = locs.filter((l) => !/^scripts[/\\]|^codereview[/\\]/.test(l.file));
    if (appLocs.length < 2) continue;

    dupRows.push({ name, files: [...fileSet] });
  }
  dupRows.sort((a, b) => b.files.length - a.files.length);
  return { dupRows, defaultPlusNamed };
}

function renderDupExports(allFiles) {
  const lines = [];
  lines.push('');
  lines.push('\x1b[1;36m══ Duplicate Exports ══\x1b[0m');
  lines.push(
    '\x1b[2mIdentifiers exported with the same name from 2+ files (one is dead, or the namespace collision is hiding intent). Plus default+named clashes within a single file.\x1b[0m'
  );
  lines.push('');

  const { dupRows, defaultPlusNamed } = computeDupExports(allFiles);
  if (dupRows.length === 0 && defaultPlusNamed.length === 0) {
    lines.push('  \x1b[32m✓ No duplicate exports.\x1b[0m');
    return lines;
  }
  if (dupRows.length > 0) {
    lines.push(`  \x1b[33mDuplicate names (${dupRows.length}):\x1b[0m`);
    for (const r of dupRows.slice(0, 40)) {
      lines.push(`    \x1b[1m${r.name}\x1b[0m  in ${r.files.length} files:`);
      for (const f of r.files) lines.push(`      - ${f}`);
    }
    if (dupRows.length > 40) lines.push(`\x1b[2m    …and ${dupRows.length - 40} more\x1b[0m`);
    lines.push('');
  }
  if (defaultPlusNamed.length > 0) {
    lines.push(`  \x1b[33mDefault + named clash (${defaultPlusNamed.length}):\x1b[0m`);
    for (const r of defaultPlusNamed) {
      lines.push(`    ${r.name}  in  ${r.file}`);
    }
  }
  return lines;
}

// ─── Unused exports ──────────────────────────────────────────────────────────

function computeUnusedExports(allFiles, importedNamesByTarget) {
  const rows = [];
  for (const f of allFiles) {
    if (isLikelyBarrelFile(f)) continue;
    const rel = relative(targetDir, f.fullPath);
    if (/^app[/\\]/.test(rel)) continue; // entry-point routes
    // Tooling/test scaffolding live outside the production graph: their
    // exports are consumed by Jest / DSL parsers / npm scripts that don't
    // appear as `import` statements. Counting them as "unused" would punish
    // the score for healthy tooling surface area.
    if (/^codereview[/\\]/.test(rel)) continue;
    if (/^scripts[/\\]/.test(rel)) continue;
    if (/(?:^|[/\\])__tests__[/\\]/.test(rel)) continue;
    if (/\.(test|spec)\.[mc]?[jt]sx?$/.test(rel)) continue;
    const usedNames = importedNamesByTarget.get(f.fullPath) || new Set();
    if (usedNames.has('*')) continue; // namespace import — opaque
    const exps = f.exports || [];
    const unused = [];
    for (const e of exps) {
      if (e.kind === 'reexport') continue;
      if (!/^[A-Za-z_]\w*$/.test(e.name)) continue;
      // default exports look like 'default' on the import side
      if (e.kind === 'default') {
        if (!usedNames.has('default') && !usedNames.has(e.name)) unused.push(e);
      } else if (!usedNames.has(e.name)) {
        unused.push(e);
      }
    }
    if (unused.length > 0 && unused.length === exps.filter((e) => e.kind !== 'reexport').length) {
      // entire file unused — caught by orphans, skip here
      continue;
    }
    if (unused.length > 0) {
      rows.push({
        file: relative(targetDir, f.fullPath),
        unused: unused.map((e) => `${e.name}${e.kind === 'default' ? ' [default]' : ''}`),
      });
    }
  }
  rows.sort((a, b) => b.unused.length - a.unused.length);
  return rows;
}

function renderUnusedExports(allFiles, importedNamesByTarget) {
  const lines = [];
  lines.push('');
  lines.push('\x1b[1;36m══ Unused Exports ══\x1b[0m');
  lines.push(
    '\x1b[2mExported symbols whose name is never imported anywhere internally. (Files where everything is unused → see Orphans.)\x1b[0m'
  );
  lines.push('');

  const rows = computeUnusedExports(allFiles, importedNamesByTarget);
  if (rows.length === 0) {
    lines.push('  \x1b[32m✓ No partially-unused export sets detected.\x1b[0m');
    return lines;
  }
  for (const r of rows.slice(0, 40)) {
    lines.push(`  \x1b[33m${r.file}\x1b[0m`);
    lines.push(`    \x1b[2munused:\x1b[0m ${r.unused.join(', ')}`);
  }
  if (rows.length > 40) lines.push(`\x1b[2m  …and ${rows.length - 40} more\x1b[0m`);
  return lines;
}

// ─── Test colocation ─────────────────────────────────────────────────────────

function computeTestColocation(allFiles) {
  const SKIP = /\.(d\.ts|test|spec)\./;
  const rows = [];
  for (const f of allFiles) {
    const rel = relative(targetDir, f.fullPath);
    if (SKIP.test(f.name)) continue;
    if (rel.startsWith('app/') || rel.startsWith('app\\')) continue; // routes
    if (isLikelyBarrelFile(f)) continue;
    if (rel.includes('__tests__/')) continue;
    const exps = f.exports || [];
    if (exps.length === 0) continue;
    if (hasColocatedTest(f)) continue;
    rows.push({
      file: rel,
      exports: exps.length,
      code: f.loc?.code || 0,
    });
  }
  rows.sort((a, b) => b.code - a.code);
  return rows;
}

function renderTestColocation(allFiles) {
  const lines = [];
  lines.push('');
  lines.push('\x1b[1;36m══ Test Colocation ══\x1b[0m');
  lines.push(
    '\x1b[2mFiles with exports but no neighbouring *.test.* / __tests__ entry. The interface is the test surface — these have no test surface at all.\x1b[0m'
  );
  lines.push('');

  const rows = computeTestColocation(allFiles);
  if (rows.length === 0) {
    lines.push('  \x1b[32m✓ Every exporting file has a test.\x1b[0m');
    return lines;
  }
  for (const r of rows.slice(0, 40)) {
    lines.push(
      `  \x1b[33m${String(r.code).padStart(5)} loc\x1b[0m  exports:${String(r.exports).padStart(2)}  ${r.file}`
    );
  }
  lines.push('');
  lines.push(`\x1b[2m  ${rows.length} file(s) without a colocated test\x1b[0m`);
  return lines;
}

// ─── Information-leakage clusters (Jaccard on import sets) ───────────────────

function computeLeakage(allFiles) {
  const sets = allFiles.map((f) => ({
    file: relative(targetDir, f.fullPath),
    imports: new Set((f.imports || []).map((i) => i.module)),
    tags: new Set((f.exports || []).map((e) => e.tag)),
  }));

  // Skip files with too few imports — noisy.
  const meaningful = sets.filter((s) => s.imports.size >= 4);
  const clusters = [];
  const used = new Set();
  for (let i = 0; i < meaningful.length; i++) {
    if (used.has(i)) continue;
    const seedI = meaningful[i].imports;
    const cluster = [{ file: meaningful[i].file, sim: 1 }];
    for (let j = i + 1; j < meaningful.length; j++) {
      if (used.has(j)) continue;
      const oI = meaningful[j].imports;
      const inter = [...seedI].filter((x) => oI.has(x)).length;
      const uni = new Set([...seedI, ...oI]).size;
      const jaccI = uni === 0 ? 0 : inter / uni;
      // Also require tag overlap so we don't conflate unrelated files
      const tagInter = [...meaningful[i].tags].filter((x) => meaningful[j].tags.has(x)).length;
      if (jaccI >= leakageThreshold && tagInter > 0) {
        cluster.push({ file: meaningful[j].file, sim: +jaccI.toFixed(2) });
        used.add(j);
      }
    }
    if (cluster.length >= 3) {
      used.add(i);
      clusters.push(cluster);
    }
  }
  return clusters;
}

function renderLeakage(allFiles) {
  const lines = [];
  lines.push('');
  lines.push('\x1b[1;36m══ Information-Leakage Clusters ══\x1b[0m');
  lines.push(
    `\x1b[2mGroups of ≥3 files sharing ≥${Math.round(leakageThreshold * 100)}% of their imports — same knowledge used in multiple places.\x1b[0m`
  );
  lines.push('');

  const clusters = computeLeakage(allFiles);
  if (clusters.length === 0) {
    lines.push('  \x1b[32m✓ No leakage clusters detected.\x1b[0m');
    return lines;
  }
  for (let i = 0; i < clusters.length; i++) {
    lines.push(`  \x1b[1mCluster ${i + 1}\x1b[0m (${clusters[i].length} files):`);
    for (const c of clusters[i]) {
      lines.push(`    sim=${c.sim.toFixed(2)}  ${c.file}`);
    }
    lines.push('');
  }
  return lines;
}

// ─── Concept locality (CONTEXT.md terms) ─────────────────────────────────────

function loadContextTerms() {
  const path = join(ROOT, 'CONTEXT.md');
  if (!existsSync(path)) return null;
  let content = '';
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  const terms = new Set();
  for (const m of content.matchAll(/\*\*([^*]+)\*\*/g)) terms.add(m[1].trim());
  for (const m of content.matchAll(/`([^`]+)`/g)) terms.add(m[1].trim());
  for (const m of content.matchAll(/^#+\s+(.+)$/gm)) terms.add(m[1].trim());
  return [...terms].filter((t) => /^[A-Za-z][\w. -]{2,}$/.test(t));
}

function computeConcept(allFiles) {
  const terms = loadContextTerms();
  if (!terms || terms.length === 0) return null;
  const rows = [];
  for (const term of terms) {
    // Use the first whitespace-stripped word for matching when the term has multiple
    const probe = term.split(/\s+/)[0];
    if (!probe || probe.length < 3) continue;
    const matchingFiles = [];
    const matchingFolders = new Set();
    for (const f of allFiles) {
      if (!f.identifiers) continue;
      if (f.identifiers.has(probe)) {
        matchingFiles.push(relative(targetDir, f.fullPath));
        matchingFolders.add(getTopFolder(relative(targetDir, f.fullPath), 1));
      }
    }
    rows.push({
      term,
      probe,
      files: matchingFiles.length,
      folders: matchingFolders.size,
    });
  }
  rows.sort((a, b) => b.folders - a.folders || b.files - a.files);
  return rows;
}

function renderConcept(allFiles) {
  const lines = [];
  lines.push('');
  lines.push('\x1b[1;36m══ Concept Locality (CONTEXT.md) ══\x1b[0m');
  lines.push(
    '\x1b[2mFor each term in CONTEXT.md, count files and top-level folders containing the identifier. High folder spread = concept has lost its seam.\x1b[0m'
  );
  lines.push('');

  const rows = computeConcept(allFiles);
  if (!rows) {
    lines.push('  (no CONTEXT.md found in project root)');
    return lines;
  }
  if (rows.length === 0) {
    lines.push('  (no recognizable terms in CONTEXT.md)');
    return lines;
  }
  for (const r of rows.slice(0, 50)) {
    const tag = r.folders >= 5 ? '\x1b[31m' : r.folders >= 3 ? '\x1b[33m' : '';
    lines.push(
      `  ${tag}folders:${String(r.folders).padStart(2)}  files:${String(r.files).padStart(3)}\x1b[0m  ${r.term}`
    );
  }
  if (rows.length > 50) lines.push(`\x1b[2m  …and ${rows.length - 50} more\x1b[0m`);
  return lines;
}

// ─── Vocabulary drift ────────────────────────────────────────────────────────

function computeVocabDrift(allFiles) {
  const counts = new Map(); // identifier → file count
  for (const f of allFiles) {
    if (!f.identifiers) continue;
    for (const id of f.identifiers) {
      counts.set(id, (counts.get(id) || 0) + 1);
    }
  }
  const contextTerms = new Set((loadContextTerms() || []).map((t) => t.split(/\s+/)[0]));
  const rows = [];
  for (const [id, count] of counts) {
    if (count < 8) continue;
    if (contextTerms.has(id)) continue;
    if (id.length < 5) continue;
    if (/^[A-Z][a-z]+$/.test(id)) {
      // Single-cap-prefix word like "Component" — too generic
      // keep, but down-weight via length filter above
    }
    rows.push({ id, files: count });
  }
  rows.sort((a, b) => b.files - a.files);
  return rows;
}

function renderVocabDrift(allFiles) {
  const lines = [];
  lines.push('');
  lines.push('\x1b[1;36m══ Vocabulary Drift ══\x1b[0m');
  lines.push(
    '\x1b[2mIdentifiers used in ≥8 files but absent from CONTEXT.md — concepts that crept in without naming discipline.\x1b[0m'
  );
  lines.push('');

  const rows = computeVocabDrift(allFiles);
  if (rows.length === 0) {
    lines.push('  \x1b[32m✓ No drifting vocabulary detected.\x1b[0m');
    return lines;
  }
  for (const r of rows.slice(0, 40)) {
    lines.push(`  \x1b[33mfiles:${String(r.files).padStart(3)}\x1b[0m  ${r.id}`);
  }
  if (rows.length > 40) lines.push(`\x1b[2m  …and ${rows.length - 40} more\x1b[0m`);
  return lines;
}

// ─── Importer reach (transitive closure) ─────────────────────────────────────

function computeReach(allFiles, fanoutMap) {
  const cache = new Map();
  function reach(start) {
    if (cache.has(start)) return cache.get(start);
    const seen = new Set();
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop();
      const targets = fanoutMap.get(cur);
      if (!targets) continue;
      for (const t of targets) {
        if (seen.has(t)) continue;
        seen.add(t);
        stack.push(t);
      }
    }
    cache.set(start, seen);
    return seen;
  }

  return allFiles
    .map((f) => ({
      file: relative(targetDir, f.fullPath),
      reach: reach(f.fullPath).size,
      direct: fanoutMap.get(f.fullPath)?.size || 0,
    }))
    .filter((r) => r.reach > 0)
    .sort((a, b) => b.reach - a.reach)
    .slice(0, reachTop);
}

function renderReach(allFiles, fanoutMap) {
  const lines = [];
  lines.push('');
  lines.push('\x1b[1;36m══ Importer Reach (Transitive Fan-out) ══\x1b[0m');
  lines.push(
    '\x1b[2mFor each file, the size of the transitive set of files it can reach via imports. High reach = de-facto god module.\x1b[0m'
  );
  lines.push('');

  const rows = computeReach(allFiles, fanoutMap);
  if (rows.length === 0) {
    lines.push('  (no internal imports)');
    return lines;
  }
  for (const r of rows) {
    lines.push(
      `  \x1b[33mreach:${String(r.reach).padStart(4)}\x1b[0m  direct:${String(r.direct).padStart(3)}  ${r.file}`
    );
  }
  return lines;
}

// ─── Architecture rules ──────────────────────────────────────────────────────

function loadArchitectureRules() {
  if (!architecturePath) return null;
  try {
    const raw = readFileSync(architecturePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.error(`Warning: could not load ${architecturePath}: ${e.message}`);
    return null;
  }
}

function computeArchitectureViolations(edges) {
  const rules = loadArchitectureRules();
  if (!rules) return null;
  // Schema:
  //   { layers: { layerName: ["folderA", "folderB"] }, allowed: { layerName: ["otherLayer", ...] } }
  //   or { forbidden: [{ from: "folder", to: "folder" }] }
  // Rule paths are matched against `relative(targetDir, fullPath)`, independent
  // of --coupling-depth.
  const violations = [];

  function inFolder(fullPath, folder) {
    // Architecture rules are project-wide → match against ROOT-relative paths.
    const rel = relative(ROOT, fullPath);
    return rel === folder || rel.startsWith(folder + '/');
  }

  if (rules.forbidden && Array.isArray(rules.forbidden)) {
    for (const { source, target } of edges) {
      for (const rule of rules.forbidden) {
        if (inFolder(source, rule.from) && inFolder(target, rule.to)) {
          violations.push({
            kind: 'forbidden',
            rule: `${rule.from} → ${rule.to}`,
            source: relative(targetDir, source),
            target: relative(targetDir, target),
          });
        }
      }
    }
  }

  if (rules.layers && rules.allowed) {
    function layerOf(fullPath) {
      for (const [layer, folders] of Object.entries(rules.layers)) {
        for (const folder of folders) {
          if (inFolder(fullPath, folder)) return layer;
        }
      }
      return null;
    }
    for (const { source, target } of edges) {
      const sLayer = layerOf(source);
      const tLayer = layerOf(target);
      if (!sLayer || !tLayer || sLayer === tLayer) continue;
      const allowed = rules.allowed[sLayer] || [];
      if (!allowed.includes(tLayer)) {
        violations.push({
          kind: 'layer',
          rule: `${sLayer} → ${tLayer} (not allowed)`,
          source: relative(targetDir, source),
          target: relative(targetDir, target),
        });
      }
    }
  }

  return violations;
}

function renderArchitecture(edges) {
  const lines = [];
  lines.push('');
  lines.push('\x1b[1;36m══ Architecture Rule Violations ══\x1b[0m');
  lines.push(
    `\x1b[2mEvaluated against ${relative(ROOT, architecturePath || '')}. Schema: { layers, allowed } and/or { forbidden: [{from, to}] }.\x1b[0m`
  );
  lines.push('');

  const violations = computeArchitectureViolations(edges);
  if (!violations) {
    lines.push('  (no architecture rules file)');
    return lines;
  }
  if (violations.length === 0) {
    lines.push('  \x1b[32m✓ No architecture violations.\x1b[0m');
    return lines;
  }
  // Group by rule
  const groups = new Map();
  for (const v of violations) {
    if (!groups.has(v.rule)) groups.set(v.rule, []);
    groups.get(v.rule).push(v);
  }
  for (const [rule, vs] of groups) {
    lines.push(`  \x1b[31m${rule}\x1b[0m  (${vs.length}):`);
    for (const v of vs.slice(0, 20)) {
      lines.push(`    ${v.source}  →  ${v.target}`);
    }
    if (vs.length > 20) lines.push(`\x1b[2m    …and ${vs.length - 20} more\x1b[0m`);
    lines.push('');
  }
  return lines;
}

// ─── Git history (churn, temporal coupling, stale) ───────────────────────────

function gitAvailable() {
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function gitLogSince(months) {
  try {
    const out = execSync(`git log --since="${months}.months" --pretty=format:%H --name-only`, {
      cwd: ROOT,
      maxBuffer: 64 * 1024 * 1024,
    }).toString();
    return out;
  } catch {
    return '';
  }
}

function gitLastTouchPerFile() {
  try {
    const out = execSync(`git log --pretty=format:%cs --name-only`, {
      cwd: ROOT,
      maxBuffer: 64 * 1024 * 1024,
    }).toString();
    const lastTouch = new Map();
    let currentDate = null;
    for (const line of out.split('\n')) {
      if (line === '') {
        currentDate = null;
        continue;
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(line)) {
        currentDate = line;
        continue;
      }
      if (currentDate && !lastTouch.has(line)) lastTouch.set(line, currentDate);
    }
    return lastTouch;
  } catch {
    return new Map();
  }
}

function parseGitCommits(logText) {
  // Parses output of `git log --pretty=format:%H --name-only`:
  //   <hash>
  //   path1
  //   path2
  //
  //   <hash>
  //   path3
  const commits = [];
  const blocks = logText.split('\n\n');
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean);
    if (lines.length === 0) continue;
    const hash = lines[0];
    if (!/^[0-9a-f]{7,}$/i.test(hash)) continue;
    const files = lines.slice(1);
    if (files.length > 0) commits.push({ hash, files });
  }
  return commits;
}

function computeChurn(commits) {
  const counts = new Map();
  for (const c of commits) {
    for (const f of c.files) counts.set(f, (counts.get(f) || 0) + 1);
  }
  return counts;
}

function computeTemporalCoupling(commits, minCoChanges = 4) {
  // Pair → coChange count, but skip giant commits (likely refactors, sweeping changes).
  const pairCounts = new Map();
  for (const c of commits) {
    if (c.files.length > 25 || c.files.length < 2) continue;
    const sorted = [...new Set(c.files)].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const key = sorted[i] + '\0' + sorted[j];
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      }
    }
  }
  const rows = [];
  for (const [key, count] of pairCounts) {
    if (count < minCoChanges) continue;
    const [a, b] = key.split('\0');
    rows.push({ a, b, count });
  }
  rows.sort((a, b) => b.count - a.count);
  return rows;
}

function renderHistory(allFiles) {
  const lines = [];
  lines.push('');
  lines.push(
    `\x1b[1;36m══ History: Churn × Complexity, Temporal Coupling, Stale Files (last ${sinceMonths} months) ══\x1b[0m`
  );
  lines.push('');

  if (!gitAvailable()) {
    lines.push('  (git not available — skipping history reports)');
    return lines;
  }

  const log = gitLogSince(sinceMonths);
  const commits = parseGitCommits(log);
  if (commits.length === 0) {
    lines.push(`  (no commits in last ${sinceMonths} months)`);
    return lines;
  }

  const churn = computeChurn(commits);
  const fileMap = new Map(); // relPath → fileNode
  for (const f of allFiles) fileMap.set(relative(ROOT, f.fullPath), f);

  // Hotspots: churn × cognitive complexity
  const hotspots = [];
  for (const [path, count] of churn) {
    const node = fileMap.get(path);
    if (!node) continue;
    const cog = node.metrics?.complexity?.cognitive || 0;
    if (cog === 0) continue;
    hotspots.push({
      path,
      commits: count,
      cognitive: cog,
      product: count * cog,
      code: node.loc?.code || 0,
    });
  }
  hotspots.sort((a, b) => b.product - a.product);

  lines.push('  \x1b[1mHotspots (churn × cognitive complexity)\x1b[0m');
  if (hotspots.length === 0) {
    lines.push('    (no overlap between changed files and analyzed files)');
  } else {
    for (const h of hotspots.slice(0, 25)) {
      lines.push(
        `    \x1b[33m×=${String(h.product).padStart(5)}\x1b[0m  commits:${String(h.commits).padStart(3)}  cog:${String(h.cognitive).padStart(4)}  ${h.path}`
      );
    }
    if (hotspots.length > 25) lines.push(`\x1b[2m    …and ${hotspots.length - 25} more\x1b[0m`);
  }
  lines.push('');

  // Temporal coupling
  lines.push('  \x1b[1mTemporal coupling (pairs co-changed in ≥4 commits)\x1b[0m');
  const couplings = computeTemporalCoupling(commits, 4);
  if (couplings.length === 0) {
    lines.push('    (no significant co-changes)');
  } else {
    for (const c of couplings.slice(0, 25)) {
      lines.push(`    \x1b[33mco:${String(c.count).padStart(3)}\x1b[0m  ${c.a}`);
      lines.push(`              \x1b[2m↔ ${c.b}\x1b[0m`);
    }
    if (couplings.length > 25) lines.push(`\x1b[2m    …and ${couplings.length - 25} more\x1b[0m`);
  }
  lines.push('');

  // Stale files (>12mo since last touch but still imported)
  const lastTouch = gitLastTouchPerFile();
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - sinceMonths);
  const stale = [];
  for (const f of allFiles) {
    const rel = relative(ROOT, f.fullPath);
    const date = lastTouch.get(rel);
    if (!date) continue;
    if (new Date(date) > cutoff) continue;
    stale.push({ file: relative(targetDir, f.fullPath), date, code: f.loc?.code || 0 });
  }
  stale.sort((a, b) => a.date.localeCompare(b.date));
  lines.push(`  \x1b[1mStale files (last touched > ${sinceMonths} months ago)\x1b[0m`);
  if (stale.length === 0) {
    lines.push('    (everything has been touched recently)');
  } else {
    for (const s of stale.slice(0, 25)) {
      lines.push(`    \x1b[2m${s.date}\x1b[0m  code:${String(s.code).padStart(4)}  ${s.file}`);
    }
    if (stale.length > 25) lines.push(`\x1b[2m    …and ${stale.length - 25} more\x1b[0m`);
  }

  return { lines, hotspots, couplings, stale };
}

// ═══════════════════════════════════════════════════════════════════════════════
// LLM-FRIENDLY COMPACT MODE
// ═══════════════════════════════════════════════════════════════════════════════

function renderLlm(allFiles, dep, totals, historyResult) {
  const { faninMap, fanoutMap, edges, fileToFolder, importedNamesByTarget } = dep;
  const out = [];

  const scores = computeScores(allFiles, dep, totals);
  if (scores) {
    out.push(`# Structural Health Score`);
    out.push('');
    out.push(`Overall: **${scores.overall}/100**`);
    for (const cat of scores.categories) {
      out.push(`- ${cat.name}: ${cat.score}/100 (weight ${cat.weight})`);
    }
    out.push('');
  }

  const cycles = detectCycles(edges);
  // Header total only — unfiltered, includes Expo Router entries / tests / configs.
  // Score impact comes from the Hygiene block's filtered set, not this count.
  const orphans = allFiles.filter((f) => !faninMap.has(f.fullPath));
  const shallow = computeShallow(allFiles);
  const passthrough = computePassThrough(allFiles, faninMap, fanoutMap);
  const complexity = computeComplexityHotspots(allFiles);
  const typesafety = computeTypesafety(allFiles);
  const components = computeComponentSmells(allFiles);
  const hub = computeHubSpoke(allFiles, faninMap, fanoutMap);
  const dup = computeDupExports(allFiles);
  const unused = computeUnusedExports(allFiles, importedNamesByTarget);
  const testGaps = computeTestColocation(allFiles);
  const archViolations = showArchitecture ? computeArchitectureViolations(edges) : null;

  out.push(`# Repo Analysis: ${targetArg || '.'}`);
  out.push('');
  out.push(
    `Files: ${totals.files}  Code: ${totals.code}  Cycles: ${cycles.length}  Orphans: ${orphans.length}  Shallow: ${shallow.length}  Pass-through: ${passthrough.length}  Complexity hotspots: ${complexity.length}  Component smells: ${components.length}  Type-safety hotspots: ${typesafety.length}  Hub-spoke: ${hub.length}  Test gaps: ${testGaps.length}  Unused-export files: ${unused.length}`
  );
  if (archViolations) out.push(`Architecture violations: ${archViolations.length}`);
  out.push('');

  function bullet(title, items, fmt, top = 10) {
    if (!items || items.length === 0) return;
    out.push(`## ${title}`);
    for (const it of items.slice(0, top)) out.push(`- ${fmt(it)}`);
    if (items.length > top) out.push(`- …and ${items.length - top} more`);
    out.push('');
  }

  bullet(
    'Top complexity hotspots',
    complexity,
    (r) =>
      `${r.file} | cognitive=${r.cognitive} cyclomatic=${r.cyclomatic} nesting=${r.nesting} code=${r.code}`
  );
  bullet(
    'Top shallow modules',
    shallow,
    (r) => `${r.file} | depth=${r.depth} exports=${r.exports} code=${r.code}`
  );
  bullet(
    'Pass-through suspects',
    passthrough,
    (r) => `${r.file} | ratio=${r.ratio} exports=${r.exports} fanin=${r.fanin} fanout=${r.fanout}`
  );
  bullet(
    'Hub-spoke coordinators',
    hub,
    (r) => `${r.file} | fanin=${r.fanin} fanout=${r.fanout} ×=${r.product}`
  );
  bullet(
    'Type-safety hotspots',
    typesafety,
    (r) => `${r.file} | any=${r.any} !=${r.bangs} as=${r.casts} ts-ignore=${r.tsIgnore}`
  );
  bullet('Component smells', components, (r) => `${r.file}:${r.component} | ${r.flags.join(' ')}`);
  bullet(
    'Duplicate export names',
    dup.dupRows,
    (r) =>
      `${r.name} in ${r.files.length} files: ${r.files.slice(0, 3).join(', ')}${r.files.length > 3 ? ', …' : ''}`
  );
  bullet('Default+named export clash', dup.defaultPlusNamed, (r) => `${r.name} in ${r.file}`);
  bullet(
    'Unused export sets',
    unused,
    (r) =>
      `${r.file} | unused: ${r.unused.slice(0, 4).join(', ')}${r.unused.length > 4 ? ', …' : ''}`
  );
  bullet('Test gaps', testGaps, (r) => `${r.file} | exports=${r.exports} code=${r.code}`);
  bullet(
    'Cycles',
    cycles,
    (scc) => `(${scc.length} files) ${scc.map((p) => relative(targetDir, p)).join(' → ')}`
  );

  if (showInstability) {
    bullet(
      'Instability per folder',
      computeInstability(edges, fileToFolder),
      (r) =>
        `${r.folder} | I=${r.instability == null ? '-' : r.instability.toFixed(2)} Ce=${r.ce} Ca=${r.ca}`
    );
  }
  if (showReexportDepth) {
    bullet(
      'Re-export depth (barrel hops)',
      computeReexportDepth(allFiles, edges),
      (r) => `${r.file} | depth=${r.depth} exports=${r.exports}`
    );
  }
  if (showLeakage) {
    const clusters = computeLeakage(allFiles);
    if (clusters.length > 0) {
      out.push('## Information-leakage clusters');
      for (let i = 0; i < clusters.length; i++) {
        out.push(
          `- Cluster ${i + 1} (${clusters[i].length} files): ${clusters[i]
            .slice(0, 5)
            .map((c) => c.file)
            .join(', ')}${clusters[i].length > 5 ? ', …' : ''}`
        );
      }
      out.push('');
    }
  }
  if (showConcept) {
    const concept = computeConcept(allFiles);
    if (concept) {
      bullet(
        'Concept locality',
        concept,
        (r) => `${r.term} | folders=${r.folders} files=${r.files}`
      );
    }
  }
  if (showVocabDrift) {
    bullet('Vocabulary drift', computeVocabDrift(allFiles), (r) => `${r.id} | files=${r.files}`);
  }
  if (showReach) {
    bullet(
      'Importer reach',
      computeReach(allFiles, fanoutMap),
      (r) => `${r.file} | reach=${r.reach} direct=${r.direct}`
    );
  }

  if (archViolations) {
    bullet(
      'Architecture violations',
      archViolations,
      (v) => `${v.rule}: ${v.source} → ${v.target}`
    );
  }

  if (boundaryA && boundaryB) {
    const absA = resolve(targetDir, boundaryA);
    const absB = resolve(targetDir, boundaryB);
    const isInFolder = (fp, abs) => fp.startsWith(abs + '/') || fp === abs;
    const cross = edges.filter(
      (e) =>
        (isInFolder(e.source, absA) && isInFolder(e.target, absB)) ||
        (isInFolder(e.source, absB) && isInFolder(e.target, absA))
    );
    bullet(
      `Boundary ${boundaryA} ↔ ${boundaryB}`,
      cross,
      (e) => `${relative(targetDir, e.source)} → ${relative(targetDir, e.target)}`
    );
  }

  if (historyResult) {
    bullet(
      'Churn × cognitive (history)',
      historyResult.hotspots || [],
      (r) => `${r.path} | commits=${r.commits} cognitive=${r.cognitive} ×=${r.product}`
    );
    bullet(
      'Temporal coupling (history)',
      historyResult.couplings || [],
      (c) => `${c.a} ↔ ${c.b} | co=${c.count}`
    );
    bullet(
      'Stale files (history)',
      historyResult.stale || [],
      (s) => `${s.file} | last=${s.date} code=${s.code}`
    );
  }

  return out.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// STRUCTURAL HEALTH SCORE
// ═══════════════════════════════════════════════════════════════════════════════
//
// Lighthouse-style scoring. Each category starts at 100 and loses points for
// issues, with most deductions normalized per-100-files so big and small repos
// can be compared. Tuning the constants below changes how punitive each metric
// is — the *trends* between runs matter more than the absolute numbers.

function clampDed(n, max) {
  return Math.max(0, Math.min(max, n));
}

// Pull up to N representative file paths out of a heterogeneous array of
// rows. Handles the various shapes used by the metric computers above:
//   - row.file          (most reports)
//   - row.path          (history hotspots)
//   - row[0]            (cycle SCCs are arrays of full paths)
//   - row.files[0]      (duplicate-export rows)
function pickExamples(rows, n = 3) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const r of rows) {
    if (out.length >= n) break;
    let f = null;
    if (typeof r === 'string') f = r;
    else if (Array.isArray(r) && r.length > 0) f = r[0];
    else if (r && typeof r === 'object') {
      if (typeof r.file === 'string') f = r.file;
      else if (typeof r.path === 'string') f = r.path;
      else if (typeof r.fullPath === 'string') f = r.fullPath;
      else if (Array.isArray(r.files) && r.files.length > 0) f = r.files[0];
    }
    if (!f) continue;
    // Normalize absolute paths back to repo-relative.
    if (f.startsWith('/')) f = relative(targetDir, f);
    if (!out.includes(f)) out.push(f);
  }
  return out;
}

function computeScores(allFiles, dep, totals) {
  if (!dep || totals.files === 0) return null;
  const { faninMap, fanoutMap, edges, importedNamesByTarget } = dep;
  const fc = totals.files;
  const per100 = (n) => (n / fc) * 100;
  const cats = [];

  // ─── Architecture ──────────────────────────────────────────────────────
  {
    const cycles = detectCycles(edges);
    const hub = computeHubSpoke(allFiles, faninMap, fanoutMap);
    const archV = showArchitecture ? computeArchitectureViolations(edges) || [] : null;
    const breakdown = [];
    let d = 0;

    const cyD = clampDed(cycles.length * 15, 60);
    breakdown.push({
      metric: 'circular dependencies',
      value: cycles.length,
      deduction: cyD,
      examples: pickExamples(cycles),
    });
    d += cyD;

    const hubD = clampDed(per100(hub.length) * 8, 30);
    breakdown.push({
      metric: 'hub-spoke god modules',
      value: hub.length,
      deduction: hubD,
      examples: pickExamples(hub),
    });
    d += hubD;

    if (archV !== null) {
      const aD = clampDed(archV.length * 3, 50);
      breakdown.push({
        metric: 'architecture rule violations',
        value: archV.length,
        deduction: aD,
        examples: pickExamples(archV.map((v) => v.source || v.target || v.file)),
      });
      d += aD;
    }

    cats.push({
      name: 'Architecture',
      weight: 20,
      score: Math.round(clampDed(100 - d, 100)),
      breakdown,
    });
  }

  // ─── Module Design ─────────────────────────────────────────────────────
  {
    const shallow = computeShallow(allFiles);
    const pt = computePassThrough(allFiles, faninMap, fanoutMap);
    const rxDeep = computeReexportDepth(allFiles, edges).filter((r) => r.depth >= 2);
    const breakdown = [];
    let d = 0;

    const sD = clampDed(per100(shallow.length) * 4, 50);
    breakdown.push({
      metric: 'shallow modules',
      value: shallow.length,
      deduction: sD,
      examples: pickExamples(shallow),
    });
    d += sD;

    const ptD = clampDed(per100(pt.length) * 6, 40);
    breakdown.push({
      metric: 'pass-through suspects',
      value: pt.length,
      deduction: ptD,
      examples: pickExamples(pt),
    });
    d += ptD;

    const rxD = clampDed(per100(rxDeep.length) * 5, 30);
    breakdown.push({
      metric: 're-export depth ≥2 (barrel hops)',
      value: rxDeep.length,
      deduction: rxD,
      examples: pickExamples(rxDeep),
    });
    d += rxD;

    cats.push({
      name: 'Module Design',
      weight: 15,
      score: Math.round(clampDed(100 - d, 100)),
      breakdown,
    });
  }

  // ─── Code Complexity ───────────────────────────────────────────────────
  {
    const cx = computeComplexityHotspots(allFiles);
    // Severity: 5 pts if cog ≥ 3× threshold, 3 pts if ≥ 2×, 1 pt otherwise.
    const severity = cx.reduce((s, r) => {
      const x = r.cognitive / complexityThreshold;
      return s + (x >= 3 ? 5 : x >= 2 ? 3 : 1);
    }, 0);
    const d = clampDed((severity / fc) * 100 * 0.8, 60);
    cats.push({
      name: 'Code Complexity',
      weight: 15,
      score: Math.round(clampDed(100 - d, 100)),
      breakdown: [
        {
          metric: `complexity hotspots (cognitive ≥ ${complexityThreshold})`,
          value: cx.length,
          deduction: d,
          detail: `weighted severity: ${severity}`,
          examples: pickExamples(cx),
        },
      ],
    });
  }

  // ─── Type Safety ───────────────────────────────────────────────────────
  {
    const ts = computeTypesafety(allFiles);
    const total = ts.reduce((s, r) => s + r.score, 0);
    const perKLoc = totals.code > 0 ? (total / totals.code) * 1000 : 0;
    const d = clampDed(perKLoc * 1.5, 70);
    cats.push({
      name: 'Type Safety',
      weight: 10,
      score: Math.round(clampDed(100 - d, 100)),
      breakdown: [
        {
          metric: 'type-safety smells (any / ! / as / @ts-*)',
          value: total,
          deduction: d,
          detail: `${perKLoc.toFixed(1)} weighted smells per kLOC`,
          examples: pickExamples(ts),
        },
      ],
    });
  }

  // ─── Component Health (only if any React components exist) ─────────────
  let totalComps = 0;
  for (const f of allFiles) totalComps += (f.metrics?.react?.components || []).length;
  if (totalComps > 0) {
    const smells = computeComponentSmells(allFiles);
    const rate = (smells.length / totalComps) * 100;
    const d = clampDed(rate * 0.8, 70);
    cats.push({
      name: 'Component Health',
      weight: 10,
      score: Math.round(clampDed(100 - d, 100)),
      breakdown: [
        {
          metric: 'flagged components',
          value: smells.length,
          deduction: d,
          detail: `${rate.toFixed(1)}% of ${totalComps} components`,
          examples: pickExamples(smells),
        },
      ],
    });
  }

  // ─── Hygiene ───────────────────────────────────────────────────────────
  {
    const importedPaths = new Set(faninMap.keys());
    const orphans = allFiles.filter((f) => {
      if (importedPaths.has(f.fullPath)) return false;
      const rel = relative(targetDir, f.fullPath);
      // Tool-discovered entry points: Jest finds tests by glob, package.json
      // runs scripts directly, the build chain pulls config files / type
      // declarations / Metro polyfills without a static `import` ever appearing
      // in another file. Penalising them as "dead" misrepresents the codebase.
      if (/^app[/\\]/.test(rel)) return false;
      if (/(?:^|[/\\])__tests__[/\\]/.test(rel)) return false;
      if (/^scripts[/\\]/.test(rel)) return false;
      // Tooling lives in `codereview/` and `modules/<x>/scripts/` and is invoked
      // directly by npm scripts / hooks, never imported.
      if (/^codereview[/\\]/.test(rel)) return false;
      if (/^modules[/\\][^/\\]+[/\\]scripts[/\\]/.test(rel)) return false;
      if (/^packages[/\\][^/\\]+[/\\]scripts[/\\]/.test(rel)) return false;
      if (/\.(config|test|spec)\.[mc]?[jt]sx?$/.test(rel)) return false;
      if (/\.d\.ts$/.test(rel)) return false;
      if (/\.mjs$/.test(rel)) return false; // Bun-only entry scripts
      if (/^(polyfills|shim|index|app-env|nativewind-env|expo-env)\.[jt]sx?$/.test(rel)) {
        return false;
      }
      if (isLikelyBarrelFile(f)) return false;
      if (isLikelyCompatibilitySurface(f)) return false;
      return true;
    });
    const unused = computeUnusedExports(allFiles, importedNamesByTarget);
    const dup = computeDupExports(allFiles);
    const breakdown = [];
    let d = 0;

    const oD = clampDed(per100(orphans.length) * 5, 40);
    breakdown.push({
      metric: 'dead orphan files',
      value: orphans.length,
      deduction: oD,
      examples: pickExamples(orphans.map((o) => relative(targetDir, o.fullPath))),
    });
    d += oD;

    const uD = clampDed(per100(unused.length) * 4, 30);
    breakdown.push({
      metric: 'files with unused exports',
      value: unused.length,
      deduction: uD,
      examples: pickExamples(unused),
    });
    d += uD;

    const dpD = clampDed(per100(dup.dupRows.length) * 6, 25);
    breakdown.push({
      metric: 'duplicate export names',
      value: dup.dupRows.length,
      deduction: dpD,
      examples: pickExamples(dup.dupRows),
    });
    d += dpD;

    const cD = clampDed(dup.defaultPlusNamed.length * 5, 20);
    breakdown.push({
      metric: 'default+named clashes',
      value: dup.defaultPlusNamed.length,
      deduction: cD,
      examples: pickExamples(dup.defaultPlusNamed),
    });
    d += cD;

    cats.push({
      name: 'Hygiene',
      weight: 15,
      score: Math.round(clampDed(100 - d, 100)),
      breakdown,
    });
  }

  // ─── Testability ───────────────────────────────────────────────────────
  const testable = allFiles.filter((f) => {
    const rel = relative(targetDir, f.fullPath);
    if (/\.(d\.ts|test|spec)\./.test(f.name)) return false;
    if (/^app[/\\]/.test(rel)) return false;
    if (isLikelyBarrelFile(f)) return false;
    if (rel.includes('__tests__/')) return false;
    if ((f.exports || []).length === 0) return false;
    return true;
  }).length;
  if (testable > 0) {
    const gapRows = computeTestColocation(allFiles);
    const gaps = gapRows.length;
    const covered = testable - gaps;
    const coverage = (covered / testable) * 100;
    cats.push({
      name: 'Testability',
      weight: 10,
      score: Math.round(clampDed(coverage, 100)),
      breakdown: [
        {
          metric: 'colocated test coverage',
          value: covered,
          deduction: Math.round(100 - coverage),
          detail: `${covered}/${testable} testable files have a colocated test`,
          examples: pickExamples(gapRows),
        },
      ],
    });
  }

  // ─── Conceptual Cohesion (only when those flags are on) ────────────────
  if (showLeakage || showVocabDrift || showConcept) {
    const breakdown = [];
    let d = 0;
    if (showLeakage) {
      const cl = computeLeakage(allFiles);
      const cD = clampDed(cl.length * 5, 40);
      breakdown.push({ metric: 'information-leakage clusters', value: cl.length, deduction: cD });
      d += cD;
    }
    if (showVocabDrift) {
      const drift = computeVocabDrift(allFiles);
      const dD = clampDed(drift.length * 1, 30);
      breakdown.push({ metric: 'drifting vocabulary terms', value: drift.length, deduction: dD });
      d += dD;
    }
    if (showConcept) {
      const concept = computeConcept(allFiles) || [];
      const spread = concept.filter((c) => c.folders >= 5).length;
      const sD = clampDed(spread * 4, 30);
      breakdown.push({ metric: 'high-spread concepts (≥5 folders)', value: spread, deduction: sD });
      d += sD;
    }
    if (breakdown.length > 0) {
      cats.push({
        name: 'Conceptual Cohesion',
        weight: 5,
        score: Math.round(clampDed(100 - d, 100)),
        breakdown,
      });
    }
  }

  const totalWeight = cats.reduce((s, c) => s + c.weight, 0);
  const overall = Math.round(cats.reduce((s, c) => s + c.score * c.weight, 0) / totalWeight);
  return { overall, categories: cats, totalWeight };
}

function scoreColor(score) {
  if (score >= 90) return '\x1b[32m'; // green
  if (score >= 50) return '\x1b[33m'; // yellow
  return '\x1b[31m'; // red
}

function scoreBar(score, width = 30) {
  const filled = Math.round((score / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function renderScores(scores) {
  if (!scores) return [];
  const lines = [];
  lines.push('');
  lines.push('\x1b[1;36m══ Structural Health Score ══\x1b[0m');
  lines.push(
    `\x1b[2mEach category starts at 100; issues deduct points (most metrics normalized per 100 files). Weights sum to ${scores.totalWeight}. Track the trend, not the absolute.\x1b[0m`
  );
  lines.push('');

  const oc = scoreColor(scores.overall);
  lines.push(
    `  \x1b[1mOverall\x1b[0m              ${oc}${String(scores.overall).padStart(3)}/100\x1b[0m  ${oc}${scoreBar(scores.overall, 40)}\x1b[0m`
  );
  lines.push('');

  for (const cat of scores.categories) {
    const c = scoreColor(cat.score);
    const name = cat.name.padEnd(20);
    lines.push(
      `  \x1b[1m${name}\x1b[0m ${c}${String(cat.score).padStart(3)}/100\x1b[0m  ${c}${scoreBar(cat.score, 30)}\x1b[0m  \x1b[2m(weight ${cat.weight})\x1b[0m`
    );
    for (const b of cat.breakdown) {
      const dRaw = typeof b.deduction === 'number' ? b.deduction : 0;
      const dStr = dRaw > 0 ? `-${dRaw < 1 ? dRaw.toFixed(1) : Math.round(dRaw)}` : '0';
      const padded = dStr.padStart(5);
      const colored = dRaw > 0 ? `\x1b[33m${padded}\x1b[0m` : `\x1b[2m${padded}\x1b[0m`;
      const detail = b.detail ? ` \x1b[2m— ${b.detail}\x1b[0m` : '';
      lines.push(`    ${colored}  ${b.metric.padEnd(40)} value: ${b.value}${detail}`);
      if (dRaw > 0 && Array.isArray(b.examples) && b.examples.length > 0) {
        // Files to look into — dim/gray, indented under the metric line.
        lines.push(`           \x1b[90m└─ look into: ${b.examples.join(', ')}\x1b[0m`);
      }
    }
    lines.push('');
  }
  return lines;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

const label = targetArg || '.';
const nodes = walk(targetDir);
const allFiles = collectAllFiles(nodes);
const totals = collectTotals(nodes);

let dep = null;
if (anyAnalysis) dep = buildDependencyGraph(allFiles);

let historyResult = null;
if (showHistory) {
  // Run history early so we can also surface in --llm
  // (renderHistory returns either an array or {lines,...} depending on success path)
  const r = renderHistory(allFiles);
  historyResult = Array.isArray(r) ? null : r;
}

if (showJson) {
  // ── JSON mode ────────────────────────────────────────────────────────────
  const jsonOutput = { totals, tree: toJson(nodes, targetDir) };

  if (dep) {
    const { faninMap, fanoutMap, edges, fileToFolder, importedNamesByTarget } = dep;

    if (showFanin) {
      jsonOutput.fanin = [...faninMap.entries()]
        .map(([file, importers]) => ({
          file: relative(targetDir, file),
          count: importers.length,
          importers: importers.map((i) => relative(targetDir, i.importer)),
          folders: [...new Set(importers.map((i) => fileToFolder.get(i.importer) || '?'))],
        }))
        .filter((e) => e.count >= faninMin)
        .sort((a, b) => b.count - a.count);
    }
    if (showCoupling) {
      const matrix = {};
      for (const { source, target } of edges) {
        const sf = fileToFolder.get(source) || '?';
        const tf = fileToFolder.get(target) || '?';
        if (sf === tf) continue;
        if (!matrix[sf]) matrix[sf] = {};
        matrix[sf][tf] = (matrix[sf][tf] || 0) + 1;
      }
      jsonOutput.coupling = matrix;
    }
    if (showCycles)
      jsonOutput.cycles = detectCycles(edges).map((scc) => scc.map((f) => relative(targetDir, f)));
    if (showOrphans) {
      const importedPaths = new Set(faninMap.keys());
      jsonOutput.orphans = allFiles
        .filter((f) => !importedPaths.has(f.fullPath))
        .map((f) => relative(targetDir, f.fullPath));
    }
    if (showColocate) {
      const suggestions = [];
      for (const [file, importers] of faninMap) {
        if (importers.length < 2) continue;
        const currentFolder = fileToFolder.get(file) || '?';
        const folderCounts = {};
        for (const imp of importers) {
          const folder = fileToFolder.get(imp.importer) || 'unknown';
          folderCounts[folder] = (folderCounts[folder] || 0) + 1;
        }
        const sorted = Object.entries(folderCounts).sort((a, b) => b[1] - a[1]);
        const [topFolder, topCount] = sorted[0] || [];
        const total = importers.length;
        if (topCount / total >= colocateThreshold && topFolder !== currentFolder) {
          suggestions.push({
            file: relative(targetDir, file),
            currentFolder,
            suggestedFolder: topFolder,
            importerCount: total,
            topCount,
          });
        }
      }
      jsonOutput.colocate = suggestions;
    }
    if (showShallow) jsonOutput.shallow = computeShallow(allFiles);
    if (showPassthrough) jsonOutput.passthrough = computePassThrough(allFiles, faninMap, fanoutMap);
    if (showComplexity) jsonOutput.complexity = computeComplexityHotspots(allFiles);
    if (showTypesafety) jsonOutput.typesafety = computeTypesafety(allFiles);
    if (showComponent) jsonOutput.components = computeComponentSmells(allFiles);
    if (showHubSpoke) jsonOutput.hubSpoke = computeHubSpoke(allFiles, faninMap, fanoutMap);
    if (showInstability) jsonOutput.instability = computeInstability(edges, fileToFolder);
    if (showReexportDepth) jsonOutput.reexportDepth = computeReexportDepth(allFiles, edges);
    if (showDupExports) jsonOutput.dupExports = computeDupExports(allFiles);
    if (showUnusedExports)
      jsonOutput.unusedExports = computeUnusedExports(allFiles, importedNamesByTarget);
    if (showTestColocation) jsonOutput.testColocation = computeTestColocation(allFiles);
    if (showScore) jsonOutput.score = computeScores(allFiles, dep, totals);
    if (showLeakage) jsonOutput.leakage = computeLeakage(allFiles);
    if (showConcept) jsonOutput.concept = computeConcept(allFiles);
    if (showVocabDrift) jsonOutput.vocabDrift = computeVocabDrift(allFiles);
    if (showReach) jsonOutput.reach = computeReach(allFiles, fanoutMap);
    if (showArchitecture) jsonOutput.architecture = computeArchitectureViolations(edges);

    if (showHistory && gitAvailable()) {
      const log = gitLogSince(sinceMonths);
      const commits = parseGitCommits(log);
      const churn = computeChurn(commits);
      const fileMap = new Map();
      for (const f of allFiles) fileMap.set(relative(ROOT, f.fullPath), f);
      const hotspots = [];
      for (const [path, count] of churn) {
        const node = fileMap.get(path);
        if (!node) continue;
        const cog = node.metrics?.complexity?.cognitive || 0;
        if (cog === 0) continue;
        hotspots.push({ path, commits: count, cognitive: cog, product: count * cog });
      }
      hotspots.sort((a, b) => b.product - a.product);
      jsonOutput.history = {
        hotspots,
        temporalCoupling: computeTemporalCoupling(commits, 4),
      };
    }

    if (boundaryA && boundaryB) {
      const absA = resolve(targetDir, boundaryA);
      const absB = resolve(targetDir, boundaryB);
      const isIn = (fp, abs) => fp.startsWith(abs + '/') || fp === abs;
      const aToB = [];
      const bToA = [];
      for (const { source, target } of edges) {
        if (isIn(source, absA) && isIn(target, absB))
          aToB.push({ from: relative(targetDir, source), to: relative(targetDir, target) });
        if (isIn(source, absB) && isIn(target, absA))
          bToA.push({ from: relative(targetDir, source), to: relative(targetDir, target) });
      }
      jsonOutput.boundary = { folderA: boundaryA, folderB: boundaryB, aToB, bToA };
    }
  }

  console.log(JSON.stringify(jsonOutput, null, 2));
} else if (showLlm) {
  // ── LLM compact mode ─────────────────────────────────────────────────────
  if (!dep) dep = buildDependencyGraph(allFiles);
  console.log(renderLlm(allFiles, dep, totals, historyResult));
} else {
  // ── Terminal mode ────────────────────────────────────────────────────────
  console.log(label);
  console.log(renderTree(nodes).join('\n'));
  console.log(renderSummary(totals));

  if (anyAnalysis && dep) {
    const { faninMap, fanoutMap, edges, fileToFolder, pathToNode, importedNamesByTarget } = dep;

    if (showFanin) console.log(renderFanin(faninMap, fileToFolder).join('\n'));
    if (showCoupling) console.log(renderCoupling(edges, fileToFolder).join('\n'));
    if (showCycles) console.log(renderCycles(edges).join('\n'));
    if (showOrphans) console.log(renderOrphans(allFiles, faninMap).join('\n'));
    if (showColocate) console.log(renderColocate(faninMap, fileToFolder, pathToNode).join('\n'));
    if (showShallow) console.log(renderShallow(allFiles).join('\n'));
    if (showPassthrough) console.log(renderPassThrough(allFiles, faninMap, fanoutMap).join('\n'));
    if (showHubSpoke) console.log(renderHubSpoke(allFiles, faninMap, fanoutMap).join('\n'));
    if (showInstability) console.log(renderInstability(edges, fileToFolder).join('\n'));
    if (showReexportDepth) console.log(renderReexportDepth(allFiles, edges).join('\n'));
    if (showComplexity) console.log(renderComplexity(allFiles).join('\n'));
    if (showTypesafety) console.log(renderTypesafety(allFiles).join('\n'));
    if (showComponent) console.log(renderComponent(allFiles).join('\n'));
    if (showDupExports) console.log(renderDupExports(allFiles).join('\n'));
    if (showUnusedExports)
      console.log(renderUnusedExports(allFiles, importedNamesByTarget).join('\n'));
    if (showTestColocation) console.log(renderTestColocation(allFiles).join('\n'));
    if (showLeakage) console.log(renderLeakage(allFiles).join('\n'));
    if (showConcept) console.log(renderConcept(allFiles).join('\n'));
    if (showVocabDrift) console.log(renderVocabDrift(allFiles).join('\n'));
    if (showReach) console.log(renderReach(allFiles, fanoutMap).join('\n'));
    if (showArchitecture) console.log(renderArchitecture(edges).join('\n'));
    if (boundaryA && boundaryB) console.log(renderBoundary(edges, boundaryA, boundaryB).join('\n'));
    if (showHistory) {
      const r = renderHistory(allFiles);
      const lines = Array.isArray(r) ? r : r.lines;
      console.log(lines.join('\n'));
    }
    if (showScore) console.log(renderScores(computeScores(allFiles, dep, totals)).join('\n'));
  }
}
