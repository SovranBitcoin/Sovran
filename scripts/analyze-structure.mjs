#!/usr/bin/env node

/**
 * analyze-structure.mjs
 *
 * Walks the project tree and annotates every JS/TS file with its exports:
 * default exports, named exports, React components, hooks, types, constants.
 *
 * Usage:
 *   node scripts/analyze-structure.mjs              # whole project
 *   node scripts/analyze-structure.mjs app          # subtree
 *   node scripts/analyze-structure.mjs components/screens
 *   node scripts/analyze-structure.mjs --imports    # also show imports per file
 *   node scripts/analyze-structure.mjs --loc        # show code/blank/comment breakdown per file
 *   node scripts/analyze-structure.mjs --no-types   # hide type/interface exports
 *   node scripts/analyze-structure.mjs --no-ext     # hide external package imports
 *   node scripts/analyze-structure.mjs --json       # machine-readable JSON
 *
 * Dependency analysis flags:
 *   node scripts/analyze-structure.mjs --fanin              # reverse dependency ranking
 *   node scripts/analyze-structure.mjs --fanin --fanin-min 3  # only show fanin >= 3
 *   node scripts/analyze-structure.mjs --coupling           # inter-folder dependency matrix
 *   node scripts/analyze-structure.mjs --coupling-depth 2   # folder depth for coupling (default: 1)
 *   node scripts/analyze-structure.mjs --cycles             # circular import detection
 *   node scripts/analyze-structure.mjs --orphans            # files never imported by anything
 *   node scripts/analyze-structure.mjs --colocate           # suggest file moves based on importer distribution
 *   node scripts/analyze-structure.mjs --colocate-threshold 0.8  # importer % threshold (default: 0.7)
 *   node scripts/analyze-structure.mjs --boundary features/mints features/payments  # cross-boundary report
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join, extname, basename, relative, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ─── Config ──────────────────────────────────────────────────────────────────

const IGNORE_DIRS = new Set([
  'node_modules', 'ios', 'android', 'dist', '.git', 'coco',
  'sovran.money', 'targets', '.expo', 'build', 'coverage',
  'screenshots-output', '.cursor',
]);

const IGNORE_FILES = new Set([
  'package-lock.json', 'yarn.lock',
]);

const TS_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.jsx']);

// Extensions to try when resolving imports (in order)
const RESOLVE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const showJson     = args.includes('--json');
const hideTypes    = args.includes('--no-types');
const hideSame     = args.includes('--no-reexport');
const showImports  = args.includes('--imports');
const hideExternal = args.includes('--no-ext');
const showLoc      = args.includes('--loc');

// New dependency analysis flags
const showFanin    = args.includes('--fanin');
const showCoupling = args.includes('--coupling');
const showCycles   = args.includes('--cycles');
const showOrphans  = args.includes('--orphans');
const showColocate = args.includes('--colocate');

// --boundary <folderA> <folderB>
const boundaryIdx  = args.indexOf('--boundary');
let boundaryA = null;
let boundaryB = null;
if (boundaryIdx !== -1) {
  // Grab the next two non-flag args after --boundary
  const remaining = args.slice(boundaryIdx + 1).filter(a => !a.startsWith('--'));
  boundaryA = remaining[0] || null;
  boundaryB = remaining[1] || null;
  if (!boundaryA || !boundaryB) {
    console.error('Error: --boundary requires two folder paths, e.g. --boundary features/mints features/payments');
    process.exit(1);
  }
}

// Numeric options
function getNumericArg(flag, defaultVal) {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  const val = parseFloat(args[idx + 1]);
  return isNaN(val) ? defaultVal : val;
}

const faninMin          = getNumericArg('--fanin-min', 1);
const couplingDepth     = getNumericArg('--coupling-depth', 1);
const colocateThreshold = getNumericArg('--colocate-threshold', 0.7);

// Target directory — skip all flags and their value args
const flagsWithValue = new Set(['--fanin-min', '--coupling-depth', '--colocate-threshold', '--boundary']);
const allFlags = new Set([
  '--json', '--no-types', '--no-reexport', '--imports', '--no-ext', '--loc',
  '--fanin', '--coupling', '--cycles', '--orphans', '--colocate',
  '--fanin-min', '--coupling-depth', '--colocate-threshold', '--boundary',
]);

let targetArg = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (allFlags.has(a)) {
    if (flagsWithValue.has(a)) i++; // skip value
    if (a === '--boundary') i += 2; // skip two values
    continue;
  }
  if (!a.startsWith('--')) {
    targetArg = a;
    break;
  }
}
const targetDir = targetArg ? join(ROOT, targetArg) : ROOT;

// Whether any analysis mode is active
const anyAnalysis = showFanin || showCoupling || showCycles || showOrphans || showColocate || !!boundaryA;

// ─── Import path resolution ──────────────────────────────────────────────────

/**
 * Attempt to resolve an import specifier to an absolute file path.
 * Returns null for external (node_modules) packages.
 */
