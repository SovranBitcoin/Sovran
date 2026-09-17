/**
 * Every glyph `wallet/src/payment-methods.ts` can return must be baked into
 * the committed icon registry.
 *
 * The registry is generated at build time from a literal list in
 * `assets/icons/index.tsx`; a name that is missing renders the "missing icon"
 * question mark at runtime with no error. Custom NUT-04 methods are exactly
 * where that would bite — the icon for a `venmo` rail is chosen by a lookup
 * table the icon scanner resolves statically, but the FALLBACK glyph is a
 * bare constant it cannot see, and the whole point of the fallback is that it
 * renders for a method nobody anticipated.
 */

import { PAYMENT_METHOD_ICONS, getPaymentMethodIcon } from 'wallet';

import registry from '../assets/icons/generated.json';

const registryNames = new Set(Object.keys(registry));

describe('payment-method icons', () => {
  it.each([...PAYMENT_METHOD_ICONS])('%s is in the committed registry', (name) => {
    expect(registryNames.has(name)).toBe(true);
  });

  it('resolves an unknown method to a registered fallback glyph', () => {
    expect(registryNames.has(getPaymentMethodIcon('a_method_nobody_has_shipped'))).toBe(true);
  });
});
