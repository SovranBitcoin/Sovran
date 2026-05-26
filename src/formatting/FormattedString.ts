// ---------------------------------------------------------------------------
// FormattedString — extends String with smart truncation
// ---------------------------------------------------------------------------

export type TruncateMode = 'start' | 'middle' | 'end' | 'beforeAt';

const RTL_LANGS = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'yi']);

function isRTLLocale(locale?: string): boolean {
  if (!locale) return false;
  return RTL_LANGS.has(locale.split('-')[0].toLowerCase());
}

// Code-point segmentation. `Array.from`/spread iterate via the string iterator,
// which yields full Unicode scalar values — keeping surrogate pairs (emoji,
// non-BMP CJK, etc.) intact through slicing. Falls short of grapheme clusters
// (a flag emoji is 2 code points) but Hermes does not ship Intl.Segmenter, so
// code-point iteration is the portable choice.
function codePoints(str: string): string[] {
  return Array.from(str);
}

function takeStart(cp: string[], n: number): string {
  return cp.slice(0, n).join('');
}

function takeEnd(cp: string[], n: number): string {
  return cp.slice(cp.length - n).join('');
}

/**
 * A string that also provides smart truncation.
 *
 * All standard string operations work as expected.
 * The default truncation mode is set at construction time based on the
 * kind of data (tokens → middle, addresses → end, pubkeys → middle).
 *
 * When a locale is provided, `beforeAt` mode adapts for RTL scripts —
 * truncating the end of the local part (visual start in RTL) instead of
 * the middle.
 *
 * @example
 * const s = new FormattedString('cashuABCD...XYZ', 'middle');
 * s.truncate(6)          // "cashuA...YZ"
 * s.truncate(6, 'end')   // "cashuA..."
 * s.toString()            // full string
 */
export class FormattedString extends String {
  private readonly _defaultMode: TruncateMode;
  private readonly _locale: string | undefined;

  constructor(value: string, defaultMode: TruncateMode = 'end', locale?: string) {
    super(value);
    this._defaultMode = defaultMode;
    this._locale = locale;
  }

  /**
   * Truncate the string keeping `n` code points visible.
   *
   * - `'middle'`: keeps `n` code points from start and end, joins with "..."
   * - `'end'`: keeps first `n` code points, appends "..."
   * - `'start'`: keeps last `n` code points, prepends "..."
   * - `'beforeAt'`: truncates only the part before `@`, keeps domain intact (for NPC/lightning addresses)
   *
   * Returns the original string if already short enough.
   */
  truncate(n: number, mode?: TruncateMode): string {
    const str = this.valueOf();
    const m = mode ?? this._defaultMode;

    if (n <= 0 || !str) return str;

    switch (m) {
      case 'middle': {
        const cp = codePoints(str);
        if (n * 2 >= cp.length) return str;
        return `${takeStart(cp, n)}...${takeEnd(cp, n)}`;
      }
      case 'end': {
        const cp = codePoints(str);
        if (n >= cp.length) return str;
        return `${takeStart(cp, n)}...`;
      }
      case 'start': {
        const cp = codePoints(str);
        if (n >= cp.length) return str;
        return `...${takeEnd(cp, n)}`;
      }
      case 'beforeAt': {
        const atIdx = str.indexOf('@');
        if (atIdx < 0) return this.truncate(n, 'middle');
        const local = str.substring(0, atIdx);
        const domain = str.substring(atIdx);
        const localCp = codePoints(local);
        if (isRTLLocale(this._locale)) {
          if (n >= localCp.length) return str;
          const truncated = `...${takeEnd(localCp, n)}`;
          return `${truncated}${domain}`;
        }
        if (n * 2 >= localCp.length) return str;
        const truncated = `${takeStart(localCp, n)}...${takeEnd(localCp, n)}`;
        return `${truncated}${domain}`;
      }
    }
  }
}