function resolveImport(importPath, fromFile) {
  let base;

  if (importPath.startsWith('.')) {
    // Relative import — resolve against the importing file's directory
    base = resolve(dirname(fromFile), importPath);
  } else if (importPath.startsWith('@/')) {
    // Alias — resolve against ROOT
    base = resolve(ROOT, importPath.slice(2));
  } else if (!importPath.startsWith('@') && !importPath.includes('/')) {
    // Bare specifier like 'react' — external
    return null;
  } else if (importPath.startsWith('@') && !importPath.startsWith('@/')) {
    // Scoped package like @cashu/cashu-ts — check if it resolves in project
    // Try as a project-relative path first (some projects use bare paths)
    base = resolve(ROOT, importPath);
    if (!tryResolveFile(base)) {
      return null; // It's an external scoped package
    }
  } else {
    // Bare path like 'components/ui/Text' — resolve against ROOT
    base = resolve(ROOT, importPath);
  }

  return tryResolveFile(base);
}

/**
 * Try to find the actual file for a base path by checking extensions and index files.
 */
function tryResolveFile(base) {
  // Exact match
  if (existsSync(base) && isFile(base)) return base;

  // Try with extensions
  for (const ext of RESOLVE_EXTS) {
    const candidate = base + ext;
    if (existsSync(candidate) && isFile(candidate)) return candidate;
  }

  return null;
}

function isFile(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}

// ─── LOC counting (cloc-style: blank / comment / code) ───────────────────────

function countLines(src) {
  const lines = src.split('\n');
  let blank = 0, comment = 0, code = 0;
  let inBlock = false;

  for (const raw of lines) {
    const t = raw.trim();

    if (t === '') { blank++; continue; }

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

    if (t.startsWith('//')) { comment++; continue; }

    code++;
    const openIdx = t.indexOf('/*');
    if (openIdx !== -1) {
      const closeIdx = t.indexOf('*/', openIdx + 2);
      if (closeIdx === -1) inBlock = true;
    }
  }

  return { total: lines.length, code, blank, comment };
}

// ─── Export extraction (regex-based, no AST dependency) ──────────────────────

