/**
 * Source-text utilities used by analyze-structure and lookalikes.
 * Cheap, regex-based — meant for rough scanning, not real parsing.
 */

/**
 * Strip block comments, line comments, and string/template literals so
 * regex passes don't match against text that lives inside strings.
 *
 * Replacement preserves character positions (replaces with same-length
 * runs of spaces / kept quote bookends) so the returned text can still
 * be used to compute line offsets in the original source via
 * `buildLineIndex`.
 */
export function stripCodeNoise(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/\/\/.*/g, (m) => ' '.repeat(m.length))
    .replace(/`(?:\\.|[^`\\])*`/g, (m) => '`' + ' '.repeat(m.length - 2) + '`')
    .replace(/'(?:\\.|[^'\\])*'/g, (m) => "'" + ' '.repeat(m.length - 2) + "'")
    .replace(/"(?:\\.|[^"\\])*"/g, (m) => '"' + ' '.repeat(m.length - 2) + '"');
}

/** Find the matching closing brace for an opener at index `openIdx`. */
export function findMatchingBrace(text, openIdx) {
  if (text[openIdx] !== '{') return -1;
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Build an index of newline offsets so character positions can be turned into line numbers. */
export function buildLineIndex(src) {
  const offsets = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') offsets.push(i + 1);
  return offsets;
}

export function lineOf(offsets, idx) {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= idx) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}
