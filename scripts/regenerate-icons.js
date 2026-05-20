#!/usr/bin/env node
/* global __dirname */
/**
 * Regenerates .monicon/icons.js from the icons array in
 * assets/icons/index.tsx by fetching each iconify icon directly and writing
 * the committed CJS-blob format:
 *
 *   module.exports = {
 *     "prefix:name": {
 *       svg: '<svg viewBox="0 0 W H" width="1em" height="1em" >BODY</svg>',
 *       width: 16,
 *       height: 16,
 *     },
 *     ...
 *   };
 *
 * We can't use `@monicon/core@2`'s `bootstrap()` for this because its v2 API
 * dropped the single-file CJS writer the old `loadIcons({ type: 'cjs', ... })`
 * produced, and the installed version's default plugins output per-icon
 * component files instead. The format above is what the runtime (and
 * metro.config.js's @monicon/runtime alias) reads, so we reproduce it
 * directly via the Iconify REST API.
 *
 * Usage: node scripts/regenerate-icons.js
 */

const path = require('path');
const fs = require('fs');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'icons', 'index.tsx');
const INTERNAL_DIR = path.join(ROOT, 'assets', 'icons', 'internal');
const OUT_DIR = path.join(ROOT, '.monicon');
const OUT_FILE = path.join(OUT_DIR, 'icons.js');
const API_BASE = 'https://api.iconify.design';
const CHUNK_MAX_URL_LENGTH = 3500; // leave margin under typical 4 KB URL caps

function extractIcons() {
  const content = fs.readFileSync(SRC, 'utf-8');
  const sourceFile = ts.createSourceFile(
    SRC,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let iconsInitializer = null;

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;

    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === 'icons') {
        iconsInitializer = declaration.initializer;
        break;
      }
    }
    if (iconsInitializer) break;
  }

  if (!iconsInitializer || !ts.isArrayLiteralExpression(iconsInitializer)) {
    throw new Error('Could not find icons array in assets/icons/index.tsx');
  }

  const names = iconsInitializer.elements
    .filter((element) => ts.isStringLiteralLike(element))
    .map((element) => element.text);
  return Array.from(new Set(names));
}

function groupByPrefix(icons) {
  const byPrefix = new Map();
  for (const icon of icons) {
    const [prefix, name] = icon.split(':');
    if (!prefix || !name) {
      console.warn(`Skipping invalid icon name: ${icon}`);
      continue;
    }
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix).push(name);
  }
  return byPrefix;
}

function chunkByUrlLength(names, urlPrefix) {
  // `urlPrefix` approximates the static part of the request URL so we chunk
  // names before the full URL grows past API gateway limits.
  const chunks = [];
  let current = [];
  let currentLen = urlPrefix.length;
  for (const name of names) {
    const added = name.length + 1; // +1 for comma
    if (current.length > 0 && currentLen + added > CHUNK_MAX_URL_LENGTH) {
      chunks.push(current);
      current = [];
      currentLen = urlPrefix.length;
    }
    current.push(name);
    currentLen += added;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

async function fetchPrefix(prefix, names) {
  const urlPrefix = `${API_BASE}/${prefix}.json?icons=`;
  const chunks = chunkByUrlLength(names, urlPrefix);
  const merged = { icons: {}, aliases: {}, width: undefined, height: undefined };

  for (const chunk of chunks) {
    const url = `${urlPrefix}${chunk.join(',')}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[${prefix}] HTTP ${res.status} for ${chunk.length} icons`);
      continue;
    }
    const body = await res.json();
    if (body.width != null) merged.width = body.width;
    if (body.height != null) merged.height = body.height;
    Object.assign(merged.icons, body.icons ?? {});
    Object.assign(merged.aliases, body.aliases ?? {});
    if (Array.isArray(body.not_found) && body.not_found.length > 0) {
      console.warn(`[${prefix}] not found: ${body.not_found.join(', ')}`);
    }
  }
  return merged;
}

function resolveAlias(aliases, icons, name, seen = new Set()) {
  if (seen.has(name)) return null; // cycle guard
  seen.add(name);
  const alias = aliases[name];
  if (!alias || !alias.parent) return null;
  if (icons[alias.parent]) return icons[alias.parent];
  return resolveAlias(aliases, icons, alias.parent, seen);
}

function formatSvg(body, viewBoxW, viewBoxH) {
  // Match the committed format exactly: viewBox + width/height="1em", no xmlns.
  return `<svg viewBox="0 0 ${viewBoxW} ${viewBoxH}" width="1em" height="1em" >${body}</svg>`;
}