function extractExports(src, filePath) {
  const results = [];

  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*/g, '');

  const add = (kind, name, tag) => results.push({ kind, name, tag });

  // ── default exports ──
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
    if (!results.some(r => r.kind === 'default' && r.name.endsWith(m[1] + ')'))) {
      add('default', m[1], classify(m[1], 'value'));
    }
  }

  // ── named exports ──
  for (const m of stripped.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)) {
    add('named', m[1], classify(m[1], 'fn'));
  }
  for (const m of stripped.matchAll(/^export\s+(?:const|let|var)\s+(\w+)/gm)) {
    const idx = m.index + m[0].length;
    const rest = stripped.slice(idx, idx + 120);
    const isArrowComponent = /=\s*(?:React\.memo\(|React\.forwardRef\(|\([\w,\s:={}[\]]*\)\s*(?::\s*\w[\w.<>|&, ]*?)?\s*=>)/.test(rest);
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
    for (const m of stripped.matchAll(/^export\s+type\s+\{([^}]+)\}/gm)) {
      for (const name of m[1].split(',').map(s => s.trim().replace(/\s+as\s+\w+/, '').trim()).filter(Boolean)) {
        add('type', name, 'type');
      }
    }
  }

  for (const m of stripped.matchAll(/^export\s+\{([^}]+)\}/gm)) {
    for (const chunk of m[1].split(',')) {
      const parts = chunk.trim().split(/\s+as\s+/);
      const name = (parts[parts.length - 1] || '').trim();
      if (name && /^\w+$/.test(name)) {
        add('named', name, classify(name, 'reexport'));
      }
    }
  }

  for (const m of stripped.matchAll(/^export\s+\*\s+from\s+['"]([^'"]+)['"]/gm)) {
    add('reexport', `* from '${m[1]}'`, 'reexport');
  }

  const seen = new Set();
  return results.filter(r => {
    const key = `${r.kind}:${r.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Import extraction ────────────────────────────────────────────────────────

function extractImports(src) {
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length))
    .replace(/\/\/.*/g, '');

  const byModule = new Map();

  const RE = /^import\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm;

  for (const m of stripped.matchAll(RE)) {
    const isType   = !!m[1];
    const clause   = m[2].replace(/\s+/g, ' ').trim();
    const mod      = m[3];
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

    const braceOpen  = clause.indexOf('{');
    const braceClose = clause.lastIndexOf('}');

    const beforeBrace = (braceOpen === -1 ? clause : clause.slice(0, braceOpen))
      .replace(/,\s*$/, '').trim();

    if (beforeBrace) entry.names.push(beforeBrace);

    if (braceOpen !== -1 && braceClose !== -1) {
      const inside = clause.slice(braceOpen + 1, braceClose);
      for (const chunk of inside.split(',')) {
        const parts = chunk.trim().split(/\s+as\s+/);
        const name  = (parts[parts.length - 1] || '').trim();
        if (name) entry.names.push(name);
      }
    }
  }

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
  hook:      'ʰ',
  fn:        'ƒ',
  wrapped:   '⚛',
  class:     '◆',
  type:      '⊤',
  interface: '⊤',
  const:     '·',
  constant:  '·',
  value:     '·',
  reexport:  '↗',
  default:   '·',
};

const KIND_LABEL = {
  default:  '[default]',
  named:    '[export]',
  type:     '[type]',
  reexport: '[re-export]',
};

function formatExport(exp) {
  const icon  = ICONS[exp.tag] || '·';
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
  const mod    = imp.module;
  const names  = imp.names;

  let nameStr;
  if (names.length === 0) {
    nameStr = '(side-effect)';
  } else if (names.length <= MAX_NAMES) {
    nameStr = `{ ${names.join(', ')} }`;
  } else {
    nameStr = `{ ${names.slice(0, MAX_NAMES).join(', ')}, +${names.length - MAX_NAMES} more }`;
  }

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

  const filtered = entries.filter(e => {
    if (e.startsWith('.')) return false;
    if (IGNORE_DIRS.has(e)) return false;
    if (IGNORE_FILES.has(e)) return false;
    return true;
  });

  const nodes = [];

  filtered.forEach((entry, idx) => {
    const fullPath = join(dirPath, entry);
    const isLast   = idx === filtered.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const childPfx  = prefix + (isLast ? '    ' : '│   ');

    let stat;
    try { stat = statSync(fullPath); } catch { return; }

    if (stat.isDirectory()) {
      const children = walk(fullPath, childPfx);
      nodes.push({ type: 'dir', name: entry, connector, prefix, children });
    } else if (TS_EXTS.has(extname(entry))) {
      let exports = [];
      let imports = [];
      let loc = { total: 0, code: 0, blank: 0, comment: 0 };
      try {
        const src = readFileSync(fullPath, 'utf8');
        exports = extractExports(src, fullPath);
        imports = extractImports(src);
        loc = countLines(src);
      } catch { /* skip unreadable */ }

      nodes.push({
        type: 'file', name: entry, connector, prefix, childPfx,
        exports, imports, loc,
        fullPath, // needed for dependency analysis
      });
    } else {
      nodes.push({ type: 'other', name: entry, connector, prefix });
    }
  });

  return nodes;
}

// ─── Render ───────────────────────────────────────────────────────────────────

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
        ? (node.imports || []).filter(i => !(hideExternal && i.isExternal))
        : [];

      const exps = node.exports.filter(e => {
        if (hideSame && e.kind === 'named' && e.tag === 'reexport') return false;
        return true;
      });

      const all = [
        ...imps.map(i => ({ _imp: true, i })),
        ...exps.map(e => ({ _imp: false, e })),
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

// ─── JSON output ──────────────────────────────────────────────────────────────

function toJson(nodes, dirPath) {
  return nodes.map(node => {
    if (node.type === 'dir') {
      return { type: 'dir', name: node.name, children: toJson(node.children, join(dirPath, node.name)) };
    }
    if (node.type === 'file') {
      return { type: 'file', name: node.name, fullPath: node.fullPath, loc: node.loc || null, imports: node.imports || [], exports: node.exports };
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
      totals.files   += sub.files;
      totals.code    += sub.code;
      totals.blank   += sub.blank;
      totals.comment += sub.comment;
      totals.total   += sub.total;
    } else if (node.type === 'file' && node.loc) {
      totals.files++;
      totals.code    += node.loc.code;
      totals.blank   += node.loc.blank;
      totals.comment += node.loc.comment;
      totals.total   += node.loc.total;
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
// DEPENDENCY ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Collect all TS/JS file nodes from the tree into a flat array.
 */
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

/**
 * Build a map of resolved absolute path → list of importing file paths (with their resolved path).
 * Also returns fileToFolder map and the full resolved edges list.
 */
function buildDependencyGraph(allFiles) {
  // resolvedPath → file node (for lookup)
  const pathToNode = new Map();
  for (const f of allFiles) {
    pathToNode.set(f.fullPath, f);
  }

  // resolvedTarget → [ { importer: resolvedSourcePath, module: rawImportString } ]
  const faninMap = new Map();

  // All directed edges: { source: resolvedPath, target: resolvedPath }
  const edges = [];

  // file resolved path → its top-level folder (relative to targetDir)
  const fileToFolder = new Map();

  for (const f of allFiles) {
    const relPath = relative(targetDir, f.fullPath);
    fileToFolder.set(f.fullPath, getTopFolder(relPath, couplingDepth));

    for (const imp of (f.imports || [])) {
      if (imp.isExternal) continue;

      const resolved = resolveImport(imp.module, f.fullPath);
      if (!resolved) continue;

      // Ensure target is also mapped to a folder (may be outside walked tree)
      if (!fileToFolder.has(resolved)) {
        fileToFolder.set(resolved, getTopFolder(relative(targetDir, resolved), couplingDepth));
      }

      // Record fanin
      if (!faninMap.has(resolved)) faninMap.set(resolved, []);
      faninMap.get(resolved).push(f.fullPath);

      // Record edge
      edges.push({ source: f.fullPath, target: resolved });
    }
  }

  return { faninMap, edges, fileToFolder, pathToNode };
}

/**
 * Get the top-level folder of a relative path at the given depth.
 * depth=1: "components/blocks/foo.tsx" → "components"
 * depth=2: "components/blocks/foo.tsx" → "components/blocks"
 */
function getTopFolder(relPath, depth = 1) {
  const parts = relPath.split('/').filter(Boolean);
  if (parts.length <= depth) return parts.slice(0, -1).join('/') || '(root)';
  return parts.slice(0, depth).join('/');
}

// ─── 1. --fanin ──────────────────────────────────────────────────────────────

function renderFanin(faninMap, fileToFolder) {
  const lines = [];
  lines.push('');
  lines.push('\x1b[1;36m══ Fan-in: Reverse Dependency Ranking ══\x1b[0m');
  lines.push('\x1b[2mFiles ranked by number of internal importers (who imports this file?)\x1b[0m');
  lines.push('');

  const entries = [...faninMap.entries()]
    .map(([file, importers]) => ({
      file: relative(targetDir, file),
      importers: importers.map(i => relative(targetDir, i)),
      count: importers.length,
      folders: [...new Set(importers.map(i => fileToFolder.get(i) || '?'))],
    }))
    .filter(e => e.count >= faninMin)
    .sort((a, b) => b.count - a.count);

  if (entries.length === 0) {
    lines.push('  (no files with fan-in >= ' + faninMin + ')');
    return lines;
  }

  const maxCount = entries[0].count;
  const countWidth = String(maxCount).length;

  for (const e of entries) {
    const bar = '█'.repeat(Math.min(e.count, 40));
    const folderTag = e.folders.length === 1
      ? `\x1b[2m(only from ${e.folders[0]})\x1b[0m`
      : `\x1b[33m(${e.folders.length} folders: ${e.folders.join(', ')})\x1b[0m`;

    lines.push(`  \x1b[1m${String(e.count).padStart(countWidth)}\x1b[0m  \x1b[32m${bar}\x1b[0m  ${e.file}  ${folderTag}`);
  }

  lines.push('');
  lines.push(`\x1b[2m  ${entries.length} files shown (min fan-in: ${faninMin})\x1b[0m`);
  return lines;
}

// ─── 2. --coupling ───────────────────────────────────────────────────────────

function renderCoupling(edges, fileToFolder) {
  const lines = [];
  lines.push('');
  lines.push('\x1b[1;36m══ Coupling: Inter-Folder Dependency Matrix ══\x1b[0m');
  lines.push(`\x1b[2mCross-boundary import counts (folder depth: ${couplingDepth}). Read as: row → imports from → column\x1b[0m`);
  lines.push('');

  // Build matrix
  const matrix = new Map(); // "sourceFolder" → Map("targetFolder" → count)
  const allFolders = new Set();

  for (const { source, target } of edges) {
    const sf = fileToFolder.get(source) || '?';
    const tf = fileToFolder.get(target) || '?';
    if (sf === tf) continue; // skip intra-folder
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

  // Find max folder name length for padding
  const maxNameLen = Math.max(...folders.map(f => f.length), 6);
  const colWidth = Math.max(...folders.map(f => f.length), 4);

  // Header row
  const header = ' '.repeat(maxNameLen + 2) + folders.map(f => f.slice(0, colWidth).padStart(colWidth)).join('  ');
  lines.push(`  \x1b[2m${header}\x1b[0m`);

  // Data rows
  for (const sf of folders) {
    const row = matrix.get(sf) || new Map();
    const cells = folders.map(tf => {
      if (sf === tf) return '\x1b[2m-\x1b[0m'.padStart(colWidth + 6); // account for ANSI
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

// ─── 3. --cycles ─────────────────────────────────────────────────────────────

function detectCycles(edges) {
  // Build adjacency list
  const adj = new Map();
  const allNodes = new Set();
  for (const { source, target } of edges) {
    allNodes.add(source);
    allNodes.add(target);
    if (!adj.has(source)) adj.set(source, []);
    adj.get(source).push(target);
  }

  // Tarjan's algorithm for strongly connected components
  let index = 0;
  const stack = [];
  const onStack = new Set();
  const indices = new Map();
  const lowlinks = new Map();
  const sccs = [];

  function strongconnect(v) {
    indices.set(v, index);
    lowlinks.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    for (const w of (adj.get(v) || [])) {
      if (!indices.has(w)) {
        strongconnect(w);
        lowlinks.set(v, Math.min(lowlinks.get(v), lowlinks.get(w)));
      } else if (onStack.has(w)) {
        lowlinks.set(v, Math.min(lowlinks.get(v), indices.get(w)));
      }
    }

    if (lowlinks.get(v) === indices.get(v)) {
      const scc = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      if (scc.length > 1) {
        sccs.push(scc);
      }
    }
  }

  for (const node of allNodes) {
    if (!indices.has(node)) {
      strongconnect(node);
    }
  }

  return sccs;
}

function renderCycles(edges) {
  const lines = [];
  lines.push('');
  lines.push('\x1b[1;36m══ Cycles: Circular Import Detection ══\x1b[0m');
  lines.push('\x1b[2mStrongly connected components in the import graph (files that import each other)\x1b[0m');
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
    for (const file of scc) {
      lines.push(`    → ${relative(targetDir, file)}`);
    }
    lines.push('');
  }

  return lines;
}

// ─── 4. --orphans ────────────────────────────────────────────────────────────

function renderOrphans(allFiles, faninMap) {
  const lines = [];
  lines.push('');
  lines.push('\x1b[1;36m══ Orphans: Files Never Imported ══\x1b[0m');
  lines.push('\x1b[2mFiles with zero inbound edges (excluding app/ route entry points)\x1b[0m');
  lines.push('');

  const importedPaths = new Set(faninMap.keys());

  const orphans = allFiles
    .filter(f => {
      if (importedPaths.has(f.fullPath)) return false;
      // Exclude app/ route files — they're entry points by design
      const rel = relative(targetDir, f.fullPath);
      if (rel.startsWith('app/') || rel.startsWith('app\\')) return true; // include app files that aren't _layout or index
      return true;
    })
    .map(f => {
      const rel = relative(targetDir, f.fullPath);
      const isEntryPoint = /^app[/\\]/.test(rel);
      return { file: rel, isEntryPoint, loc: f.loc?.code || 0 };
    })
    .sort((a, b) => {
      // Entry points last, then by LOC descending
      if (a.isEntryPoint !== b.isEntryPoint) return a.isEntryPoint ? 1 : -1;
      return b.loc - a.loc;
    });

  if (orphans.length === 0) {
    lines.push('  \x1b[32m✓ No orphan files found!\x1b[0m');
    return lines;
  }

  const nonEntry = orphans.filter(o => !o.isEntryPoint);
  const entryPoints = orphans.filter(o => o.isEntryPoint);

  if (nonEntry.length > 0) {
    lines.push(`  \x1b[33mPotentially dead code (${nonEntry.length} files):\x1b[0m`);
    for (const o of nonEntry) {
      lines.push(`    \x1b[2m${String(o.loc).padStart(5)} loc\x1b[0m  ${o.file}`);
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

// ─── 5. --colocate ───────────────────────────────────────────────────────────

function renderColocate(faninMap, fileToFolder) {
  const lines = [];
  lines.push('');
  lines.push('\x1b[1;36m══ Colocate: Suggested File Moves ══\x1b[0m');
  lines.push(`\x1b[2mFiles where ≥${Math.round(colocateThreshold * 100)}% of importers live in a single folder (and ≥2 importers)\x1b[0m`);
  lines.push('');

  const suggestions = [];

  for (const [file, importers] of faninMap) {
    if (importers.length < 2) continue;

    const currentFolder = fileToFolder.get(file) || '?';
    const folderCounts = {};
    for (const imp of importers) {
      const folder = fileToFolder.get(imp) || 'unknown';
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
    lines.push(`         \x1b[2m→ move to:\x1b[0m   \x1b[1m${s.suggestedFolder}\x1b[0m  (${s.topCount}/${s.importerCount} importers = ${s.pct}%)`);
    lines.push('');
  }

  lines.push(`\x1b[2m  ${suggestions.length} move suggestion(s)\x1b[0m`);
  return lines;
}

// ─── 6. --boundary ───────────────────────────────────────────────────────────

function renderBoundary(edges, allFiles, folderA, folderB) {
  const lines = [];
  lines.push('');
  lines.push(`\x1b[1;36m══ Boundary: Cross-Boundary Import Report ══\x1b[0m`);
  lines.push(`\x1b[2mImports crossing between "${folderA}" and "${folderB}"\x1b[0m`);
  lines.push('');

  const absA = resolve(targetDir, folderA);
  const absB = resolve(targetDir, folderB);

  function isInFolder(filePath, absFolder) {
    return filePath.startsWith(absFolder + '/') || filePath === absFolder;
  }

  const aToB = [];
  const bToA = [];

  for (const { source, target } of edges) {
    const srcInA = isInFolder(source, absA);
    const srcInB = isInFolder(source, absB);
    const tgtInA = isInFolder(target, absA);
    const tgtInB = isInFolder(target, absB);

    if (srcInA && tgtInB) {
      aToB.push({ from: relative(targetDir, source), to: relative(targetDir, target) });
    }
    if (srcInB && tgtInA) {
      bToA.push({ from: relative(targetDir, source), to: relative(targetDir, target) });
    }
  }

  if (aToB.length === 0 && bToA.length === 0) {
    lines.push(`  \x1b[32m✓ Clean boundary! No imports cross between these folders.\x1b[0m`);
    return lines;
  }

  if (aToB.length > 0) {
    lines.push(`  \x1b[1m${folderA} → ${folderB}\x1b[0m  (${aToB.length} imports):`);
    for (const e of aToB) {
      lines.push(`    ${e.from}  →  ${e.to}`);
    }
    lines.push('');
  }

  if (bToA.length > 0) {
    lines.push(`  \x1b[1m${folderB} → ${folderA}\x1b[0m  (${bToA.length} imports):`);
    for (const e of bToA) {
      lines.push(`    ${e.from}  →  ${e.to}`);
    }
    lines.push('');
  }

  const total = aToB.length + bToA.length;
  lines.push(`\x1b[2m  ${total} total cross-boundary import(s)\x1b[0m`);

  return lines;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const label = targetArg || '.';

// Always walk the tree (needed for both display and analysis)
const nodes = walk(targetDir);

if (showJson) {
  // ── JSON mode: tree + totals + analysis in one blob ──
  const totals = collectTotals(nodes);
  const jsonOutput = { totals, tree: toJson(nodes, targetDir) };

  if (anyAnalysis) {
    const allFiles = collectAllFiles(nodes);
    const { faninMap, edges, fileToFolder } = buildDependencyGraph(allFiles);

    if (showFanin) {
      jsonOutput.fanin = [...faninMap.entries()]
        .map(([file, importers]) => ({
          file: relative(targetDir, file),
          count: importers.length,
          importers: importers.map(i => relative(targetDir, i)),
          folders: [...new Set(importers.map(i => fileToFolder.get(i) || '?'))],
        }))
        .filter(e => e.count >= faninMin)
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

    if (showCycles) {
      jsonOutput.cycles = detectCycles(edges).map(scc => scc.map(f => relative(targetDir, f)));
    }

    if (showOrphans) {
      const importedPaths = new Set(faninMap.keys());
      jsonOutput.orphans = allFiles
        .filter(f => !importedPaths.has(f.fullPath))
        .map(f => relative(targetDir, f.fullPath));
    }

    if (showColocate) {
      const suggestions = [];
      for (const [file, importers] of faninMap) {
        if (importers.length < 2) continue;
        const currentFolder = fileToFolder.get(file) || '?';
        const folderCounts = {};
        for (const imp of importers) {
          const folder = fileToFolder.get(imp) || 'unknown';
          folderCounts[folder] = (folderCounts[folder] || 0) + 1;
        }
        const sorted = Object.entries(folderCounts).sort((a, b) => b[1] - a[1]);
        const [topFolder, topCount] = sorted[0] || [];
        const total = importers.length;
        if (topCount / total >= colocateThreshold && topFolder !== currentFolder) {
          suggestions.push({ file: relative(targetDir, file), currentFolder, suggestedFolder: topFolder, importerCount: total, topCount });
        }
      }
      jsonOutput.colocate = suggestions;
    }

    if (boundaryA && boundaryB) {
      const absA = resolve(targetDir, boundaryA);
      const absB = resolve(targetDir, boundaryB);
      const isIn = (fp, abs) => fp.startsWith(abs + '/') || fp === abs;
      const aToB = [], bToA = [];
      for (const { source, target } of edges) {
        if (isIn(source, absA) && isIn(target, absB)) aToB.push({ from: relative(targetDir, source), to: relative(targetDir, target) });
        if (isIn(source, absB) && isIn(target, absA)) bToA.push({ from: relative(targetDir, source), to: relative(targetDir, target) });
      }
      jsonOutput.boundary = { folderA: boundaryA, folderB: boundaryB, aToB, bToA };
    }
  }

  console.log(JSON.stringify(jsonOutput, null, 2));

} else {
  // ── Terminal mode ──

  // 1. Always print the tree (respects --imports, --loc, --no-types, --no-ext, etc.)
  console.log(label);
  console.log(renderTree(nodes).join('\n'));
  console.log(renderSummary(collectTotals(nodes)));

  // 2. Append analysis reports below the tree when any analysis flags are active
  if (anyAnalysis) {
    const allFiles = collectAllFiles(nodes);
    const { faninMap, edges, fileToFolder } = buildDependencyGraph(allFiles);

    if (showFanin)    console.log(renderFanin(faninMap, fileToFolder).join('\n'));
    if (showCoupling) console.log(renderCoupling(edges, fileToFolder).join('\n'));
    if (showCycles)   console.log(renderCycles(edges).join('\n'));
    if (showOrphans)  console.log(renderOrphans(allFiles, faninMap).join('\n'));
    if (showColocate) console.log(renderColocate(faninMap, fileToFolder).join('\n'));
    if (boundaryA && boundaryB) console.log(renderBoundary(edges, allFiles, boundaryA, boundaryB).join('\n'));
  }
}
