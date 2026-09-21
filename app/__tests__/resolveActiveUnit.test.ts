/**
 * @jest-environment node
 *
 * The wallet's active unit must not flip while the unit set is still unknown.
 * Mint info and keysets load asynchronously, and `sat` is seeded into the list
 * unconditionally — so "only sat is available" means either "nothing loaded
 * yet" or "no mint offers anything else", and treating those alike retired the
 * user's unit and restored it repeatedly. Every per-unit derivation in between
 * (the capability map, the rails a mint can serve, the bounds gating them) was
 * computed for the wrong unit.
 */
import { resolveActiveUnit } from '@/features/wallet/hooks/useActiveUnit';

describe('resolveActiveUnit', () => {
  it('keeps the persisted unit while nothing has reported yet', () => {
    expect(resolveActiveUnit('usd', { units: ['sat'], resolved: false })).toBe('usd');
  });

  it('retires it only once a mint has actually answered', () => {
    expect(resolveActiveUnit('usd', { units: ['sat'], resolved: true })).toBe('sat');
  });

  it('keeps a supported unit whether or not anything else has loaded', () => {
    expect(resolveActiveUnit('usd', { units: ['sat', 'usd'], resolved: true })).toBe('usd');
    expect(resolveActiveUnit('usd', { units: ['sat', 'usd'], resolved: false })).toBe('usd');
  });

  it('keeps a testnut account unit on the same rule', () => {
    expect(resolveActiveUnit('tsat', { units: ['sat'], resolved: false })).toBe('tsat');
    expect(resolveActiveUnit('tsat', { units: ['sat', 'tsat'], resolved: true })).toBe('tsat');
  });
});
