// ---------------------------------------------------------------------------
// FormattedString — extends String with smart truncation
// ---------------------------------------------------------------------------

export type TruncateMode = 'start' | 'middle' | 'end';

/**
 * A string that also provides smart truncation.
 *
 * All standard string operations work as expected.
 * The default truncation mode is set at construction time based on the
 * kind of data (tokens → middle, addresses → end, pubkeys → middle).
 *
 * @example
 * const s = new FormattedString('cashuABCD...XYZ', 'middle');
 * s.truncate(6)          // "cashuA...YZ"
 * s.truncate(6, 'end')   // "cashuA..."
 * s.toString()            // full string
 */
export class FormattedString extends String {
  private readonly _defaultMode: TruncateMode;

  constructor(value: string, defaultMode: TruncateMode = 'end') {
    super(value);
    this._defaultMode = defaultMode;
  }

  /**
   * Truncate the string keeping `n` characters visible.
   *
   * - `'middle'`: keeps `n` chars from start and end, joins with "..."
   * - `'end'`: keeps first `n` chars, appends "..."
   * - `'start'`: keeps last `n` chars, prepends "..."
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
    }
  }
}
