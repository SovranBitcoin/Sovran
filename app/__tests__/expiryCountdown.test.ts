/**
 * Pins `formatExpiryCountdown` through its public seam,
 * `getMeltQuoteTimeUntilExpiry`. The formatter is module-private (see its
 * docblock for why it is not in `shared/lib/date`), and the only other suite
 * that names this module mocks both callers away — so without this file the
 * unit-dropping rules and the already-expired case have no coverage at all.
 */

import type { MeltQuoteBolt11Response } from '@cashu/cashu-ts';

import { getMeltQuoteTimeUntilExpiry } from '@/shared/lib/utils';

/** `expiry` is absolute unix SECONDS; the helper is given a fixed `now`. */
const NOW_MS = 1_800_000_000_000;
const NOW_SEC = NOW_MS / 1000;

/** Only `expiry` is read, so the rest of the quote stays unbuilt. */
function meltQuote(fields: Partial<MeltQuoteBolt11Response>): MeltQuoteBolt11Response {
  return fields as MeltQuoteBolt11Response;
}

const quoteExpiringIn = (seconds: number) => meltQuote({ expiry: NOW_SEC + seconds });

describe('melt-quote expiry countdown', () => {
  it.each([
    [45, 'expires in 45s'],
    [60, 'expires in 1m 0s'],
    [92, 'expires in 1m 32s'],
    [3600, 'expires in 1h 0m 0s'],
    [3661, 'expires in 1h 1m 1s'],
  ])('renders %is as "%s"', (secondsRemaining, expected) => {
    expect(getMeltQuoteTimeUntilExpiry(quoteExpiringIn(secondsRemaining), NOW_MS)).toBe(expected);
  });

  // The hours/minutes segments are dropped once they hit zero — a countdown
  // reading "expires in 0h 0m 9s" is the regression this pins.
  it('drops the leading units instead of showing them as zero', () => {
    expect(getMeltQuoteTimeUntilExpiry(quoteExpiringIn(9), NOW_MS)).toBe('expires in 9s');
    expect(getMeltQuoteTimeUntilExpiry(quoteExpiringIn(609), NOW_MS)).toBe('expires in 10m 9s');
  });

  // Past the deadline the caller renders nothing, rather than a countdown
  // frozen at zero or counting upward.
  it.each([0, -1, -3600])('returns null at %is remaining', (secondsRemaining) => {
    expect(getMeltQuoteTimeUntilExpiry(quoteExpiringIn(secondsRemaining), NOW_MS)).toBeNull();
  });

  it('returns null when the quote carries no expiry', () => {
    expect(getMeltQuoteTimeUntilExpiry(meltQuote({}), NOW_MS)).toBeNull();
  });
});
