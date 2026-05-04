/**
 * File-system walker shared by analyze-structure and lookalikes.
 * Honours IGNORE_DIRS / IGNORE_FILES / TS_EXTS from ./ignore.mjs.
 */

import { readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

import { IGNORE_DIRS, IGNORE_FILES, TS_EXTS, isTestPath } from './ignore.mjs';

/**
 * Walk a directory and collect every TypeScript/JavaScript source file.
 *
 * @param {string} dir - root to walk
 * @param {object} [opts]
 * @param {boolean} [opts.includeTests=false] - include __tests__ / *.test.* / *.spec.*
 * @param {string[]} [out] - output accumulator (used for recursion)
 * @returns {string[]} absolute file paths
 */
export function walkFiles(dir, opts = {}, out = []) {
  const { includeTests = false } = opts;
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    if (IGNORE_DIRS.has(entry) || IGNORE_FILES.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkFiles(full, opts, out);
    else if (TS_EXTS.has(extname(entry))) {
      if (!includeTests && isTestPath(full)) continue;
      out.push(full);
    }
  }
  return out;
}
