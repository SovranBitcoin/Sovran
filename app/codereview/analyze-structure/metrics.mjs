/**
 * metrics.mjs — pure per-file metric functions.
 *
 * Each function takes a source string (and sometimes already-extracted exports)
 * and returns a numeric / structured summary. No I/O, no shared state.
 * Used by index.mjs's walker to attach metrics to every fileNode.
 */

import { stripCodeNoise, findMatchingBrace } from '../shared/source.mjs';

// ─── LOC counting (cloc-style) ───────────────────────────────────────────────

export function countLines(src) {
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

export function computeComplexity(src) {
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

export function countTypeSmells(src) {
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

export function analyzeReactComponents(src) {
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

// ─── Pass-through detection ──────────────────────────────────────────────────

export function detectPassThrough(src, exports) {
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

export function computeModuleDepth(fileNode) {
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
