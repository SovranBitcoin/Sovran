/**
 * @jest-environment node
 */
import {
  mintMethodsFromNuts,
  meltMethodsFromNuts,
  mintMethodUnitPairsFromNuts,
  nutSupported,
} from '@/shared/lib/cashu/mintNuts';

const NUTS = {
  '4': {
    methods: [
      { method: 'bolt11', unit: 'sat' },
      { method: 'BOLT11', unit: 'usd' }, // case-dupe — must dedupe
      { method: 'bolt12', unit: 'sat' },
    ],
  },
  '5': { methods: [{ method: 'bolt11', unit: 'sat' }] },
  '7': { supported: true },
  '10': { supported: false },
  '17': { supported: [{ method: 'bolt11', unit: 'sat', commands: ['bolt11_mint_quote'] }] },
};

describe('mintNuts readers', () => {
  it('derives mint/melt methods with case-insensitive dedupe', () => {
    expect(mintMethodsFromNuts(NUTS)).toEqual(['bolt11', 'bolt12']);
    expect(meltMethodsFromNuts(NUTS)).toEqual(['bolt11']);
  });

  it('extracts NUT-04 (method, unit) pairs, lowercased and deduped', () => {
    expect(mintMethodUnitPairsFromNuts(NUTS)).toEqual([
      { method: 'bolt11', unit: 'sat' },
      { method: 'bolt11', unit: 'usd' }, // BOLT11 lowercased
      { method: 'bolt12', unit: 'sat' },
    ]);
    // NUT-05 on request
    expect(mintMethodUnitPairsFromNuts(NUTS, '5')).toEqual([{ method: 'bolt11', unit: 'sat' }]);
  });

  it('drops pair entries missing a method or unit (and is defensive)', () => {
    const partial: unknown = {
      '4': { methods: [{ method: 'bolt12' }, { unit: 'sat' }, { method: 'onchain', unit: 'SAT' }] },
    };
    expect(mintMethodUnitPairsFromNuts(partial as never)).toEqual([
      { method: 'onchain', unit: 'sat' },
    ]);
    expect(mintMethodUnitPairsFromNuts(undefined)).toEqual([]);
  });

  it('reads boolean and array-form supported flags', () => {
    expect(nutSupported(NUTS, '7')).toBe(true);
    expect(nutSupported(NUTS, '10')).toBe(false);
    expect(nutSupported(NUTS, '17')).toBe(true); // non-empty supported array
    expect(nutSupported(NUTS, '12')).toBe(false); // absent
  });

  it('is defensive against malformed shapes', () => {
    const nutIsString: unknown = { '4': 'garbage' };
    const methodsIsString: unknown = { '4': { methods: 'nope' } };
    const methodEntriesMalformed: unknown = { '4': { methods: [null, { unit: 'sat' }] } };
    const supportedIsString: unknown = { '7': { supported: 'yes' } };
    expect(mintMethodsFromNuts(undefined)).toEqual([]);
    expect(mintMethodsFromNuts(nutIsString as never)).toEqual([]);
    expect(mintMethodsFromNuts(methodsIsString as never)).toEqual([]);
    expect(mintMethodsFromNuts(methodEntriesMalformed as never)).toEqual([]);
    expect(nutSupported(supportedIsString as never, '7')).toBe(false);
  });
});