function parseInternalSvg(text, name) {
  // Internal SVGs are authored as a single <svg viewBox="...">…body…</svg>.
  // Strip the wrapper and lift the viewBox so we can re-emit in the same shape
  // the iconify pipeline produces. Color must be `currentColor` so the runtime
  // `color` prop flows through unchanged.
  const svgMatch = text.match(/<svg\b([^>]*)>([\s\S]*)<\/svg>/i);
  if (!svgMatch) throw new Error(`[internal:${name}] missing <svg> root`);
  const attrs = svgMatch[1];
  const inner = svgMatch[2].trim();
  const viewBoxMatch = attrs.match(/viewBox\s*=\s*"([^"]+)"/i);
  if (!viewBoxMatch) throw new Error(`[internal:${name}] missing viewBox attribute`);
  const parts = viewBoxMatch[1].trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
    throw new Error(`[internal:${name}] viewBox must be "minX minY width height"`);
  }
  return { body: inner, width: parts[2], height: parts[3] };
}

function loadInternalIcons() {
  // Scan assets/icons/internal/*.svg. Each file's basename becomes the
  // `internal:<basename>` registry key. Disk presence is the source of truth —
  // no parallel allowlist to maintain.
  if (!fs.existsSync(INTERNAL_DIR)) return [];
  const files = fs
    .readdirSync(INTERNAL_DIR)
    .filter((f) => f.endsWith('.svg'))
    .sort();
  const entries = [];
  for (const file of files) {
    const name = path.basename(file, '.svg');
    const text = fs.readFileSync(path.join(INTERNAL_DIR, file), 'utf-8');
    const { body, width, height } = parseInternalSvg(text, name);
    entries.push([
      `internal:${name}`,
      { svg: formatSvg(body, width, height), width: 16, height: 16 },
    ]);
  }
  return entries;
}

function serialize(entries) {
  // Produce a stable, pretty CJS blob that matches the committed file's
  // indentation (2-space JSON with outer `module.exports = { ... }`).
  const lines = [
    '// This file is automatically generated by Monicon. Do not edit this file directly.',
    'module.exports = {',
  ];
  entries.forEach(([key, value], idx) => {
    const isLast = idx === entries.length - 1;
    const valueLines = [
      '  ' + JSON.stringify(key) + ': {',
      '    "svg": ' + JSON.stringify(value.svg) + ',',
      '    "width": ' + value.width + ',',
      '    "height": ' + value.height,
      '  }' + (isLast ? '' : ','),
    ];
    lines.push(...valueLines);
  });
  lines.push('};', '');
  return lines.join('\n');
}

(async () => {
  const icons = extractIcons();
  console.log(`Found ${icons.length} icons in ${path.relative(ROOT, SRC)}`);

  const byPrefix = groupByPrefix(icons);
  // The `internal:` prefix is resolved locally from
  // assets/icons/internal/*.svg — skip it in the iconify API loop. (If the
  // icons array doesn't list any internal:* entries, this is a no-op.)
  byPrefix.delete('internal');
  console.log(`Grouped into ${byPrefix.size} iconify prefix(es)`);

  const entries = [];
  for (const [prefix, names] of byPrefix) {
    process.stdout.write(`  [${prefix}] fetching ${names.length}... `);
    try {
      const collection = await fetchPrefix(prefix, names);
      let hits = 0;
      for (const name of names) {
        const full = `${prefix}:${name}`;
        let icon = collection.icons[name];
        if (!icon) {
          icon = resolveAlias(collection.aliases, collection.icons, name);
        }
        if (!icon) {
          console.warn(`\n    [${full}] not returned by API`);
          continue;
        }
        const w = icon.width ?? collection.width ?? 16;
        const h = icon.height ?? collection.height ?? 16;
        entries.push([
          full,
          {
            svg: formatSvg(icon.body, w, h),
            width: 16, // stored width/height default to 16 in committed file
            height: 16,
          },
        ]);
        hits += 1;
      }
      console.log(`ok (${hits}/${names.length})`);
    } catch (err) {
      console.log('failed');
      console.error(err);
    }
  }

  const internalEntries = loadInternalIcons();
  if (internalEntries.length > 0) {
    console.log(`[internal] bundled ${internalEntries.length} custom icon(s)`);
  }
  entries.push(...internalEntries);

  // Stable ordering: follow the source array's order for iconify entries,
  // then internal:* alphabetically at the end (they fall through to the 1e9
  // bucket because they aren't required to be listed in the icons array).
  const order = new Map(icons.map((name, idx) => [name, idx]));
  entries.sort((a, b) => {
    const ao = order.get(a[0]) ?? 1e9;
    const bo = order.get(b[0]) ?? 1e9;
    if (ao !== bo) return ao - bo;
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, serialize(entries), 'utf-8');
  console.log(`Wrote ${entries.length} icons → ${path.relative(ROOT, OUT_FILE)}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
