#!/usr/bin/env node

/**
 * find-lookalikes.mjs
 *
 * Companion to analyze-structure.mjs. Walks the project tree and extracts
 * EVERY declaration regardless of nesting:
 *
 *   - const / let / var bindings (incl. destructured names)
 *   - function declarations
 *   - arrow functions and function expressions assigned to bindings
 *   - class declarations
 *   - class methods
 *   - imports (named, default, namespace)
 *
 * Then deduplicates by (name, normalized-value, kind), keeping every
 * occurrence's file:line, and produces look-alike reports:
 *
 *   1. Name collisions    — same name, different definitions
 *   2. Value collisions   — same value bound to different names
 *   3. Color near-matches — hex / named / rgb() values within RGB distance N
 *   4. Name similarities  — Levenshtein-close identifiers, bucketed by length
 *
 * Usage:
 *   node scripts/find-lookalikes.mjs                    # default reports
 *   node scripts/find-lookalikes.mjs features/payments  # subtree
 *   node scripts/find-lookalikes.mjs --json
 *   node scripts/find-lookalikes.mjs --focus shared/theme.ts
 *                                                       # scan whole repo,
 *                                                       # only show look-alikes
 *                                                       # involving theme.ts
 *   node scripts/find-lookalikes.mjs --by-name red      # show every `red` definition
 *   node scripts/find-lookalikes.mjs --by-value '#FF0000'
 *   node scripts/find-lookalikes.mjs --dump variables   # alphabetised name list
 *
 * Tuning:
 *   --color-distance 30        # max RGB distance for color near-matches
 *   --name-distance 2          # max Levenshtein for name similarities
 *   --min-collision 2          # only show collisions with >= N alternatives
 *   --min-occurrences 1        # only show definitions seen >= N times
 *   --no-color-near            # skip color near-match analysis
 *   --no-name-near             # skip name similarity analysis
 *   --no-collisions            # skip both collision reports
 *   --include-tests            # by default __tests__ and *.test.* are skipped
 *   --show-noise               # include single-letter / generic names (i, tmp, props, …);
 *                              #   they're filtered from collision reports by default
 *   --inventory                # print full inventory (warning: large)
 */

import { readFileSync, existsSync } from 'fs';
import { join, relative, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import { walkFiles } from '../shared/walk.mjs';
import { stripCodeNoise, buildLineIndex, lineOf, readRange } from '../shared/source.mjs';
import { dim, bold, yellow, red, green, cyan } from '../shared/ansi.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

// ─── Config ──────────────────────────────────────────────────────────────────

// Names too generic to be worth flagging as collisions. Still recorded in
// inventory so --by-name still finds them.
const NOISY_NAMES = new Set([
  'i',
  'j',
  'k',
  'l',
  'm',
  'n',
  'x',
  'y',
  'z',
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
  '_',
  '$',
  'tmp',
  'temp',
  'val',
  'value',
  'res',
  'result',
  'err',
  'error',
  'ctx',
  'context',
  'cb',
  'fn',
  'callback',
  'arg',
  'args',
  'props',
  'state',
  'data',
  'item',
  'items',
  'el',
  'elem',
  'event',
  'ev',
  'prev',
  'next',
  'acc',
  'cur',
  'curr',
  'current',
  'idx',
  'index',
  'key',
  'keys',
  'k',
  'v',
  'kv',
  'self',
  'that',
  'opts',
  'options',
  'config',
  'params',
  'p',
  'q',
  'r',
  's',
  't',
  'u',
  'w',
  'g',
  'h',
  'fs',
  'rest',
  'others',
  'first',
  'last',
]);

// Values too generic to be worth flagging in collision reports.
const NOISY_VALUES = new Set([
  '""',
  "''",
  '``',
  '',
  '0',
  '1',
  '-1',
  '2',
  '-2',
  'true',
  'false',
  'null',
  'undefined',
  'void 0',
  '[]',
  '{}',
  'this',
  'self',
  'new Map()',
  'new Set()',
]);

// ─── CLI parsing ──────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const flagVal = (name, def) => {
  const i = argv.indexOf(name);
  if (i === -1 || i + 1 >= argv.length) return def;
  return argv[i + 1];
};
const numFlag = (name, def) => {
  const v = flagVal(name, null);
  if (v === null) return def;
  const n = parseFloat(v);
  return Number.isNaN(n) ? def : n;
};

const showJson = flag('--json');
const showInventory = flag('--inventory');
const includeTests = flag('--include-tests');
const showNoise = flag('--show-noise'); // by default, generic single-letter
// and obvious throwaway names are
// suppressed from collision reports.
const showCollisions = !flag('--no-collisions');
const showColorNear = !flag('--no-color-near');
const showNameNear = !flag('--no-name-near');

const colorDistance = numFlag('--color-distance', 30);
const nameDistance = numFlag('--name-distance', 2);
const minCollision = numFlag('--min-collision', 2);
const minOccurrences = numFlag('--min-occurrences', 1);

const byNameQuery = flagVal('--by-name', null);
const byValueQuery = flagVal('--by-value', null);
const dumpCategory = flagVal('--dump', null);
const focusArg = flagVal('--focus', null);

// Find positional target dir (first non-flag, non-flag-value arg).
const flagsTakingValue = new Set([
  '--color-distance',
  '--name-distance',
  '--min-collision',
  '--min-occurrences',
  '--by-name',
  '--by-value',
  '--dump',
  '--focus',
]);
let targetArg = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    if (flagsTakingValue.has(a)) i++;
    continue;
  }
  targetArg = a;
  break;
}
const targetDir = targetArg ? join(ROOT, targetArg) : ROOT;

