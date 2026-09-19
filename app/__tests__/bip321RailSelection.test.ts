import { deriveBip321RailSelection } from '@/features/receive/lib/bip321RailSelection';

describe('BIP-321 rail selection', () => {
  it('includes every available rail, in the fixed display order', () => {
    expect(
      deriveBip321RailSelection({ available: { onchain: true, bolt12: true, creq: true } }).rails
    ).toEqual([
      { id: 'onchain', label: 'Onchain', state: 'included' },
      { id: 'bolt12', label: 'BOLT 12', state: 'included' },
      { id: 'creq', label: 'Cashu', state: 'included' },
    ]);
  });

  it('keeps an unavailable rail listed with a reason instead of dropping it', () => {
    expect(
      deriveBip321RailSelection({ available: { onchain: true, bolt12: false, creq: true } })
        .rails[1]
    ).toEqual({
      id: 'bolt12',
      label: 'BOLT 12',
      state: 'unavailable',
      reason: 'BOLT 12 is unavailable',
    });
  });
});
