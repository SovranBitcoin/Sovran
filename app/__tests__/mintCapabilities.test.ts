import { activeInputFees, formatInputFee } from '@/features/mint/lib/mintCapabilities';
import { buildMintDetailsRows } from '@/features/mint/lib/mintDetailsRows';

describe('NUT-02 input_fee_ppk', () => {
  it('reads the active keysets per unit, from Coco (feePpk) or the mint (input_fee_ppk)', () => {
    expect(
      activeInputFees([
        { unit: 'sat', active: true, feePpk: 100 },
        { unit: 'sat', active: false, feePpk: 1000 },
        { unit: 'usd', active: true, input_fee_ppk: 0 },
        { unit: 'SAT', active: true, input_fee_ppk: 250 },
      ])
    ).toEqual([
      { unit: 'sat', ppk: 250 },
      { unit: 'usd', ppk: 0 },
    ]);
  });

  it('treats a keyset that states no fee as free, and ignores nonsense', () => {
    expect(activeInputFees([{ unit: 'sat', active: true }])).toEqual([{ unit: 'sat', ppk: 0 }]);
    expect(activeInputFees([{ unit: 'sat', active: true, feePpk: Number.NaN }])).toEqual([
      { unit: 'sat', ppk: 0 },
    ]);
    expect(activeInputFees([])).toEqual([]);
  });

  it('says the fee per coin spent in the unit itself', () => {
    expect(formatInputFee({ unit: 'sat', ppk: 0 })).toBe('sat: no spending fee');
    expect(formatInputFee({ unit: 'sat', ppk: 100 })).toBe('sat: 0.1 sat per coin spent');
    expect(formatInputFee({ unit: 'sat', ppk: 1000 })).toBe('sat: 1 sat per coin spent');
    expect(formatInputFee({ unit: 'usd', ppk: 1 })).toBe('usd: 0.001 usd per coin spent');
  });
});

describe('Spending fee in Mint Details', () => {
  const row = (inputFees?: Parameters<typeof buildMintDetailsRows>[0]['inputFees']) =>
    buildMintDetailsRows({ mintUrl: 'https://mint.example', inputFees, now: 0 }).find(
      (item) => item.title === 'Spending fee'
    );

  it('lists each unit on its own line, in the same words as before', () => {
    expect(
      row([
        { unit: 'sat', ppk: 100 },
        { unit: 'usd', ppk: 0 },
      ])
    ).toEqual({
      group: 'Mint',
      title: 'Spending fee',
      value: 'sat: 0.1 sat per coin spent\nusd: no spending fee',
    });
  });

  it('leaves the row out until the keysets are known', () => {
    expect(row(undefined)).toBeUndefined();
    expect(row(null)).toBeUndefined();
    expect(row([])).toBeUndefined();
  });
});
