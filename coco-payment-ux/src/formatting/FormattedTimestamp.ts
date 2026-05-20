// ---------------------------------------------------------------------------
// FormattedTimestamp — extends Number with locale-aware date formatting
// ---------------------------------------------------------------------------

// Module-scope locale-keyed caches. Intl formatter construction is the
// expensive step (locale data lookup, ICU table allocation); reuse is safe
// because formatters are immutable once built.
const shortCache = new Map<string, Intl.DateTimeFormat>();
const fullCache = new Map<string, Intl.DateTimeFormat>();
const datetimeCache = new Map<string, Intl.DateTimeFormat>();
const relativeCache = new Map<string, Intl.RelativeTimeFormat>();

function getShort(locale: string): Intl.DateTimeFormat {
  let f = shortCache.get(locale);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    shortCache.set(locale, f);
  }
  return f;
}

function getFull(locale: string): Intl.DateTimeFormat {
  let f = fullCache.get(locale);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    fullCache.set(locale, f);
  }
  return f;
}

function getDatetime(locale: string): Intl.DateTimeFormat {
  let f = datetimeCache.get(locale);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    datetimeCache.set(locale, f);
  }
  return f;
}

function getRelative(locale: string): Intl.RelativeTimeFormat | null {
  if (relativeCache.has(locale)) return relativeCache.get(locale) ?? null;
  try {
    const f = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    relativeCache.set(locale, f);
    return f;
  } catch {
    // Hermes / older runtimes without RelativeTimeFormat — fall back.
    return null;
  }
}

/**
 * A number that also provides locale-aware date formatting.
 *
 * Arithmetic, comparisons, and `new Date(ts.valueOf())` all work as expected.
 * Formatting getters use the locale provided at construction time.
 *
 * @example
 * const ts = new FormattedTimestamp(Date.now(), 'en');
 * ts.short   // "Mar 16, 2026"
 * ts.full    // "March 16, 2026, 3:45 PM"
 * ts + 0     // raw milliseconds
 */
export class FormattedTimestamp extends Number {
  private readonly _locale: string;

  constructor(value: number, locale: string = 'en') {
    super(value);
    this._locale = locale;
  }

  /** Relative time string: "2 hours ago", "just now", "in 3 days". */
  get relative(): string {
    const now = Date.now();
    const diff = now - this.valueOf();
    const absDiff = Math.abs(diff);
    const isPast = diff >= 0;

    const seconds = Math.floor(absDiff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return 'just now';

    const rtf = getRelative(this._locale);
    if (rtf) {
      if (days > 0) return rtf.format(isPast ? -days : days, 'day');
      if (hours > 0) return rtf.format(isPast ? -hours : hours, 'hour');
      return rtf.format(isPast ? -minutes : minutes, 'minute');
    }
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    return `${minutes}m ago`;
  }

  /** Short date: "Mar 16, 2026". */
  get short(): string {
    return getShort(this._locale).format(this.valueOf());
  }

  /** Full date with time: "March 16, 2026, 3:45 PM". */
  get full(): string {
    return getFull(this._locale).format(this.valueOf());
  }

  /** Datetime string: "03/16/2026 15:45:00". */
  get datetime(): string {
    return getDatetime(this._locale).format(this.valueOf());
  }
}
