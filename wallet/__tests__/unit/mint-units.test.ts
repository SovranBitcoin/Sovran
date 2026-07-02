import { describe, expect, it } from 'vitest';

import { deriveSupportedUnitsFromInfo, SWITCHABLE_UNITS } from '../../src/mint-capabilities';

function mintInfo(methods: { method: string; unit: string }[]) {
  return { nuts: { '4': { methods } } };
}

describe('deriveSupportedUnitsFromInfo', () => {
  it('collects switchable units the mint advertises for minting', () => {
    const info = mintInfo([
      { method: 'bolt11', unit: 'sat' },
      { method: 'bolt11', unit: 'usd' },
      { method: 'onchain', unit: 'sat' },
    ]);
    expect(deriveSupportedUnitsFromInfo(info).sort()).toEqual(['sat', 'usd']);
  });

  it('ignores units outside the switchable set', () => {
    const info = mintInfo([
      { method: 'bolt11', unit: 'sat' },
      { method: 'bolt11', unit: 'chf' },
      { method: 'bolt11', unit: 'msat' },
    ]);
    expect(deriveSupportedUnitsFromInfo(info)).toEqual(['sat']);
  });

  it('normalizes unit casing', () => {
    const info = mintInfo([{ method: 'bolt11', unit: 'USD' }]);
    expect(deriveSupportedUnitsFromInfo(info)).toEqual(['usd']);
  });

  it('falls back to sat when metadata is missing or unparseable', () => {
    expect(deriveSupportedUnitsFromInfo(undefined)).toEqual(['sat']);
    expect(deriveSupportedUnitsFromInfo({})).toEqual(['sat']);
    expect(deriveSupportedUnitsFromInfo({ nuts: { '4': { methods: 'nope' } } })).toEqual(['sat']);
  });

  it('keeps the switcher order stable', () => {
    expect(SWITCHABLE_UNITS).toEqual(['sat', 'usd', 'eur', 'gbp']);
  });
});
