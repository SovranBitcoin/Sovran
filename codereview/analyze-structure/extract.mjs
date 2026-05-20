/**
 * extract.mjs — pure structural-extraction functions.
 *
 * Each function takes a source string and returns a structural projection
 * of it (exports, imports, identifiers). No I/O, no shared state.
 * Used by index.mjs's walker to attach exports/imports to every fileNode
 * and by the vocab-drift / concept-locality reports.
 *
 * extractExports takes a `hideTypes` option (was a closure variable in the
 * pre-split file). All other functions are option-free.
 */

import { stripCodeNoise } from '../shared/source.mjs';

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

export function extractIdentifiers(src) {
  const code = stripCodeNoise(src);
  const set = new Set();
  for (const m of code.matchAll(/\b([A-Za-z_][A-Za-z0-9_]{2,})\b/g)) {
    const w = m[1];
    if (!JS_KEYWORDS.has(w)) set.add(w);
  }
  return set;
}

// ─── Export extraction ───────────────────────────────────────────────────────

export function extractExports(src, { hideTypes = false } = {}) {
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
  }

  // Combined regex for `export { ... }`, `export type { ... }`,
  // `export { ... } from '...'`, and `export type { ... } from '...'`.
  // The `from` clause distinguishes a re-export from a same-file definition;
  // downstream dup-detection skips kind='reexport' so barrel re-exports don't
  // get flagged as duplicate definitions of the names they forward.
  for (const m of stripped.matchAll(
    /^export\s+(type\s+)?\{([^}]+)\}(\s+from\s+['"][^'"]+['"])?/gm
  )) {
    const isFromReexport = !!m[3];
    const isTypeOnly = !!m[1];
    if (isTypeOnly && hideTypes && !isFromReexport) continue;
    for (const chunk of m[2].split(',')) {
      const parts = chunk.trim().split(/\s+as\s+/);
      const name = (parts[parts.length - 1] || '').trim().replace(/^type\s+/, '');
      if (!name || !/^\w+$/.test(name)) continue;
      if (isFromReexport) {
        add('reexport', name, 'reexport');
      } else if (isTypeOnly) {
        if (!hideTypes) add('type', name, 'type');
      } else {
        add('named', name, classify(name, 'reexport'));
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

export function extractImports(src) {
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/\/\/.*/g, '');

  const byModule = new Map();
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
        const name = (parts[parts.length - 1] || '').trim();
        if (name) entry.names.push(name);
      }
    }
  }

  return [...byModule.values()];
}

// ─── Tag classification ─────────────────────────────────────────────────────

export function classify(name, hint) {
  if (!name) return hint;
  if (name.startsWith('use') && /^use[A-Z]/.test(name)) return 'hook';
  if (/^[A-Z]/.test(name)) return 'component';
  if (hint === 'fn' || hint === 'wrapped') return hint;
  if (name === name.toUpperCase() && name.length > 1) return 'constant';
  return hint;
}
