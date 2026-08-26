/**
 * `formatRelativeUnixSeconds` centralizes the row-timestamp pattern
 * (unix seconds → compact relative, '' when unknown) previously forked
 * across notification/feed/mint/contact rows.
 */

import { formatRelativeUnixSeconds } from '@/shared/lib/date';

describe('formatRelativeUnixSeconds', () => {
  it('returns "" for unknown (0 or negative) timestamps instead of a 1970 date', () => {
    expect(formatRelativeUnixSeconds(0)).toBe('');
    expect(formatRelativeUnixSeconds(-5)).toBe('');
  });

  it('formats a seconds value as a compact relative string', () => {
    const twoHoursAgoSeconds = Math.floor(Date.now() / 1000) - 2 * 3600;
    expect(formatRelativeUnixSeconds(twoHoursAgoSeconds)).toBe('2h ago');
  });

  it('treats the input as seconds, not milliseconds', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(formatRelativeUnixSeconds(nowSeconds)).toBe('now');
  });
});
