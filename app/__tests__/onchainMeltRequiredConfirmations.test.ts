/**
 * @jest-environment node
 */
import { getOnchainMeltRequiredConfirmations } from '@/shared/lib/cashu/onchainMelt';

function mintInfoWithNut05Methods(methods: unknown[]): unknown {
  return { nuts: { '5': { methods } } };
}

describe('getOnchainMeltRequiredConfirmations (NUT-05 onchain method options)', () => {
  it('honors the advertised confirmations for the matching unit', () => {
    const info = mintInfoWithNut05Methods([
      { method: 'onchain', unit: 'sat', options: { confirmations: 2 } },
    ]);
    expect(getOnchainMeltRequiredConfirmations(info, 'sat')).toBe(2);
  });

  it('skips methods for other units', () => {
    const info = mintInfoWithNut05Methods([
      { method: 'onchain', unit: 'usd', options: { confirmations: 2 } },
    ]);
    expect(getOnchainMeltRequiredConfirmations(info, 'sat')).toBe(6);
  });

  it('ignores non-onchain methods', () => {
    const info = mintInfoWithNut05Methods([
      { method: 'bolt11', unit: 'sat', options: { confirmations: 1 } },
    ]);
    expect(getOnchainMeltRequiredConfirmations(info, 'sat')).toBe(6);
  });

  it('rejects invalid confirmation values', () => {
    for (const confirmations of [0, -3, 2.5, 'six', null]) {
      const info = mintInfoWithNut05Methods([
        { method: 'onchain', unit: 'sat', options: { confirmations } },
      ]);
      expect(getOnchainMeltRequiredConfirmations(info, 'sat')).toBe(6);
    }
  });

  it('defaults to 6 without mint info', () => {
    expect(getOnchainMeltRequiredConfirmations(undefined, 'sat')).toBe(6);
    expect(getOnchainMeltRequiredConfirmations(null, 'sat')).toBe(6);
    expect(getOnchainMeltRequiredConfirmations({}, 'sat')).toBe(6);
  });

  it('matches a unit case-insensitively and defaults the unit to sat', () => {
    const info = mintInfoWithNut05Methods([
      { method: 'onchain', unit: 'SAT', options: { confirmations: 3 } },
    ]);
    expect(getOnchainMeltRequiredConfirmations(info)).toBe(3);
  });
});
