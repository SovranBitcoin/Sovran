// ---------------------------------------------------------------------------
// FormattedString — extends String with smart truncation
// ---------------------------------------------------------------------------

export type TruncateMode = 'start' | 'middle' | 'end' | 'beforeAt';

const RTL_LANGS = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'yi']);

function isRTLLocale(locale?: string): boolean {
  if (!locale) return false;
  return RTL_LANGS.has(locale.split('-')[0].toLowerCase());
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
   * Truncate the string keeping `n` characters visible.
   *
   * - `'middle'`: keeps `n` chars from start and end, joins with "..."
   * - `'end'`: keeps first `n` chars, appends "..."
   * - `'start'`: keeps last `n` chars, prepends "..."
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
        if (n * 2 >= str.length) return str;
        return `${str.substring(0, n)}...${str.substring(str.length - n)}`;
      }
      case 'end': {
        if (n >= str.length) return str;
        return `${str.substring(0, n)}...`;
      }
      case 'start': {
        if (n >= str.length) return str;
        return `...${str.substring(str.length - n)}`;
      }
      case 'beforeAt': {
        const atIdx = str.indexOf('@');
        if (atIdx < 0) return this.truncate(n, 'middle');
        const local = str.substring(0, atIdx);
        const domain = str.substring(atIdx);
        if (isRTLLocale(this._locale)) {
          if (n >= local.length) return str;
          const truncated = `...${local.substring(local.length - n)}`;
          return `${truncated}${domain}`;
        }
        if (n * 2 >= local.length) return str;
        const truncated = `${local.substring(0, n)}...${local.substring(local.length - n)}`;
        return `${truncated}${domain}`;
      }
    }
  }
}
