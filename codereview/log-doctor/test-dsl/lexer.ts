/**
 * @fileoverview Sovran Test DSL — line lexer.
 *
 * The DSL is line-oriented: every non-empty, non-comment line is one
 * statement. The lexer's only job is to split the input into lines,
 * strip blank lines, and surface `# verified:` comments separately
 * (those are metadata, not commentary).
 *
 * Real comments (`#` at start of line) are stripped here. End-of-line
 * comments are NOT supported — `#` is reserved for selectors and the
 * verified marker, so allowing trailing comments would create
 * ambiguity with `#testID` references mid-statement.
 */

/**
 * One physical line of the source file. Carries 1-indexed line/col so
 * the parser can attach precise positions to AST nodes.
 */
export interface SourceLine {
  /** 1-indexed line number in the original file. */
  line: number;
  /** Column where the trimmed content starts (1-indexed). */
  col: number;
  /** The content after stripping leading whitespace and trailing CR. */
  text: string;
  /** True if this line starts with `# verified:` (verification metadata). */
  isVerifiedComment: boolean;
  /** True if this line starts with `# desc:` (human-readable description). */
  isDescComment: boolean;
}

const VERIFIED_PREFIX_RE = /^#\s*verified\s*:/i;
const DESC_PREFIX_RE = /^#\s*desc\s*:/i;

/**
 * Split the input into source lines suitable for the parser.
 *
 * - Strips Windows CR endings.
 * - Drops blank lines and pure-`#` comment lines (preserving line numbers
 *   for error reporting via the `line` field on each emitted SourceLine).
 * - Preserves `# verified: ...` lines (with `isVerifiedComment: true`)
 *   so the parser can attach them as test metadata.
 */
export function lex(source: string): SourceLine[] {
  const out: SourceLine[] = [];
  const rawLines = source.split('\n');

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i].replace(/\r$/, '');
    const lineNo = i + 1;

    // Compute leading whitespace span — drives the col field.
    let leading = 0;
    while (leading < raw.length && (raw[leading] === ' ' || raw[leading] === '\t')) {
      leading++;
    }
    const trimmed = raw.slice(leading).trimEnd();

    // Skip empty lines outright.
    if (trimmed.length === 0) continue;

    // Comment line.
    if (trimmed[0] === '#') {
      if (VERIFIED_PREFIX_RE.test(trimmed)) {
        out.push({
          line: lineNo,
          col: leading + 1,
          text: trimmed,
          isVerifiedComment: true,
          isDescComment: false,
        });
      } else if (DESC_PREFIX_RE.test(trimmed)) {
        out.push({
          line: lineNo,
          col: leading + 1,
          text: trimmed,
          isVerifiedComment: false,
          isDescComment: true,
        });
      }
      // Plain comment — drop entirely.
      continue;
    }

    out.push({
      line: lineNo,
      col: leading + 1,
      text: trimmed,
      isVerifiedComment: false,
      isDescComment: false,
    });
  }

  return out;
}
