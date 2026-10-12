/**
 * @jest-environment node
 *
 * Amounts are counted in whole minor units. Two places read one from outside
 * the wallet and used to let a fraction through.
 */
import { PaymentRequestEntrySchema } from '@/features/receive/lib/paymentRequestEntry';
import { RoutstrMsats } from '@/shared/lib/routstr/api';

jest.mock('@react-native-async-storage/async-storage', () => {
  const storage = {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  };
  return { __esModule: true, default: storage, ...storage };
});

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

it('reads a provider balance as whole millisats, rounding a fraction instead of refusing it', () => {
  expect(RoutstrMsats.parse(41_500)).toBe(41_500);
  expect(RoutstrMsats.parse(41_500.4)).toBe(41_500);
  expect(RoutstrMsats.parse(41_500.5)).toBe(41_501);
  expect(RoutstrMsats.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
  expect(RoutstrMsats.safeParse('41500').success).toBe(false);
});
