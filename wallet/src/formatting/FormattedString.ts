// ---------------------------------------------------------------------------
// FormattedString — extends String with smart truncation
// ---------------------------------------------------------------------------

import { logger } from '../logger';

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

function localeBase(locale?: string): string | null {
  return locale?.split('-')[0].toLowerCase() ?? null;
}

function logTruncateResult(fields: {
  mode: TruncateMode;
  locale?: string;
  inputCodePoints: number;
  outputCodePoints: number;
  visibleCount: number;
  truncated: boolean;
  fallbackMode?: TruncateMode;
  hasAtSign?: boolean;
  rtl?: boolean;
}): void {
  if (!fields.truncated && !fields.fallbackMode && fields.visibleCount > 0)
    return;
  logger.debug('formatting.string.truncate', {
    mode: fields.mode,
    fallbackMode: fields.fallbackMode ?? null,
    localeBase: localeBase(fields.locale),
    inputCodePoints: fields.inputCodePoints,
    outputCodePoints: fields.outputCodePoints,
    visibleCount: fields.visibleCount,
    truncated: fields.truncated,
    hasAtSign: fields.hasAtSign ?? null,
    rtl: fields.rtl ?? null,
  });
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

  constructor(
    value: string,
    defaultMode: TruncateMode = 'end',
    locale?: string,
  ) {
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

    if (n <= 0 || !str) {
      logTruncateResult({
        mode: m,
        locale: this._locale,
        inputCodePoints: codePoints(str).length,
        outputCodePoints: codePoints(str).length,
        visibleCount: n,
        truncated: false,
      });
      return str;
    }

    switch (m) {
      case 'middle': {
        const cp = codePoints(str);
        if (n * 2 >= cp.length) {
          logTruncateResult({
            mode: m,
            locale: this._locale,
            inputCodePoints: cp.length,
            outputCodePoints: cp.length,
            visibleCount: n,
            truncated: false,
          });
          return str;
        }
        const out = `${takeStart(cp, n)}...${takeEnd(cp, n)}`;
        logTruncateResult({
          mode: m,
          locale: this._locale,
          inputCodePoints: cp.length,
          outputCodePoints: codePoints(out).length,
          visibleCount: n,
          truncated: true,
        });
        return out;
      }
      case 'end': {
        const cp = codePoints(str);
        if (n >= cp.length) {
          logTruncateResult({
            mode: m,
            locale: this._locale,
            inputCodePoints: cp.length,
            outputCodePoints: cp.length,
            visibleCount: n,
            truncated: false,
          });
          return str;
        }
        const out = `${takeStart(cp, n)}...`;
        logTruncateResult({
          mode: m,
          locale: this._locale,
          inputCodePoints: cp.length,
          outputCodePoints: codePoints(out).length,
          visibleCount: n,
          truncated: true,
        });
        return out;
      }
      case 'start': {
        const cp = codePoints(str);
        if (n >= cp.length) {
          logTruncateResult({
            mode: m,
            locale: this._locale,
            inputCodePoints: cp.length,
            outputCodePoints: cp.length,
            visibleCount: n,
            truncated: false,
          });
          return str;
        }
        const out = `...${takeEnd(cp, n)}`;
        logTruncateResult({
          mode: m,
          locale: this._locale,
          inputCodePoints: cp.length,
          outputCodePoints: codePoints(out).length,
          visibleCount: n,
          truncated: true,
        });
        return out;
      }
      case 'beforeAt': {
        const atIdx = str.indexOf('@');
        if (atIdx < 0) {
          logTruncateResult({
            mode: m,
            fallbackMode: 'middle',
            locale: this._locale,
            inputCodePoints: codePoints(str).length,
            outputCodePoints: codePoints(str).length,
            visibleCount: n,
            truncated: false,
            hasAtSign: false,
          });
          return this.truncate(n, 'middle');
        }
        const local = str.substring(0, atIdx);
        const domain = str.substring(atIdx);
        const localCp = codePoints(local);
        if (isRTLLocale(this._locale)) {
          if (n >= localCp.length) {
            logTruncateResult({
              mode: m,
              locale: this._locale,
              inputCodePoints: codePoints(str).length,
              outputCodePoints: codePoints(str).length,
              visibleCount: n,
              truncated: false,
              hasAtSign: true,
              rtl: true,
            });
            return str;
          }
          const truncated = `...${takeEnd(localCp, n)}`;
          const out = `${truncated}${domain}`;
          logTruncateResult({
            mode: m,
            locale: this._locale,
            inputCodePoints: codePoints(str).length,
            outputCodePoints: codePoints(out).length,
            visibleCount: n,
            truncated: true,
            hasAtSign: true,
            rtl: true,
          });
          return out;
        }
        if (n * 2 >= localCp.length) {
          logTruncateResult({
            mode: m,
            locale: this._locale,
            inputCodePoints: codePoints(str).length,
            outputCodePoints: codePoints(str).length,
            visibleCount: n,
            truncated: false,
            hasAtSign: true,
            rtl: false,
          });
          return str;
        }
        const truncated = `${takeStart(localCp, n)}...${takeEnd(localCp, n)}`;
        const out = `${truncated}${domain}`;
        logTruncateResult({
          mode: m,
          locale: this._locale,
          inputCodePoints: codePoints(str).length,
          outputCodePoints: codePoints(out).length,
          visibleCount: n,
          truncated: true,
          hasAtSign: true,
          rtl: false,
        });
        return out;
      }
    }
  }
}
