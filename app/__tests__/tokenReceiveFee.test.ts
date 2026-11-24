/**
 * @jest-environment node
 *
 * The fee a token pays to be redeemed (NUT-02): the sum of its proofs' keyset
 * `input_fee_ppk`, rounded up to a whole unit, read from saved keysets only.
 * Any proof whose keyset is unknown makes the figure unknown.
 */
import { Amount, getEncodedToken } from '@cashu/cashu-ts';

import { tokenReceiveFee } from '@/features/receive/lib/tokenReceiveFee';

const KEYSET = '009a1f293253e41e';
const OTHER = '00ad268c4d1f5826';
const proof = (id: string, amount: number, n: number) => ({
  id,
  amount: Amount.from(amount),
  secret: n.toString(16).padStart(64, '0'),
  C: `02${'ef'.repeat(32)}`,
});
const token = (proofs: ReturnType<typeof proof>[]) =>
  getEncodedToken({ mint: 'https://mint.example', unit: 'sat', proofs });

it('rounds the summed per-proof fee up to a whole unit', () => {
  const t = token([proof(KEYSET, 8, 1), proof(KEYSET, 2, 2), proof(KEYSET, 1, 3)]);
  expect(tokenReceiveFee(t, [{ id: KEYSET, feePpk: 100 }])).toBe(1);
  expect(tokenReceiveFee(t, [{ id: KEYSET, feePpk: 400 }])).toBe(2);
  expect(tokenReceiveFee(t, [{ id: KEYSET, feePpk: 1000 }])).toBe(3);
});

it('charges each proof its own keyset fee', () => {
  const t = token([proof(KEYSET, 8, 1), proof(OTHER, 2, 2)]);
  expect(
    tokenReceiveFee(t, [
      { id: KEYSET, feePpk: 0 },
      { id: OTHER, feePpk: 1500 },
    ])
  ).toBe(2);
});

it('is zero for a free keyset or one that states no fee', () => {
  const t = token([proof(KEYSET, 8, 1)]);
  expect(tokenReceiveFee(t, [{ id: KEYSET, feePpk: 0 }])).toBe(0);
  expect(tokenReceiveFee(t, [{ id: KEYSET }])).toBe(0);
});

it('is unknown when a keyset is missing, the fee is malformed, or the token does not decode', () => {
  const t = token([proof(KEYSET, 8, 1), proof(OTHER, 2, 2)]);
  expect(tokenReceiveFee(t, [{ id: KEYSET, feePpk: 100 }])).toBeUndefined();
  expect(tokenReceiveFee(t, [])).toBeUndefined();
  expect(
    tokenReceiveFee(token([proof(KEYSET, 8, 1)]), [{ id: KEYSET, feePpk: Number.NaN }])
  ).toBeUndefined();
  expect(tokenReceiveFee('cashuBnotatoken', [{ id: KEYSET, feePpk: 100 }])).toBeUndefined();
});
