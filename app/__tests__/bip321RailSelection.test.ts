import {
  deriveBip321RailSelection,
  REASON_LAST_RAIL,
} from '@/features/receive/lib/bip321RailSelection';

const allAvailable = { onchain: true, bolt12: true, creq: true };

describe('BIP-321 rail selection', () => {
  it('keeps the fixed display order and all available methods included by default', () => {
    const result = deriveBip321RailSelection({ available: allAvailable, excluded: {} });
    expect(result.rails).toEqual([
      { id: 'onchain', label: 'Onchain', state: 'included' },
      { id: 'bolt12', label: 'BOLT 12', state: 'included' },
      { id: 'creq', label: 'Cashu', state: 'included' },
    ]);
    expect(result.enabledCount).toBe(3);
    expect(result.needsExclusionReset).toBe(false);
  });

  it('locks the last enabled rail while excluded rails remain switchable', () => {
    const result = deriveBip321RailSelection({
      available: allAvailable,
      excluded: { onchain: true, bolt12: true },
    });
    expect(result.rails.map((rail) => rail.state)).toEqual(['off', 'off', 'included']);
    expect(result.rails[2].reason).toBe(REASON_LAST_RAIL);
    expect(result.rails[0].reason).toBeUndefined();
    expect(result.enabledCount).toBe(1);
  });

  it('never calls an unavailable excluded rail off', () => {
    const result = deriveBip321RailSelection({
      available: { ...allAvailable, bolt12: false },
      excluded: { bolt12: true },
    });
    expect(result.rails[1]).toMatchObject({ state: 'unavailable', reason: expect.any(String) });
    expect(result.enabledCount).toBe(2);
    expect(result.needsExclusionReset).toBe(false);
  });

  it('restores the available set when persisted exclusions leave zero methods', () => {
    const excluded = { onchain: true, bolt12: true, creq: true };
    const result = deriveBip321RailSelection({ available: allAvailable, excluded });
    expect(result.needsExclusionReset).toBe(true);
    expect(result.enabledCount).toBe(3);
    expect(result.rails.every((rail) => rail.state === 'included')).toBe(true);
    expect(excluded).toEqual({ onchain: true, bolt12: true, creq: true });
  });

  it('recovers and locks the sole available method after a capability change', () => {
    const result = deriveBip321RailSelection({
      available: { onchain: false, bolt12: false, creq: true },
      excluded: { creq: true },
    });
    expect(result.needsExclusionReset).toBe(true);
    expect(result.enabledCount).toBe(1);
    expect(result.rails[2]).toMatchObject({ state: 'included', reason: REASON_LAST_RAIL });
  });

  it('does not reset exclusions when nothing is available', () => {
    const result = deriveBip321RailSelection({
      available: { onchain: false, bolt12: false, creq: false },
      excluded: { creq: true },
    });
    expect(result.enabledCount).toBe(0);
    expect(result.needsExclusionReset).toBe(false);
    expect(result.rails.every((rail) => rail.state === 'unavailable')).toBe(true);
  });

  it('treats explicit false exclusions as included', () => {
    const result = deriveBip321RailSelection({
      available: allAvailable,
      excluded: { bolt12: false },
    });
    expect(result.enabledCount).toBe(3);
    expect(result.rails[1].state).toBe('included');
  });
});
