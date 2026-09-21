/**
 * `formatRelativeUnixSeconds` centralizes the row-timestamp pattern
 * (unix seconds → terse relative, '' when unknown) previously forked
 * across notification/feed/mint/contact rows.
 */

import { formatDate, formatRelative, formatRelativeUnixSeconds } from '@/shared/lib/date';

describe('formatRelativeUnixSeconds', () => {
  it('returns "" for unknown (0 or negative) timestamps instead of a 1970 date', () => {
    expect(formatRelativeUnixSeconds(0)).toBe('');
    expect(formatRelativeUnixSeconds(-5)).toBe('');
  });

  it('formats a seconds value as a terse relative string (no "ago")', () => {
    const twoHoursAgoSeconds = Math.floor(Date.now() / 1000) - 2 * 3600;
    expect(formatRelativeUnixSeconds(twoHoursAgoSeconds)).toBe('2h');
  });

  it('treats the input as seconds, not milliseconds', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(formatRelativeUnixSeconds(nowSeconds)).toBe('now');
  });
});

describe("formatRelative 'terse'", () => {
  const nowMs = Date.UTC(2026, 8, 14, 12, 0, 0);
  const ago = (seconds: number) => nowMs - seconds * 1000;

  it('walks the bare ladder: now / m / h / d / w', () => {
    expect(formatRelative(ago(30), 'terse', nowMs)).toBe('now');
    expect(formatRelative(ago(5 * 60), 'terse', nowMs)).toBe('5m');
    expect(formatRelative(ago(3 * 3600), 'terse', nowMs)).toBe('3h');
    expect(formatRelative(ago(2 * 86400), 'terse', nowMs)).toBe('2d');
    expect(formatRelative(ago(9 * 86400), 'terse', nowMs)).toBe('1w');
  });

  it('falls back to a short date past 30 days', () => {
    // Locale-ordered short date: "Jul 31" (en-US) or "31 Jul" (en-GB).
    expect(formatRelative(ago(45 * 86400), 'terse', nowMs)).toMatch(
      /^([A-Z][a-z]{2} \d{1,2}|\d{1,2} [A-Z][a-z]{2})$/
    );
  });

  it("leaves the prose 'compact' style with its suffix", () => {
    expect(formatRelative(ago(3 * 3600), 'compact', nowMs)).toBe('3h ago');
  });
});

describe('invalid dates', () => {
  it("formats an unparseable input as '' instead of throwing a RangeError", () => {
    expect(formatDate('garbage', 'short-date')).toBe('');
    expect(formatDate(NaN, 'iso')).toBe('');
    expect(formatDate(new Date('garbage'), 'time')).toBe('');
    for (const style of [
      'verbose',
      'compact',
      'terse',
      'chat-bubble',
      'conversation-list',
    ] as const) {
      expect(formatRelative(NaN, style)).toBe('');
      expect(formatRelative('garbage', style)).toBe('');
    }
  });
});
