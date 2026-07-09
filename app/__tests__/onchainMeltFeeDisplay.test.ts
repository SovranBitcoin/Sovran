/**
 * @jest-environment node
 */
import {
  normalizeOnchainFeeOptions,
  resolveOnchainMeltFeeDisplay,
} from '@/shared/lib/cashu/onchainMelt';

describe('normalizeOnchainFeeOptions', () => {
  it('parses a NUT-30 fee_options array', () => {
    expect(
      normalizeOnchainFeeOptions([
        { fee_index: 0, fee_reserve: 5000, estimated_blocks: 1 },
        { fee_index: 1, fee_reserve: 2000, estimated_blocks: 6 },
      ])
    ).toEqual([
      { feeIndex: 0, feeReserveSats: 5000, estimatedBlocks: 1 },
      { feeIndex: 1, feeReserveSats: 2000, estimatedBlocks: 6 },
    ]);
  });

  it('unwraps object Amounts and drops malformed entries', () => {
    expect(
      normalizeOnchainFeeOptions([
        { fee_index: 2, fee_reserve: { toNumber: () => 800 } },
        { fee_index: 3 }, // no reserve
        'garbage',
        null,
      ])
    ).toEqual([{ feeIndex: 2, feeReserveSats: 800, estimatedBlocks: null }]);
  });

  it('returns [] for a non-array', () => {
    expect(normalizeOnchainFeeOptions(undefined)).toEqual([]);
    expect(normalizeOnchainFeeOptions({})).toEqual([]);
  });
});

describe('resolveOnchainMeltFeeDisplay', () => {
  const OPTIONS = [
    { feeIndex: 0, feeReserveSats: 5000, estimatedBlocks: 1 },
    { feeIndex: 1, feeReserveSats: 2000, estimatedBlocks: 6 },
  ];

  it('prefers the settled effective fee as "Network fee"', () => {
    expect(
      resolveOnchainMeltFeeDisplay(
        { feeIndex: 1, feeReserveSats: 2000, effectiveFeeSats: 1450 },
        OPTIONS
      )
    ).toEqual({ title: 'Network fee', sats: 1450 });
  });

  it('falls back to the persisted reserve labeled as a maximum', () => {
    expect(resolveOnchainMeltFeeDisplay({ feeIndex: 1, feeReserveSats: 2000 }, null)).toEqual({
      title: 'Fee reserve (max)',
      sats: 2000,
    });
  });

  it('resolves the reserve from live options via the persisted feeIndex', () => {
    expect(resolveOnchainMeltFeeDisplay({ feeIndex: 1 }, OPTIONS)).toEqual({
      title: 'Fee reserve (max)',
      sats: 2000,
    });
  });

  it('returns null when nothing is known', () => {
    expect(resolveOnchainMeltFeeDisplay(null, OPTIONS)).toBeNull();
    expect(resolveOnchainMeltFeeDisplay({}, null)).toBeNull();
    expect(resolveOnchainMeltFeeDisplay({ feeIndex: 9 }, OPTIONS)).toBeNull();
  });
});
