/**
 * DO NOT modify tests to make them pass.
 *
 * A BIP-321 URI arrives from a scanned QR, a deep link or a paste, so its query
 * keys are untrusted. `?constructor=`, `?__proto__=` and `?toString=` must not
 * reach Object.prototype — with a normal object literal they resolve an
 * inherited value, skip the array init and throw out of parsePaymentInput.
 */

import { describe, expect, it } from 'vitest';

import { parsePaymentInput } from '../../src/parse';
import { defaultDetectors } from '../../src/detectors';

const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

describe('BIP-321 query keys that collide with Object.prototype', () => {
  it.each(['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty'])(
    'parses ?%s= without throwing',
    (key) => {
      const uri = `bitcoin:${ADDRESS}?${key}=1&amount=0.001`;
      expect(() => parsePaymentInput(uri, defaultDetectors)).not.toThrow();
    }
  );

  it('still reads a normal param alongside a prototype-shaped one', () => {
    const uri = `bitcoin:${ADDRESS}?__proto__=1&amount=0.001`;
    expect(() => parsePaymentInput(uri, defaultDetectors)).not.toThrow();
  });

  it('does not pollute Object.prototype', () => {
    parsePaymentInput(`bitcoin:${ADDRESS}?__proto__=polluted`, defaultDetectors);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});
