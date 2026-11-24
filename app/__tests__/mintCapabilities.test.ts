import {
  activeInputFees,
  formatInputFee,
  mintCapabilityPills,
} from '@/features/mint/lib/mintCapabilities';
import { supportedNutNames } from '@/features/mint/lib/mintDetailsRows';

// The Minibits mint's `nuts` as uCash's directory served it on 2026-11-24.
const NUTS = {
  '4': { methods: [{ method: 'bolt11', unit: 'sat' }], disabled: false },
  '5': { methods: [{ method: 'bolt11', unit: 'sat' }], disabled: false },
  '7': { supported: true },
  '8': { supported: true },
  '9': { supported: true },
  '10': { supported: true },
  '11': { supported: true },
  '12': { supported: true },
  '14': { supported: false },
  '17': { supported: [{ method: 'bolt11', unit: 'sat', commands: ['proof_state'] }] },
  '19': { ttl: 604800, cached_endpoints: [] },
  '20': { supported: true },
  '29': { max_batch_size: 1000, methods: ['bolt11'] },
  '31': { supported: true },
};

describe('NUT capability pills', () => {
  it('names each advertised capability once, in NUT order, skipping the baseline and plumbing', () => {
    expect(mintCapabilityPills(NUTS)).toEqual([
      'Lightning fee refunds',
      'Backup restore',
      'Locked ecash',
      'Offline verification',
      'Live payment updates',
      'Safer retries',
      'Signed mint quotes',
      'Batched deposits',
      'NUT-31',
    ]);
  });

  it('uses the same NUT table as the Details sheet, so the two cannot drift', () => {
    expect(supportedNutNames({ '12': { supported: true } })).toEqual(['DLEQ proofs (NUT-12)']);
    expect(mintCapabilityPills({ '12': { supported: true } })).toEqual(['Offline verification']);
  });

  it('reads nothing from a missing or hostile map', () => {
    expect(mintCapabilityPills(undefined)).toEqual([]);
    expect(mintCapabilityPills('nuts')).toEqual([]);
    // Only numbered NUTs are capabilities; a prototype name is not one.
    expect(mintCapabilityPills({ constructor: { supported: true }, '9': null })).toEqual([]);
  });
});

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
