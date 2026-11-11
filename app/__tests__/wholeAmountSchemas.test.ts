/**
 * @jest-environment node
 *
 * Amounts are counted in whole minor units. A payment-request entry reads one
 * from outside the wallet and used to let a fraction through.
 */
import { PaymentRequestEntrySchema } from '@/features/receive/lib/paymentRequestEntry';

const ENTRY = {
  operationId: 'op-1',
  encodedRequest: 'creqAfixture',
  amount: 21,
  unit: 'sat',
  mints: ['https://mint.example'],
};

it('opens the payment-request receive screen with a whole amount', () => {
  expect(PaymentRequestEntrySchema.parse(ENTRY)).toEqual(ENTRY);
});

it.each([1.5, 0, -3, Number.MAX_SAFE_INTEGER + 2])(
  'turns down a payment-request entry whose amount is %p',
  (amount) => {
    expect(PaymentRequestEntrySchema.safeParse({ ...ENTRY, amount }).success).toBe(false);
  }
);