// Resolve --focus to an absolute path. It can be given relative to ROOT
// (the repo root, same convention as the positional arg) or absolute.
// We compare against `decl.file` later, which is also absolute.
let focusPath = null;
if (focusArg) {
  focusPath = resolve(ROOT, focusArg);
  if (!existsSync(focusPath)) {
    console.error(`--focus: file not found: ${focusArg} (looked at ${focusPath})`);
    process.exit(1);
  }
}

// Source utilities are imported from ../shared/source.mjs.
// stripCodeNoise preserves character positions so offsets returned by
// regex matches map cleanly back to the original source via buildLineIndex.

// ─── Value normalization & classification ─────────────────────────────────────

const NAMED_COLORS = {
  // Just the colors that actually show up in code with any frequency. Add
  // entries here as the inventory surfaces them.
  red: [255, 0, 0],
  green: [0, 128, 0],
  lime: [0, 255, 0],
  blue: [0, 0, 255],
  navy: [0, 0, 128],
  white: [255, 255, 255],
  black: [0, 0, 0],
  yellow: [255, 255, 0],
  cyan: [0, 255, 255],
  magenta: [255, 0, 255],
  orange: [255, 165, 0],
  pink: [255, 192, 203],
  purple: [128, 0, 128],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  silver: [192, 192, 192],
  gold: [255, 215, 0],
  brown: [165, 42, 42],
  crimson: [220, 20, 60],
  transparent: [0, 0, 0], // alpha=0 — but we drop alpha; flag visually
};

