/**
 * @fileoverview Selector parsing for the Sovran Test DSL.
 *
 * Three forms:
 *   #testID         — exact match on accessibilityIdentifier (PREFERRED)
 *   "visible text"  — match on label/name (FALLBACK)
 *   #prefix*        — wildcard match starting with `prefix` (for dynamic IDs)
 *   #prefix* first  — wildcard, pick the first node in tree traversal
 *                     order (left-to-right for a horizontal row, top-to-
 *                     bottom for a vertical list). Default without
 *                     `first` is the topmost-visible heuristic, which is
 *                     y-unstable for siblings on the same row.
 *
 * `parseSelector` is given the source position so it can attribute parse
 * errors to the right line/column.
 */

import { ParseError, type Selector, type SourcePos } from './ast';

/**
 * testIDs follow a kebab-case `<screen>-<action>` convention. The set of
 * legal characters is conservative: lowercase letters, digits, and dashes.
 * The trailing `*` for wildcard form is matched separately.
 *
 * Templates: a testID may contain `${name}` interpolation references so a
 * test can target dynamic IDs like `#transaction-send-${sendId}`. The
 * regex allows literal `$`, `{`, `}`, and identifier characters when they
 * appear inside an interpolation marker.
 */
const TESTID_BODY_RE = /^[a-z0-9][a-z0-9-]*(?:\$\{[a-zA-Z_][a-zA-Z0-9_]*\}[a-z0-9-]*)*$/;

/**
 * Parse a selector token like `#wallet-receive`, `"Receive"`, or
 * `#transaction-mint-*` from the start of a string. Returns the parsed
 * Selector and the number of characters consumed (so the caller can
 * continue parsing modifiers like `when visible` or `within 5s`).
 *
 * Throws ParseError if the token doesn't look like a selector.
 */
export function parseSelector(
  input: string,
  pos: SourcePos
): { selector: Selector; consumed: number } {
  const trimmed = input.trimStart();
  const leadingWhitespace = input.length - trimmed.length;

  if (trimmed.length === 0) {
    throw new ParseError(pos, 'expected a selector (#testID, "text", or #prefix*)');
  }

  // ── Quoted text form: "..." ──
  if (trimmed[0] === '"') {
    const closeIdx = findClosingQuote(trimmed, 1);
    if (closeIdx === -1) {
      throw new ParseError(pos, 'unterminated string literal in selector');
    }
    const text = unescapeString(trimmed.slice(1, closeIdx));
    return {
      selector: { kind: 'text', text, pos },
      consumed: leadingWhitespace + closeIdx + 1,
    };
  }

  // ── testID form: #foo or #foo-bar* or #foo-${var} ──
  if (trimmed[0] === '#') {
    // Walk to the end of the testID body — letters, digits, dashes, and
    // `${name}` interpolation markers (which can contain identifier chars
    // and braces). Stop at any whitespace or other selector-terminating char.
    let i = 1;
    while (i < trimmed.length) {
      const c = trimmed[i];
      if (/[a-z0-9-]/i.test(c)) {
        i++;
        continue;
      }
      if (c === '$' && trimmed[i + 1] === '{') {
        // Consume `${...}` as a single token.
        const close = trimmed.indexOf('}', i + 2);
        if (close === -1) {
          throw new ParseError(pos, 'unterminated ${...} in selector');
        }
        i = close + 1;
        continue;
      }
      break;
    }
    const isWildcard = i < trimmed.length && trimmed[i] === '*';
    if (isWildcard) i++;

    const body = trimmed.slice(1, isWildcard ? i - 1 : i);
    if (body.length === 0) {
      throw new ParseError(pos, 'empty testID after `#`');
    }
    if (!TESTID_BODY_RE.test(body)) {
      throw new ParseError(pos, `invalid testID "${body}" — must be kebab-case [a-z0-9-]`);
    }

    // Optional `first` modifier — only legal on the wildcard form
    // since exact-id selectors match at most one element by construction.
    // The token must be preceded by whitespace AND followed by a word
    // boundary so a caller's identifier that happens to start with
    // "first" (e.g. a future `firstly` keyword) won't be eaten.
    let first = false;
    if (isWildcard) {
      // Peek past whitespace for the literal token `first` followed by
      // end-of-input or a non-identifier character.
      const afterMatch = /^(\s+)first(?![a-zA-Z0-9_])/.exec(trimmed.slice(i));
      if (afterMatch) {
        first = true;
        i += afterMatch[0].length;
      }
    }

    return {
      selector: isWildcard
        ? { kind: 'idPrefix', prefix: body, ...(first ? { first: true } : {}), pos }
        : { kind: 'id', id: body, pos },
      consumed: leadingWhitespace + i,
    };
  }

  throw new ParseError(
    pos,
    `expected a selector at "${trimmed.slice(0, 20)}…" — start with # for testID or " for visible text`
  );
}

/**
 * Walk a string looking for the matching closing `"` of a quoted literal.
 * Honours backslash escapes (`\"`, `\\`, `\n`, `\t`, `\r`). Returns the
 * index of the closing quote, or -1 if unterminated.
 */
function findClosingQuote(s: string, start: number): number {
  let i = start;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '"') return i;
    i++;
  }
  return -1;
}

/**
 * Unescape a string literal body (without the surrounding quotes).
 * Supports `\"`, `\\`, `\n`, `\t`, `\r`. Unknown escapes pass through
 * with the backslash dropped (forgiving — fewer surprises for test authors).
 */
export function unescapeString(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < s.length) {
      const next = s[i + 1];
      if (next === 'n') out += '\n';
      else if (next === 't') out += '\t';
      else if (next === 'r') out += '\r';
      else if (next === '"') out += '"';
      else if (next === '\\') out += '\\';
      else out += next;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}
