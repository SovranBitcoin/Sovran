/**
 * @jest-environment node
 */

import { PaymentRequest } from '@cashu/cashu-ts';
import { preparePayload } from '@/shared/lib/cashu/paymentRequestNostrTransport';

const noRequests = () => undefined;
const withDefaultUnit = (content: string) => {
  const prepared = preparePayload(content, noRequests);
  if (!prepared.claimable) throw new Error('unexpectedly unclaimable');
  return prepared.content;
};

const proofs = [{ id: '00ab', amount: 2, secret: 's', C: '02cc' }];

describe('preparePayload fills a missing unit', () => {
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

describe('preparePayload with a 0.1.3 payload naming the whole encoded request', () => {
  const held = new PaymentRequest(undefined, 'r1', 8, 'sat', ['https://m.x'], undefined, true);
  const handedOut = held.toEncodedRequest();
  const requestIdFor = (encoded: string) => (encoded === handedOut ? 'r1' : undefined);

  it('swaps in the request id and keeps every amount digit for digit, in order', () => {
    // Above 2^53, so a plain JSON round trip would round it.
    const content = `{"id":"${handedOut}","mint":"https://m.x","unit":"sat","proofs":[{"id":"00ab","amount":9007199254740993,"secret":"s1","C":"02cc"},{"id":"00ab","amount":"8","secret":"s2","C":"02dd"}]}`;
    expect(preparePayload(content, requestIdFor)).toEqual({
      claimable: true,
      content: content.replace(handedOut, 'r1'),
    });
  });

  it('refuses an id that is a valid request this wallet did not hand out', () => {
    const other = new PaymentRequest(undefined, 'r1', 9, 'sat', ['https://m.x'], undefined, true);
    const content = JSON.stringify({
      id: other.toEncodedRequest(),
      mint: 'https://m.x',
      unit: 'sat',
      proofs,
    });
    expect(preparePayload(content, requestIdFor)).toEqual({ claimable: false });
  });

  it('passes a malformed creq id and a plain request id through untouched', () => {
    for (const id of ['creqAnot-a-request', 'r1']) {
      const content = JSON.stringify({ id, mint: 'https://m.x', unit: 'sat', proofs });
      expect(preparePayload(content, requestIdFor)).toEqual({ claimable: true, content });
    }
  });
});