function tryParseColor(rawValue) {
  if (typeof rawValue !== 'string') return null;
  // Strip surrounding quotes / backticks if present.
  let v = rawValue.trim();
  if (/^['"`].*['"`]$/.test(v)) v = v.slice(1, -1);
  v = v.trim();

  // Hex: #RGB, #RRGGBB, #RRGGBBAA
  let m = v.match(/^#([0-9a-fA-F]{3,8})$/);
  if (m) {
    const hex = m[1].toLowerCase();
    if (hex.length === 3 || hex.length === 4) {
      return [
        parseInt(hex[0] + hex[0], 16),
        parseInt(hex[1] + hex[1], 16),
        parseInt(hex[2] + hex[2], 16),
      ];
    }
    if (hex.length === 6 || hex.length === 8) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
    }
  }
  // rgb(r, g, b) / rgba(r, g, b, a)
  m = v.match(/^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) return [+m[1], +m[2], +m[3]];

  const named = NAMED_COLORS[v.toLowerCase()];
  if (named) return [...named];
  return null;
}

function rgbToCanonicalHex(rgb) {
  return '#' + rgb.map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('');
}

function colorDistanceRgb(a, b) {
  // Euclidean in RGB space. Not perceptually accurate but good enough to surface
  // "these are basically the same color" cases. We don't need ΔE2000 here.
  const dr = a[0] - b[0],
    dg = a[1] - b[1],
    db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function classifyValue(v) {
  if (v == null) return 'unknown';
  const s = v.trim();
  if (!s) return 'unknown';
  if (/^['"`]/.test(s)) {
    if (tryParseColor(s)) return 'color';
    return 'string';
  }
  if (/^-?\d+(?:\.\d+)?(?:e[-+]?\d+)?$/i.test(s)) return 'number';
  if (s === 'true' || s === 'false') return 'boolean';
  if (s === 'null') return 'null';
  if (s === 'undefined' || s === 'void 0') return 'undefined';
  if (/^(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>/.test(s)) return 'arrow-fn';
  if (/^(?:async\s*)?function\b/.test(s)) return 'function-expr';
  if (/^\[/.test(s)) return 'array';
  if (/^\{/.test(s)) return 'object';
  if (/^new\s+\w/.test(s)) return 'new-expr';
  if (/^[A-Za-z_$][\w$]*\s*\(/.test(s)) return 'call-expr';
  if (/^rgba?\s*\(/i.test(s)) return 'color';
  if (/^[A-Za-z_$][\w$.]*$/.test(s)) return 'reference';
  return 'expression';
}

/** Produce a canonical form for a value, used as the key in collision maps.
 *  The goal is: visually-different surface, same canonical → flagged. */
function canonicalizeValue(value, kind) {
  if (!value) return null;
  const s = value.trim();
  if (kind === 'color') {
    const rgb = tryParseColor(s);
    if (rgb) return rgbToCanonicalHex(rgb);
  }
  if (kind === 'string') {
    // Strip quotes, but preserve case (case matters for strings).
    if (/^['"`].*['"`]$/.test(s)) return s.slice(1, -1);
    return s;
  }
  if (kind === 'number') {
    return String(parseFloat(s));
  }
  if (kind === 'boolean' || kind === 'null' || kind === 'undefined') return s;
  if (kind === 'reference') return s; // bare identifier
  // For arrow-fn / object / array / call-expr / expression, collapse whitespace.
  // If the value ends with an unmatched bracket — `new Set([`, `(a, b) => {` —
  // we caught only the signature line of a multi-line construct. Treat as
  // null so it doesn't bucket with other half-captured values and create
  // false-positive collisions.
  const collapsed = s.replace(/\s+/g, ' ');
  const bracketTail = /[({\[]\s*$/;
  if (bracketTail.test(collapsed)) return null;
  return collapsed;
}

// ─── Declaration extraction ──────────────────────────────────────────────────

/**
 * Each declaration: { type, name, value?, valueKind?, file, line, scope }
 *   type      : variable | function | class | method | import
 *   value     : raw RHS text (for variables only; trimmed, single-line)
 *   valueKind : classifyValue(value)
 *   scope     : 'top' if at column 0 of its line in original source, else 'nested'.
 *               Used only as a hint in inventory; we still index everything.
 */
function extractDeclarations(src, filePath) {
  const code = stripCodeNoise(src);
  const offsets = buildLineIndex(src);
  const decls = [];

  const push = (decl) => {
    if (decl.name && /^[A-Za-z_$][\w$]*$/.test(decl.name)) decls.push(decl);
  };

  // ── Variables: const / let / var <name>[: T] = <value>
  // The lazy capture group runs to the next top-level `;`, newline, or `}`,
  // good enough for one-line bindings (the common case for primitives and
  // hex colors). Multi-line bindings get their LHS captured but value=null.
  // The `(?::\s*(?:[^=;,\n)}]|<[^>]*>)+)?` optional group eats a TS type
  // annotation; it explicitly excludes `=`, which guarantees that the FIRST
  // `=` in m[0] is the binding equals (not e.g. the `=` inside `=>`).
  const varRe =
    /(?:^|[\n;{(,])\s*(?:export\s+(?:default\s+)?)?(const|let|var)\s+(\w+)\s*(?::\s*(?:[^=;,\n)}]|<[^>]*>)+)?\s*=\s*([^;\n]+?)(?=[;\n])/g;
  for (const m of code.matchAll(varRe)) {
    const declKw = m[1];
    const name = m[2];
    // Pull the RHS from the ORIGINAL source so string literals survive
    // (stripCodeNoise blanks them in `code`). The binding `=` is the FIRST
    // `=` in m[0]: the optional type-annotation group above excludes `=`,
    // so anything before it is `export? const|let|var name : Type`.
    const eqIdx = m[0].indexOf('=');
    const rhsStart = m.index + eqIdx + 1;
    const rhsEnd = m.index + m[0].length;
    let rawValue = src.slice(rhsStart, rhsEnd).trim();
    if (rawValue.endsWith(',')) rawValue = rawValue.slice(0, -1).trim();
    const valueKind = classifyValue(rawValue);
    push({
      type: 'variable',
      kind: declKw,
      name,
      value: rawValue || null,
      valueKind,
      canonicalValue: canonicalizeValue(rawValue, valueKind),
      file: filePath,
      line: lineOf(offsets, m.index),
    });
  }

  // ── Destructured bindings: const { a, b: c } = ... / const [x, y] = ...
  // We extract only the bound names; values are not individually attributable.
  const destructObjRe =
    /(?:^|[\n;{(,])\s*(?:export\s+(?:default\s+)?)?(const|let|var)\s+\{([^{}]*?)\}\s*=/g;
  for (const m of code.matchAll(destructObjRe)) {
    const declKw = m[1];
    const inner = m[2];
    const line = lineOf(offsets, m.index);
    for (const part of inner.split(',')) {
      const cleaned = part.trim();
      if (!cleaned) continue;
      // `original: alias` → alias is the binding; `name = default` → name is
      // the binding; `...rest` → rest is the binding.
      let name = cleaned.replace(/^\.\.\./, '');
      name = name.split(':').pop().trim();
      name = name.split('=')[0].trim();
      push({
        type: 'variable',
        kind: declKw,
        name,
        value: null,
        valueKind: 'destructured',
        canonicalValue: null,
        file: filePath,
        line,
      });
    }
  }
  const destructArrRe =
    /(?:^|[\n;{(,])\s*(?:export\s+(?:default\s+)?)?(const|let|var)\s+\[([^\[\]]*?)\]\s*=/g;
  for (const m of code.matchAll(destructArrRe)) {
    const declKw = m[1];
    const inner = m[2];
    const line = lineOf(offsets, m.index);
    for (const part of inner.split(',')) {
      let name = part
        .trim()
        .replace(/^\.\.\./, '')
        .split('=')[0]
        .trim();
      if (!name) continue;
      push({
        type: 'variable',
        kind: declKw,
        name,
        value: null,
        valueKind: 'destructured',
        canonicalValue: null,
        file: filePath,
        line,
      });
    }
  }

  // ── Function declarations: function <name>(...)
  const fnRe =
    /(?:^|[\n;{(,])\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s*(\w+)\s*\(([^)]*)\)/g;
  for (const m of code.matchAll(fnRe)) {
    push({
      type: 'function',
      kind: 'function',
      name: m[1],
      params: m[2].trim(),
      file: filePath,
      line: lineOf(offsets, m.index),
    });
  }

  // ── Class declarations: class <Name> [extends <Parent>]
  const classRe =
    /(?:^|[\n;{(,])\s*(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+([\w.<>]+))?/g;
  for (const m of code.matchAll(classRe)) {
    push({
      type: 'class',
      kind: 'class',
      name: m[1],
      parent: m[2] || null,
      file: filePath,
      line: lineOf(offsets, m.index),
    });
  }

  // ── Imports: parsed into one entry per imported NAME so collisions surface.
  // We match against the ORIGINAL source (not `code`) so the module-string
  // contents survive — stripCodeNoise blanks string interiors.
  const importRe = /^import\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm;
  for (const m of src.matchAll(importRe)) {
    const isType = !!m[1];
    const clause = m[2].replace(/\s+/g, ' ').trim();
    const mod = m[3];
    const line = lineOf(offsets, m.index);
    const pushImport = (name, importKind) => {
      if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) return;
      decls.push({
        type: 'import',
        kind: importKind,
        name,
        module: mod,
        isType,
        file: filePath,
        line,
      });
    };
    const star = clause.match(/^\*\s+as\s+(\w+)$/);
    if (star) {
      pushImport(star[1], 'namespace');
    } else {
      const braceOpen = clause.indexOf('{');
      const braceClose = clause.lastIndexOf('}');
      const beforeBrace = (braceOpen === -1 ? clause : clause.slice(0, braceOpen))
        .replace(/,\s*$/, '')
        .trim();
      if (beforeBrace) pushImport(beforeBrace, 'default');
      if (braceOpen !== -1 && braceClose !== -1) {
        for (const chunk of clause.slice(braceOpen + 1, braceClose).split(',')) {
          const parts = chunk.trim().split(/\s+as\s+/);
          const name = (parts[parts.length - 1] || '').trim();
          if (name) pushImport(name, 'named');
        }
      }
    }
  }

  return decls;
}

// File walker is imported from ../shared/walk.mjs.

// ─── Index building ──────────────────────────────────────────────────────────

/**
 * Build three indexes from the flat list of declarations:
 *
 *   byName       : name → array of declarations (across all files & scopes)
 *   byValue      : canonicalValue → array of declarations (variables w/ value only)
 *   uniqueDefs   : Map keyed by (type|name|canonicalValue) → { decl, occurrences[] }
 *                  An "occurrence" is a file:line. The same name+value in 5 files
 *                  is one definition with 5 occurrences. This is the dedup the
 *                  user asked for.
 */
function buildIndexes(allDecls) {
  const byName = new Map();
  const byValue = new Map();
  const uniqueDefs = new Map();

  for (const d of allDecls) {
    if (!byName.has(d.name)) byName.set(d.name, []);
    byName.get(d.name).push(d);

    if (d.type === 'variable' && d.canonicalValue != null) {
      if (!byValue.has(d.canonicalValue)) byValue.set(d.canonicalValue, []);
      byValue.get(d.canonicalValue).push(d);
    }

    const dedupKey = `${d.type}|${d.name}|${d.canonicalValue ?? ''}`;
    if (!uniqueDefs.has(dedupKey)) {
      uniqueDefs.set(dedupKey, { ...d, occurrences: [] });
    }
    uniqueDefs.get(dedupKey).occurrences.push({ file: d.file, line: d.line });
  }
  return { byName, byValue, uniqueDefs };
}

// ─── Levenshtein with length bucketing ───────────────────────────────────────

function levenshtein(a, b, max = Infinity) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const m = a.length,
    n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1; // early exit
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

// ─── Reports ─────────────────────────────────────────────────────────────────
// ANSI color helpers (dim/bold/yellow/red/green/cyan/magenta) are imported
// from ../shared/ansi.mjs.

function rel(p) {
  return relative(targetDir, p);
}

// ─── Focus-file helpers ──────────────────────────────────────────────────────
// When --focus is set, reports filter to entries that have at least one
// occurrence in the focus file. Lines that ARE in the focus file get marked
// with ★ in the output so the look-alike pair is visually unambiguous.

function isFocusFile(filePath) {
  return focusPath && filePath === focusPath;
}
function focusMark(filePath) {
  return isFocusFile(filePath) ? '\x1b[35m★\x1b[0m ' : '  ';
}
function declHitsFocus(decl) {
  if (!focusPath) return false;
  if (decl.file === focusPath) return true;
  if (Array.isArray(decl.occurrences)) {
    return decl.occurrences.some((o) => o.file === focusPath);
  }
  return false;
}

function fmtOcc(occ) {
  return `${rel(occ.file)}:${occ.line}`;
}

function summariseOccurrences(occurrences) {
  let display = occurrences;
  if (focusPath) {
    // Surface focus-file occurrences first so the look-alike pair reads
    // as "focus line ↔ alternates" rather than an arbitrary order.
    const focusOcc = occurrences.filter((o) => o.file === focusPath);
    const otherOcc = occurrences.filter((o) => o.file !== focusPath);
    display = [...focusOcc, ...otherOcc];
  }
  const first = display[0];
  const mark = isFocusFile(first.file) ? '\x1b[35m★ \x1b[0m' : '';
  if (display.length === 1) return mark + fmtOcc(first);
  return `${mark}${fmtOcc(first)} ${dim(`(+${display.length - 1} more)`)}`;
}

function isNoisy(name) {
  if (showNoise) return false;
  if (name.length === 1) return true;
  return NOISY_NAMES.has(name);
}

// ─── Report 1: Name collisions ───────────────────────────────────────────────

function renderNameCollisions(uniqueDefs, byName) {
  const out = [];
  out.push('');
  out.push(bold(cyan('══ Name collisions: same name, different definitions ══')));
  out.push(
    dim('  A name maps to >1 distinct (type, value) pair. Bigger N = more confusion potential.')
  );
  out.push('');

  // Group unique-defs by (type, name). When a name has N>1 distinct defs of
  // the same type, report it. We split by type so that `class Foo` and
  // `const Foo = ...` show up under the same name section but as separate
  // type rows.
  const byTypeName = new Map();
  for (const def of uniqueDefs.values()) {
    const key = `${def.type}|${def.name}`;
    if (!byTypeName.has(key)) byTypeName.set(key, []);
    byTypeName.get(key).push(def);
  }

  // Also include cross-type collisions: same name, multiple types
  // (e.g. class PaymentError + const PaymentError).
  const namesByType = new Map();
  for (const def of uniqueDefs.values()) {
    if (!namesByType.has(def.name)) namesByType.set(def.name, new Set());
    namesByType.get(def.name).add(def.type);
  }

  const rows = [];
  for (const [key, defs] of byTypeName) {
    if (defs.length < minCollision) continue;
    const [type, name] = key.split('|');
    if (isNoisy(name)) continue;
    rows.push({ name, type, defs });
  }
  // Cross-type collisions (e.g. PaymentError as class + as variable) are
  // separate rows tagged 'mixed-type'.
  for (const [name, types] of namesByType) {
    if (types.size < 2) continue;
    if (isNoisy(name)) continue;
    const defs = [...uniqueDefs.values()].filter((d) => d.name === name);
    rows.push({ name, type: 'mixed-type', defs });
  }

  rows.sort((a, b) => b.defs.length - a.defs.length || a.name.localeCompare(b.name));

  // When focused: drop rows that don't involve the focus file, and within
  // each surviving row, render focus-file defs first.
  let filtered = rows;
  if (focusPath) {
    filtered = rows
      .filter((r) => r.defs.some(declHitsFocus))
      .map((r) => {
        const focusDefs = r.defs.filter(declHitsFocus);
        const otherDefs = r.defs.filter((d) => !declHitsFocus(d));
        return { ...r, defs: [...focusDefs, ...otherDefs] };
      });
  }

  if (filtered.length === 0) {
    out.push(
      '  ' +
        green(
          focusPath
            ? '✓ No name collisions involving the focus file.'
            : '✓ No name collisions found.'
        )
    );
    return out;
  }

  for (const row of filtered) {
    out.push(`  ${yellow(`[${row.defs.length}]`)} ${bold(row.name)}  ${dim(`(${row.type})`)}`);
    for (const def of row.defs) {
      const valueDesc =
        def.type === 'variable'
          ? (def.value ?? `(destructured/${def.valueKind})`)
          : def.type === 'function'
            ? `function(${def.params || ''})`
            : def.type === 'class'
              ? def.parent
                ? `class extends ${def.parent}`
                : 'class'
              : def.type === 'method'
                ? 'method'
                : def.type === 'import'
                  ? `import from '${def.module}'`
                  : '?';
      const truncated = valueDesc.length > 60 ? valueDesc.slice(0, 57) + '...' : valueDesc;
      out.push(`     ${cyan(truncated.padEnd(60))}  ${summariseOccurrences(def.occurrences)}`);
    }
    out.push('');
  }
  out.push(
    dim(`  ${filtered.length} colliding name(s) shown${focusPath ? ' involving focus file' : ''}.`)
  );
  return out;
}

// ─── Report 2: Value collisions ──────────────────────────────────────────────

function renderValueCollisions(byValue) {
  const out = [];
  out.push('');
  out.push(bold(cyan('══ Value collisions: same value, different names ══')));
  out.push(dim('  A literal value bound to >1 distinct name. Strong consolidation candidate.'));
  out.push('');

  const rows = [];
  for (const [value, decls] of byValue) {
    if (NOISY_VALUES.has(value)) continue;
    if (value === null || value === '') continue;
    // Group by name to count distinct bindings.
    const byNameLocal = new Map();
    for (const d of decls) {
      if (isNoisy(d.name)) continue;
      if (!byNameLocal.has(d.name)) byNameLocal.set(d.name, []);
      byNameLocal.get(d.name).push(d);
    }
    if (byNameLocal.size < minCollision) continue;
    rows.push({ value, names: [...byNameLocal.entries()] });
  }
  rows.sort((a, b) => b.names.length - a.names.length);

  // When focused: drop rows where no binding is in the focus file, and
  // sort surviving names so focus bindings render first.
  let filtered = rows;
  if (focusPath) {
    filtered = rows
      .filter((r) => r.names.some(([_n, decls]) => decls.some((d) => d.file === focusPath)))
      .map((r) => {
        const sorted = [...r.names].sort((a, b) => {
          const aF = a[1].some((d) => d.file === focusPath) ? 0 : 1;
          const bF = b[1].some((d) => d.file === focusPath) ? 0 : 1;
          return aF - bF || b[1].length - a[1].length;
        });
        return { ...r, names: sorted };
      });
  }

  if (filtered.length === 0) {
    out.push(
      '  ' +
        green(
          focusPath
            ? '✓ No value collisions involving the focus file.'
            : '✓ No value collisions found.'
        )
    );
    return out;
  }

  for (const row of filtered) {
    const dispValue = row.value.length > 50 ? row.value.slice(0, 47) + '...' : row.value;
    out.push(`  ${yellow(`[${row.names.length}]`)} ${bold(dispValue)}`);
    for (const [name, decls] of row.names) {
      const more = decls.length > 1 ? dim(` (×${decls.length})`) : '';
      const first = decls[0];
      out.push(
        `     ${cyan(name.padEnd(28))}${more}  ${first.type}  ${summariseOccurrences(decls.map((d) => ({ file: d.file, line: d.line })))}`
      );
    }
    out.push('');
  }
  out.push(
    dim(`  ${filtered.length} colliding value(s) shown${focusPath ? ' involving focus file' : ''}.`)
  );
  return out;
}

// ─── Report 3: Color near-matches ────────────────────────────────────────────

function renderColorNearMatches(allDecls) {
  const out = [];
  out.push('');
  out.push(bold(cyan(`══ Color near-matches: RGB distance ≤ ${colorDistance} ══`)));
  out.push(dim('  Pairs of distinct color values close enough to be visually identical.'));
  out.push('');

  // Collect every color binding.
  const colorDecls = allDecls.filter(
    (d) => d.type === 'variable' && d.valueKind === 'color' && d.canonicalValue
  );
  // Group by canonical hex so we have one entry per unique color.
  const byHex = new Map();
  for (const d of colorDecls) {
    if (!byHex.has(d.canonicalValue)) byHex.set(d.canonicalValue, []);
    byHex.get(d.canonicalValue).push(d);
  }

  // Hex → RGB lookup.
  const colors = [];
  for (const [hex, decls] of byHex) {
    const rgb = tryParseColor(hex);
    if (!rgb) continue;
    const names = [...new Set(decls.map((d) => d.name))];
    colors.push({ hex, rgb, names, decls });
  }

  // O(N²) pairwise — fine when N is in the hundreds. Bigger projects can raise
  // --color-distance to 0 to disable, or we'd need spatial bucketing.
  const pairs = [];
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      const d = colorDistanceRgb(colors[i].rgb, colors[j].rgb);
      if (d > 0 && d <= colorDistance) pairs.push({ a: colors[i], b: colors[j], distance: d });
    }
  }
  pairs.sort((a, b) => a.distance - b.distance);

  // When focused: keep only pairs where at least one side has a binding
  // in the focus file.
  let filtered = pairs;
  if (focusPath) {
    filtered = pairs.filter(
      (p) =>
        p.a.decls.some((d) => d.file === focusPath) || p.b.decls.some((d) => d.file === focusPath)
    );
  }

  if (filtered.length === 0) {
    out.push(
      '  ' +
        green(
          focusPath ? '✓ No close color pairs involving the focus file.' : '✓ No close color pairs.'
        )
    );
    return out;
  }

  for (const p of filtered) {
    const aTag = `${p.a.hex} (${p.a.names.join(', ')})`;
    const bTag = `${p.b.hex} (${p.b.names.join(', ')})`;
    out.push(`  ${yellow(`Δ=${p.distance.toFixed(1)}`)}  ${bold(aTag)}  ↔  ${bold(bTag)}`);
    // List bindings for both sides; prefix focus-file lines with ★.
    const allDeclsHere = [...p.a.decls, ...p.b.decls];
    if (focusPath) {
      allDeclsHere.sort(
        (a, b) => (a.file === focusPath ? -1 : 0) - (b.file === focusPath ? -1 : 0)
      );
    }
    for (const d of allDeclsHere) {
      out.push(`   ${focusMark(d.file)}${dim(rel(d.file) + ':' + d.line)}  ${d.name} = ${d.value}`);
    }
    out.push('');
  }
  out.push(
    dim(`  ${filtered.length} close color pair(s)${focusPath ? ' involving focus file' : ''}.`)
  );
  return out;
}

// ─── Report 4: Name similarities ─────────────────────────────────────────────

function renderNameSimilarities(uniqueDefs) {
  const out = [];
  out.push('');
  out.push(bold(cyan(`══ Name similarities: edit distance ≤ ${nameDistance} ══`)));
  out.push(dim('  Identifiers that differ by ≤N edits. Catches typos and parallel naming.'));
  out.push('');

  // Pull a deduplicated set of names (across all definitions). One entry per
  // distinct identifier, with all its definition kinds attached.
  const nameToDefs = new Map();
  for (const def of uniqueDefs.values()) {
    if (isNoisy(def.name)) continue;
    if (!nameToDefs.has(def.name)) nameToDefs.set(def.name, []);
    nameToDefs.get(def.name).push(def);
  }
  const names = [...nameToDefs.keys()].filter((n) => n.length >= 4); // tiny names = noise

  // Bucket by length to keep the comparison tractable.
  const byLen = new Map();
  for (const n of names) {
    if (!byLen.has(n.length)) byLen.set(n.length, []);
    byLen.get(n.length).push(n);
  }

  const seen = new Set();
  const pairs = [];
  function addPair(a, b, d) {
    const key = a < b ? a + '|' + b : b + '|' + a;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ a, b, distance: d });
  }
  for (const [len, group] of byLen) {
    // Within length L
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const d = levenshtein(group[i], group[j], nameDistance);
        if (d > 0 && d <= nameDistance) addPair(group[i], group[j], d);
      }
    }
    // Cross length L vs L+1
    const next = byLen.get(len + 1);
    if (next) {
      for (const a of group) {
        for (const b of next) {
          const d = levenshtein(a, b, nameDistance);
          if (d > 0 && d <= nameDistance) addPair(a, b, d);
        }
      }
    }
  }
  pairs.sort((a, b) => a.distance - b.distance || a.a.localeCompare(b.a));

  // When focused: keep only pairs where at least one of the two names has
  // a definition in the focus file. Reorder definitions within each pair
  // so focus-file lines come first.
  let filtered = pairs;
  if (focusPath) {
    const nameInFocus = (name) => (nameToDefs.get(name) || []).some(declHitsFocus);
    filtered = pairs.filter((p) => nameInFocus(p.a) || nameInFocus(p.b));
  }

  if (filtered.length === 0) {
    out.push(
      '  ' +
        green(
          focusPath
            ? '✓ No similar-name pairs involving the focus file.'
            : '✓ No similar-name pairs.'
        )
    );
    return out;
  }

  for (const p of filtered) {
    out.push(`  ${yellow(`d=${p.distance}`)}  ${bold(p.a)}  ${dim('↔')}  ${bold(p.b)}`);
    // Order names so the focus-bearing one renders first.
    const orderedNames = focusPath
      ? [p.a, p.b].sort((x, y) => {
          const xF = (nameToDefs.get(x) || []).some(declHitsFocus) ? 0 : 1;
          const yF = (nameToDefs.get(y) || []).some(declHitsFocus) ? 0 : 1;
          return xF - yF;
        })
      : [p.a, p.b];
    for (const name of orderedNames) {
      const defs = nameToDefs.get(name) || [];
      // Within a name, surface the focus-file occurrence first.
      const orderedDefs = focusPath
        ? [...defs].sort((x, y) => (declHitsFocus(x) ? -1 : 0) - (declHitsFocus(y) ? -1 : 0))
        : defs;
      for (const def of orderedDefs) {
        // Pick the focus occurrence if there is one, else the first.
        const occ = focusPath
          ? def.occurrences.find((o) => o.file === focusPath) || def.occurrences[0]
          : def.occurrences[0];
        const valDesc =
          def.type === 'variable'
            ? (def.value ?? `(${def.valueKind})`)
            : def.type === 'function'
              ? `function(${def.params || ''})`
              : def.type === 'class'
                ? 'class'
                : def.type === 'import'
                  ? `import from '${def.module}'`
                  : def.type;
        const trunc = valDesc.length > 50 ? valDesc.slice(0, 47) + '...' : valDesc;
        out.push(
          `   ${focusMark(occ.file)}${name.padEnd(30)} ${cyan(trunc.padEnd(50))} ${dim(rel(occ.file) + ':' + occ.line)}`
        );
      }
    }
    out.push('');
  }
  out.push(dim(`  ${filtered.length} similar pair(s)${focusPath ? ' involving focus file' : ''}.`));
  return out;
}

// ─── Report 5: Inventory summary ─────────────────────────────────────────────

function renderInventorySummary(allDecls, uniqueDefs) {
  const out = [];
  out.push('');
  out.push(bold(cyan('══ Inventory summary ══')));
  out.push('');

  const counts = { variable: 0, function: 0, class: 0, method: 0, import: 0 };
  for (const d of allDecls) counts[d.type] = (counts[d.type] || 0) + 1;

  const uniqueCounts = { variable: 0, function: 0, class: 0, method: 0, import: 0 };
  for (const d of uniqueDefs.values()) uniqueCounts[d.type] = (uniqueCounts[d.type] || 0) + 1;

  for (const k of Object.keys(counts)) {
    const total = counts[k];
    const unique = uniqueCounts[k] || 0;
    out.push(
      `  ${bold(k.padEnd(10))}  total: ${String(total).padStart(6)}   unique by (name,value): ${String(unique).padStart(6)}`
    );
  }
  return out;
}

// ─── Report 6: Full inventory dump (opt-in via --inventory) ──────────────────

function renderFullInventory(uniqueDefs) {
  const out = [];
  out.push('');
  out.push(bold(cyan('══ Full inventory ══')));
  out.push(dim('  Every (type, name, canonical-value) triple, with all occurrences.'));
  out.push('');
  const defs = [...uniqueDefs.values()].sort((a, b) => {
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return a.name.localeCompare(b.name);
  });
  let lastType = '';
  for (const d of defs) {
    if (d.type !== lastType) {
      out.push('');
      out.push(bold(`-- ${d.type}s --`));
      lastType = d.type;
    }
    if (d.occurrences.length < minOccurrences) continue;
    const valDesc =
      d.type === 'variable'
        ? (d.value ?? `(${d.valueKind})`)
        : d.type === 'function'
          ? `function(${d.params || ''})`
          : d.type === 'class'
            ? 'class'
            : d.type === 'import'
              ? `from '${d.module}'`
              : d.type;
    const truncated = valDesc.length > 60 ? valDesc.slice(0, 57) + '...' : valDesc;
    out.push(
      `  ${d.name.padEnd(30)} ${cyan(truncated.padEnd(60))} ${dim('×' + d.occurrences.length)} ${dim(fmtOcc(d.occurrences[0]))}`
    );
  }
  return out;
}

// ─── --by-name / --by-value / --dump handlers ────────────────────────────────

function renderByName(name, byName) {
  const out = [];
  out.push('');
  out.push(bold(cyan(`══ All definitions matching '${name}' ══`)));
  out.push('');
  const decls = byName.get(name);
  if (!decls || decls.length === 0) {
    out.push('  (no matches)');
    return out;
  }
  for (const d of decls) {
    const desc =
      d.type === 'variable'
        ? `${d.kind} ${d.name} = ${d.value ?? `(${d.valueKind})`}`
        : d.type === 'function'
          ? `function ${d.name}(${d.params || ''})`
          : d.type === 'class'
            ? `class ${d.name}${d.parent ? ' extends ' + d.parent : ''}`
            : d.type === 'import'
              ? `import { ${d.name} } from '${d.module}'${d.isType ? ' [type]' : ''}`
              : d.type;
    const trunc = desc.length > 80 ? desc.slice(0, 77) + '...' : desc;
    out.push(`  ${trunc.padEnd(80)}  ${dim(rel(d.file) + ':' + d.line)}`);
  }
  return out;
}

function renderByValue(value, byValue) {
  const out = [];
  out.push('');
  out.push(bold(cyan(`══ All bindings with canonical value '${value}' ══`)));
  out.push('');
  // The user typed a raw value; canonicalize it the same way we did the index.
  const guessKind = classifyValue(
    value.startsWith('#') || value.startsWith('rgb') ? `'${value}'` : value
  );
  const canon =
    canonicalizeValue(
      value.startsWith('#') || value.startsWith('rgb') ? `'${value}'` : value,
      guessKind === 'unknown' ? 'string' : guessKind
    ) || value;
  const decls = byValue.get(canon) || byValue.get(value);
  if (!decls || decls.length === 0) {
    out.push(`  (no matches; tried canonical '${canon}')`);
    return out;
  }
  for (const d of decls) {
    out.push(`  ${d.kind} ${d.name.padEnd(28)} = ${d.value}  ${dim(rel(d.file) + ':' + d.line)}`);
  }
  return out;
}

function renderDump(category, allDecls, uniqueDefs) {
  const out = [];
  const want = category.replace(/s$/, '');
  if (want === 'value') {
    // alphabetised by canonical value
    const set = new Set();
    for (const d of allDecls) {
      if (d.type === 'variable' && d.canonicalValue) set.add(d.canonicalValue);
    }
    [...set].sort().forEach((v) => out.push(v));
    return out;
  }
  // alphabetised by name within a type
  const seen = new Set();
  for (const d of uniqueDefs.values()) {
    if (d.type !== want) continue;
    if (seen.has(d.name)) continue;
    seen.add(d.name);
  }
  [...seen].sort().forEach((n) => out.push(n));
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

const files = walkFiles(targetDir, { includeTests });
const allDecls = [];
for (const f of files) {
  let src;
  try {
    src = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  for (const d of extractDeclarations(src, f)) allDecls.push(d);
}
const { byName, byValue, uniqueDefs } = buildIndexes(allDecls);

if (showJson) {
  // JSON output: every report as structured data. Useful for piping into jq.
  const jsonOut = {
    target: targetArg || '.',
    files: files.length,
    counts: {
      total: allDecls.length,
      unique: uniqueDefs.size,
      byType: {},
    },
    nameCollisions: [],
    valueCollisions: [],
    colorNear: [],
    nameSimilarities: [],
    focus: focusPath ? rel(focusPath) : null,
  };
  for (const d of allDecls) {
    jsonOut.counts.byType[d.type] = (jsonOut.counts.byType[d.type] || 0) + 1;
  }
  // Name collisions
  const byTypeName = new Map();
  for (const def of uniqueDefs.values()) {
    const k = `${def.type}|${def.name}`;
    if (!byTypeName.has(k)) byTypeName.set(k, []);
    byTypeName.get(k).push(def);
  }
  for (const [k, defs] of byTypeName) {
    if (defs.length < minCollision) continue;
    const [type, name] = k.split('|');
    if (isNoisy(name)) continue;
    if (focusPath && !defs.some(declHitsFocus)) continue;
    jsonOut.nameCollisions.push({
      name,
      type,
      count: defs.length,
      definitions: defs.map((d) => ({
        value: d.value ?? null,
        canonicalValue: d.canonicalValue ?? null,
        valueKind: d.valueKind ?? null,
        params: d.params ?? null,
        parent: d.parent ?? null,
        module: d.module ?? null,
        inFocus: declHitsFocus(d),
        occurrences: d.occurrences.map((o) => ({ file: rel(o.file), line: o.line })),
      })),
    });
  }
  // Value collisions
  for (const [value, decls] of byValue) {
    if (NOISY_VALUES.has(value)) continue;
    const names = new Map();
    for (const d of decls) {
      if (isNoisy(d.name)) continue;
      if (!names.has(d.name)) names.set(d.name, []);
      names
        .get(d.name)
        .push({ file: rel(d.file), line: d.line, type: d.type, inFocus: d.file === focusPath });
    }
    if (names.size < minCollision) continue;
    if (focusPath && ![...names.values()].some((occ) => occ.some((o) => o.inFocus))) continue;
    jsonOut.valueCollisions.push({
      value,
      count: names.size,
      bindings: [...names].map(([n, occ]) => ({ name: n, occurrences: occ })),
    });
  }
  // Color near
  const colorDecls = allDecls.filter(
    (d) => d.type === 'variable' && d.valueKind === 'color' && d.canonicalValue
  );
  const byHex = new Map();
  for (const d of colorDecls) {
    if (!byHex.has(d.canonicalValue)) byHex.set(d.canonicalValue, []);
    byHex.get(d.canonicalValue).push(d);
  }
  const colors = [];
  for (const [hex, decls] of byHex) {
    const rgb = tryParseColor(hex);
    if (rgb) colors.push({ hex, rgb, decls });
  }
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      const d = colorDistanceRgb(colors[i].rgb, colors[j].rgb);
      if (d > 0 && d <= colorDistance) {
        const aHasFocus = colors[i].decls.some((x) => x.file === focusPath);
        const bHasFocus = colors[j].decls.some((x) => x.file === focusPath);
        if (focusPath && !aHasFocus && !bHasFocus) continue;
        jsonOut.colorNear.push({
          a: colors[i].hex,
          b: colors[j].hex,
          distance: +d.toFixed(2),
          aBindings: colors[i].decls.map((x) => ({
            name: x.name,
            file: rel(x.file),
            line: x.line,
            inFocus: x.file === focusPath,
          })),
          bBindings: colors[j].decls.map((x) => ({
            name: x.name,
            file: rel(x.file),
            line: x.line,
            inFocus: x.file === focusPath,
          })),
        });
      }
    }
  }
  console.log(JSON.stringify(jsonOut, null, 2));
} else if (byNameQuery) {
  console.log(renderByName(byNameQuery, byName).join('\n'));
} else if (byValueQuery) {
  console.log(renderByValue(byValueQuery, byValue).join('\n'));
} else if (dumpCategory) {
  console.log(renderDump(dumpCategory, allDecls, uniqueDefs).join('\n'));
} else {
  // Default terminal mode
  console.log(targetArg || '.');
  console.log(
    dim(
      `  ${files.length} files scanned, ${allDecls.length} declarations extracted, ${uniqueDefs.size} unique`
    )
  );

  if (focusPath) {
    // The focus banner makes it obvious what the reports below are filtered to.
    // The summary helps the user orient: "of theme.ts's 47 definitions, 12
    // collide with stuff elsewhere — here they are."
    const focusDecls = allDecls.filter((d) => d.file === focusPath);
    const counts = { variable: 0, function: 0, class: 0, method: 0, import: 0 };
    for (const d of focusDecls) counts[d.type] = (counts[d.type] || 0) + 1;
    console.log('');
    console.log(bold(cyan('══ Focus ══')));
    console.log(`  ${bold('★ ' + rel(focusPath))}`);
    console.log(
      dim(
        `  ${focusDecls.length} declarations in this file: ` +
          `${counts.variable} variables, ${counts.function} functions, ` +
          `${counts.class} classes, ${counts.import} imports`
      )
    );
    console.log(dim('  Reports below are filtered to look-alikes that involve this file.'));
  }

  console.log(renderInventorySummary(allDecls, uniqueDefs).join('\n'));
  if (showCollisions) console.log(renderNameCollisions(uniqueDefs, byName).join('\n'));
  if (showCollisions) console.log(renderValueCollisions(byValue).join('\n'));
  if (showColorNear) console.log(renderColorNearMatches(allDecls).join('\n'));
  if (showNameNear) console.log(renderNameSimilarities(uniqueDefs).join('\n'));
  if (showInventory) console.log(renderFullInventory(uniqueDefs).join('\n'));
}
