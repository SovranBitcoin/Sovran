// ---------------------------------------------------------------------------
// FormattedTimestamp — extends Number with locale-aware date formatting
// ---------------------------------------------------------------------------

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

    // Use Intl.RelativeTimeFormat when available
    try {
      const rtf = new Intl.RelativeTimeFormat(this._locale, { numeric: 'auto' });
      if (days > 0) return rtf.format(isPast ? -days : days, 'day');
      if (hours > 0) return rtf.format(isPast ? -hours : hours, 'hour');
      return rtf.format(isPast ? -minutes : minutes, 'minute');
    } catch {
      // Fallback for environments without RelativeTimeFormat
      if (days > 0) return `${days}d ago`;
      if (hours > 0) return `${hours}h ago`;
      return `${minutes}m ago`;
    }
  }

  /** Short date: "Mar 16, 2026". */
  get short(): string {
    return new Intl.DateTimeFormat(this._locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(this.valueOf());
  }

  /** Full date with time: "March 16, 2026, 3:45 PM". */
  get full(): string {
    return new Intl.DateTimeFormat(this._locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(this.valueOf());
  }

  /** Datetime string: "03/16/2026 15:45:00". */
  get datetime(): string {
    return new Intl.DateTimeFormat(this._locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(this.valueOf());
  }
}
