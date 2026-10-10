/**
 * @jest-environment node
 */

import { withDefaultUnit } from '@/shared/lib/cashu/paymentRequestNostrTransport';

describe('withDefaultUnit', () => {
  const proofs = [{ id: '00ab', amount: 2, secret: 's', C: '02cc' }];

  it('fills sat when a payer omits the unit', () => {
    const content = JSON.stringify({ id: 'r1', mint: 'https://m.x', proofs });
    expect(JSON.parse(withDefaultUnit(content))).toEqual({
      id: 'r1',
      mint: 'https://m.x',
      proofs,
      unit: 'sat',
    });
  });

  it('passes a complete payload and non-JSON through byte for byte', () => {
    const content = `{ "id" : "r1", "mint":"https://m.x", "unit":"usd", "proofs": ${JSON.stringify(proofs)} }`;
    expect(withDefaultUnit(content)).toBe(content);
    expect(withDefaultUnit('cashuBxyz')).toBe('cashuBxyz');
  });
});
