import { Amount, type Manager } from '@cashu/coco-core';
import {
  buildOnchainItems,
  buildPaymentRequestItems,
  isRailItemCopyable,
} from '@/features/receive/lib/receiveRailItems';

jest.mock('@/shared/stores/global/mintMetadataStore', () => ({
  useMintMetadataStore: { getState: () => ({ getCached: () => undefined }) },
}));

const MINT = 'https://mint.example';
const request = (id: string, state = 'completed') => ({
  id,
  state,
  singleUse: true,
  encodedRequest: 'creqAfixture',
  amount: Amount.from(100),
  unit: 'sat',
  createdAt: 1000,
  updatedAt: 1000,
});
const receive = (id: string, requestOperationId: string) => ({
  id,
  type: 'receive',
  metadata: { requestOperationId },
  createdAt: 1000,
});
const unrelatedPage = () =>
  Array.from({ length: 200 }, (_, i) => ({
    id: `unrelated-${i}`,
    type: 'send',
    createdAt: 500,
  }));
const quote = (quoteId: string, mintUrl = MINT) => ({
  quoteId,
  mintUrl,
  method: 'onchain',
  request: 'bc1fixture',
  quoteData: { amountPaid: Amount.from(100) },
  unit: 'sat',
  createdAt: 1000,
});

function fixture(operations: object[] = [], quotes: object[] = []) {
  const read = jest.fn().mockResolvedValue(unrelatedPage());
  const manager = {
    paymentRequests: { incoming: { list: jest.fn().mockResolvedValue(operations) } },
    quotes: { mint: { listPending: jest.fn().mockResolvedValue(quotes) } },
    history: { getPaginatedHistory: read },
  } as unknown as Manager;
  return { manager, read };
}

test('paid request links stop the history walk as soon as all requested entries are found', async () => {
  const { manager, read } = fixture([
    request('request-1'),
    { ...request('standing-reusable'), singleUse: false },
  ]);
  const linked = receive('receive-1', 'request-1');
  read.mockResolvedValueOnce([linked, ...unrelatedPage().slice(1)]);
  const items = await buildPaymentRequestItems(manager, { standingId: undefined });
  expect(items[0].linkEntry).toEqual(linked);
  expect(read).toHaveBeenCalledTimes(1);
});

test('request linkage continues across full pages until every target is resolved', async () => {
  const { manager, read } = fixture([request('request-1'), request('request-2')]);
  const first = receive('receive-1', 'request-1');
  const second = receive('receive-2', 'request-2');
  read
    .mockResolvedValueOnce([first, ...unrelatedPage().slice(1)])
    .mockResolvedValueOnce([second, ...unrelatedPage().slice(1)]);
  const items = await buildPaymentRequestItems(manager, { standingId: undefined });
  expect(items.map((item) => item.linkEntry?.id)).toEqual(['receive-1', 'receive-2']);
  expect(read.mock.calls).toEqual([
    [0, 200],
    [200, 200],
  ]);
});

test('awaiting requests need no history reads and remain copyable', async () => {
  const { manager, read } = fixture([request('request-1', 'active')]);
  const items = await buildPaymentRequestItems(manager, { standingId: 'request-1' });
  expect(read).not.toHaveBeenCalled();
  expect(items[0]).toMatchObject({ status: 'awaiting', isCurrent: true });
  expect(isRailItemCopyable(items[0].status)).toBe(true);
});

test('missing links remain bounded to 15 pages and do not make paid requests copyable', async () => {
  const { manager, read } = fixture([request('missing')]);
  const items = await buildPaymentRequestItems(manager, { standingId: undefined });
  expect(read).toHaveBeenCalledTimes(15);
  expect(items[0].linkEntry).toBeUndefined();
  expect(isRailItemCopyable(items[0].status)).toBe(false);
});

test('onchain links match both mint and quote before stopping the history walk', async () => {
  const { manager, read } = fixture([], [quote('same-id')]);
  const wrong = {
    id: 'wrong-mint',
    type: 'mint',
    quoteId: 'same-id',
    mintUrl: 'https://other.example',
  };
  const right = { id: 'right-mint', type: 'mint', quoteId: 'same-id', mintUrl: MINT };
  read
    .mockResolvedValueOnce([wrong, ...unrelatedPage().slice(1)])
    .mockResolvedValueOnce([right, ...unrelatedPage().slice(1)]);
  const items = await buildOnchainItems(manager, { standingIds: new Set() });
  expect(items[0].linkEntry).toEqual(right);
  expect(read.mock.calls).toEqual([
    [0, 200],
    [200, 200],
  ]);
  expect(isRailItemCopyable(items[0].status)).toBe(false);
});
