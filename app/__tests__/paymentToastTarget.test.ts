/**
 * @jest-environment node
 *
 * Where a tap on a payment toast leads, per rail: the saved history entry of
 * that payment, on the screen a history row would open, marked as a history
 * view. A payment with no saved entry opens nothing.
 */

import { guardedRouter } from '@/shared/hooks/useGuardedRouter';
import { isToastTarget, openToastTransaction } from '@/shared/lib/popup/paymentToastTarget';
import type { PaymentToastTarget } from '@/shared/stores/runtime/paymentStatusStore';

jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { navigate: jest.fn() },
}));
jest.mock('@/shared/lib/logger', () => {
  const logger = { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() };
  return { cashuLog: logger, popupLog: logger };
});

const MINT = 'https://mint.example';
const mockHistory: Record<string, unknown>[] = [];
const mockMeltQuoteGet = jest.fn(async (): Promise<{ method: string } | null> => null);
let mockInitialized = true;
jest.mock('@/shared/lib/cashu/manager', () => ({
  CocoManager: {
    isInitialized: () => mockInitialized,
    getInstance: () => ({
      history: { getPaginatedHistory: jest.fn(async () => mockHistory) },
      quotes: { melt: { get: mockMeltQuoteGet } },
    }),
  },
}));

const navigate = jest.mocked(guardedRouter.navigate);
const base = { mintUrl: MINT, unit: 'sat', amount: 100, createdAt: 1, updatedAt: 1 };

const ENTRIES = {
  lightningMelt: { ...base, type: 'melt', id: 'mo-1', quoteId: 'mq-ln', state: 'finalized' },
  onchainMelt: { ...base, type: 'melt', id: 'mo-2', quoteId: 'mq-chain', state: 'finalized' },
  lightningMint: { ...base, type: 'mint', id: 'mi-1', quoteId: 'q-ln', state: 'PAID' },
  onchainMint: {
    ...base,
    type: 'mint',
    id: 'mi-2',
    quoteId: 'q-chain',
    state: 'PAID',
    metadata: { method: 'onchain', onchainAddress: 'bc1qexample' },
  },
  send: { ...base, type: 'send', id: 'so-1', operationId: 'so-1', state: 'finalized' },
  receive: { ...base, type: 'receive', id: 'entry-1', operationId: 'ro-1', state: 'finalized' },
};

async function open(target: PaymentToastTarget, mintUrl = MINT) {
  const opened = await openToastTransaction(target, mintUrl);
  // The melt route may resolve its method a tick later.
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  const call = navigate.mock.calls[0]?.[0] as
    { pathname: string; params: Record<string, string> } | undefined;
  return { opened, call };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockInitialized = true;
  mockHistory.length = 0;
  mockHistory.push(...Object.values(ENTRIES));
  mockMeltQuoteGet.mockImplementation(async (...args: unknown[]) => {
    const { quoteId } = (args[0] ?? {}) as { quoteId?: string };
    return { method: quoteId === 'mq-chain' ? 'onchain' : 'bolt11' };
  });
});

describe('openToastTransaction', () => {
  it.each([
    [
      'a Lightning send',
      { type: 'melt', quoteId: 'mq-ln' },
      '/lightningSend',
      'meltHistoryEntry',
      ENTRIES.lightningMelt,
    ],
    [
      'an on-chain send',
      { type: 'melt', quoteId: 'mq-chain' },
      '/onchainSend',
      'meltHistoryEntry',
      ENTRIES.onchainMelt,
    ],
    [
      'a Lightning receive',
      { type: 'mint', quoteId: 'q-ln' },
      '/lightningReceive',
      'mintHistoryEntry',
      ENTRIES.lightningMint,
    ],
    [
      'an on-chain receive',
      { type: 'mint', quoteId: 'q-chain' },
      '/onchainReceive',
      'mintHistoryEntry',
      ENTRIES.onchainMint,
    ],
    [
      'an ecash send or a paid payment request',
      { type: 'send', operationId: 'so-1' },
      '/sendToken',
      'sendHistoryEntry',
      ENTRIES.send,
    ],
    [
      'an ecash receive, by its entry',
      { type: 'receive', entryId: 'entry-1' },
      '/receiveToken',
      'receiveHistoryEntry',
      ENTRIES.receive,
    ],
    [
      'a claimed payment request, by its operation',
      { type: 'receive', operationId: 'ro-1' },
      '/receiveToken',
      'receiveHistoryEntry',
      ENTRIES.receive,
    ],
  ] as const)(
    'opens %s on its own screen, as a history view',
    async (_, target, pathname, param, entry) => {
      const { opened, call } = await open(target as PaymentToastTarget);
      expect(opened).toBe(true);
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(call?.pathname).toBe(pathname);
      expect(call?.params.historyView).toBe('1');
      // The saved entry itself: nothing about it is made up.
      expect(JSON.parse(call!.params[param]!)).toEqual(entry);
    }
  );

  it('opens nothing when the transaction is not saved yet', async () => {
    const { opened } = await open({ type: 'melt', quoteId: 'mq-not-yet' });
    expect(opened).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('opens nothing for the same id at another mint, or of another kind', async () => {
    expect((await open({ type: 'melt', quoteId: 'mq-ln' }, 'https://other.example')).opened).toBe(
      false
    );
    expect((await open({ type: 'mint', quoteId: 'mq-ln' })).opened).toBe(false);
    expect((await open({ type: 'receive' })).opened).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('opens nothing before the wallet is ready', async () => {
    mockInitialized = false;
    expect((await open({ type: 'melt', quoteId: 'mq-ln' })).opened).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('isToastTarget', () => {
  it('matches a send by its operation or, for an entry without one, by its id', () => {
    const target: PaymentToastTarget = { type: 'send', operationId: 'so-9' };
    const send = (fields: Record<string, unknown>) => {
      const entry: Record<string, unknown> = { ...base, type: 'send', ...fields };
      return isToastTarget(entry as never, target, MINT);
    };
    expect(send({ id: 'x', operationId: 'so-9' })).toBe(true);
    expect(send({ id: 'so-9' })).toBe(true);
    expect(send({ id: 'x' })).toBe(false);
  });
});
