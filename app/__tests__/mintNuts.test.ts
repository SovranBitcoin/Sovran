/**
 * @jest-environment node
 */
import {
  mintMethodsFromNuts,
  meltMethodsFromNuts,
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
