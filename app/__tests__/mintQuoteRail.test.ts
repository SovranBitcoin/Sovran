/**
 * Which screen a mint quote opens.
 *
 * Receiving is one Cashu operation with three presentations, and the choice is
 * made in two places — the live flow when a quote is created, and the
 * transactions list when a past one is reopened. Both call `mintQuoteRail`, so
 * this is the single point where a quote could open the wrong screen.
 *
 * The case that matters most is the entry with NO recorded method: every mint
 * quote created before `metadata.method` existed looks like that, and sending
 * one to the custom screen would relabel a real Lightning invoice.
 */

import type { HistoryEntry } from '@cashu/coco-core';

import { mintQuoteMethod, mintQuoteRail } from '@/shared/lib/cashu/mintQuoteRail';

const mintEntry = (over: Record<string, unknown> = {}): HistoryEntry =>
  ({
    type: 'mint',
    id: 'op-1',
    quoteId: 'quote-1',
    mintUrl: 'https://mint.example.com',
    unit: 'sat',
    state: 'UNPAID',
    paymentRequest: 'lnbc100n1p...',
    ...over,
  }) as unknown as HistoryEntry;

describe('mintQuoteMethod', () => {
  it('reads the method the quote was created with', () => {
    expect(mintQuoteMethod(mintEntry({ metadata: { method: 'venmo' } }))).toBe('venmo');
  });

  it('assumes bolt11 for an entry written before methods were recorded', () => {
    expect(mintQuoteMethod(mintEntry())).toBe('bolt11');
    expect(mintQuoteMethod(mintEntry({ metadata: {} }))).toBe('bolt11');
    expect(mintQuoteMethod(null)).toBe('bolt11');
  });

  it('ignores a non-string method rather than trusting it', () => {
    expect(mintQuoteMethod(mintEntry({ metadata: { method: 42 } }))).toBe('bolt11');
  });
});

describe('mintQuoteRail', () => {
  it('routes a recorded custom method to the custom screen', () => {
    expect(mintQuoteRail(mintEntry({ metadata: { method: 'venmo' } }))).toBe('custom');
    expect(mintQuoteRail(mintEntry({ metadata: { method: 'paypal' } }))).toBe('custom');
    expect(mintQuoteRail(mintEntry({ metadata: { method: 'bank_transfer' } }))).toBe('custom');
  });

  it('routes the Lightning family to the Lightning screen', () => {
    expect(mintQuoteRail(mintEntry({ metadata: { method: 'bolt11' } }))).toBe('lightning');
    expect(mintQuoteRail(mintEntry({ metadata: { method: 'bolt12' } }))).toBe('lightning');
  });

  it('routes a legacy entry with no recorded method to Lightning', () => {
    expect(mintQuoteRail(mintEntry())).toBe('lightning');
  });

  it('routes onchain by its recorded method', () => {
    expect(
      mintQuoteRail(
        mintEntry({
          metadata: { method: 'onchain', onchainAddress: 'bc1qexampleaddress' },
          paymentRequest: 'bc1qexampleaddress',
        })
      )
    ).toBe('onchain');
  });

  it('still recognises a legacy onchain entry by its address alone', () => {
    // The whole reason the address check survives: these entries predate
    // `metadata.method` and would otherwise be read as Lightning.
    expect(
      mintQuoteRail(mintEntry({ paymentRequest: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080' }))
    ).toBe('onchain');
  });
});
