import { act, renderHook } from '@testing-library/react-native';
import { Amount } from '@cashu/coco-core';
import { useMintRebalanceOrchestrator } from '@/features/mint/hooks/useMintRebalanceOrchestrator';
import type { RebalancePlan } from '@/features/mint/components/rebalance/rebalancePlanner';
import { cashuLog } from '@/shared/lib/logger';
import { setTransactionAnnotation } from '@/shared/stores/profile/transactionAnnotationStore';

jest.mock('@cashu/coco-react', () => ({ useManager: () => mockManager }));
jest.mock('@/shared/lib/cashu/manager', () => ({
  CocoManager: { restoreInflightProofsForMint: (...args: unknown[]) => mockRestore(...args) },
}));
jest.mock('@/shared/lib/cashu/managerInternals', () => ({
  getReadyProofs: async () => [],
  getWallet: async () => ({
    getFeesForProofs: () => 0,
    createMeltQuoteBolt11: async () => ({ fee_reserve: 0 }),
  }),
}));
jest.mock('@/shared/lib/cashu/cocoFeedback', () => ({ reportCocoApiFailure: jest.fn() }));
jest.mock('@/shared/lib/apiClient', () => ({ auditMint: jest.fn() }));
jest.mock('@/shared/lib/logger', () => ({
  cashuLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() },
  mintUrlLogFields: () => ({}),
}));
jest.mock('@/shared/lib/popup', () => ({ swapStatusPopup: jest.fn() }));
jest.mock('@/shared/stores/profile/transactionAnnotationStore', () => ({
  setTransactionAnnotation: jest.fn(),
}));
jest.mock('@/shared/stores/profile/swapTransactionsStore', () => ({
  useSwapTransactionsStore: { getState: () => mockTransactions },
}));
jest.mock('@/shared/stores/runtime/swapStatusStore', () => ({
  useSwapStatusStore: { getState: () => mockStatus },
}));
// Keep rendering-only barrel imports outside the harness. The real run-state
// helpers and quote preparation wrappers still execute against the fake manager.
jest.mock('@/features/mint/components/rebalance', () => ({
  MIN_FEE_RESERVE: 5,
  buildSwapGraph: jest.fn(),
  pickIntermediaryPath: jest.fn(),
  addLocalHistoryEdges: jest.fn(),
  getLocalCandidatesForDestination: () => mockLocalCandidates,
  releaseTrustWindow: (...args: unknown[]) => mockReleaseTrust(...args),
  formatStrandedRoutingDetail: () => '',
}));

const SOURCE = 'https://source.example';
const DESTINATION = 'https://destination.example';
const mockRestore = jest.fn().mockResolvedValue(undefined);
const mockReleaseTrust = jest.fn().mockResolvedValue({ stranded: [], untrustErrors: [] });
let mockLocalCandidates: string[] = [];
const mockTransactions = {
  groups: {},
  startGroup: jest.fn(() => 'group-1'),
  addLeg: jest.fn(() => 'leg-1'),
  setLegStatus: jest.fn(),
  tagMintQuote: jest.fn(),
  tagMelt: jest.fn(),
  finalizeGroup: jest.fn(),
};
const mockStatus = {
  active: null as { state: string } | null,
  start: jest.fn(() => {
    mockStatus.active = { state: 'running' };
  }),
  setActiveLeg: jest.fn(),
  setLegDone: jest.fn(),
  setLegSkipped: jest.fn(),
  setLegFailed: jest.fn(),
  complete: jest.fn(),
  fail: jest.fn(),
  cancel: jest.fn(),
};
let destinationBalance = 0;
let mintState = 'pending';
const operation = () => ({
  id: 'mint-op-1',
  quoteId: 'mint-quote-1',
  mintUrl: DESTINATION,
  method: 'bolt11',
  request: 'lnbc-fixture',
  amount: Amount.from(100),
  unit: 'sat',
  state: mintState,
  createdAt: 1000,
  updatedAt: 1000,
});
let mockManager: ReturnType<typeof createManager>;
function createManager() {
  return {
    wallet: {
      balances: {
        byMint: jest.fn(async () => ({
          [SOURCE]: { total: Amount.from(1000) },
          [DESTINATION]: { total: Amount.from(destinationBalance) },
        })),
      },
    },
    quotes: {
      mint: {
        create: jest.fn(
          async (_input: { mintUrl: string; amount: { amount: number; unit: string } }) => ({
            quoteId: 'mint-quote-1',
            mintUrl: DESTINATION,
            unit: 'sat',
            request: 'lnbc-fixture',
          })
        ),
      },
      melt: { create: jest.fn(async () => ({ quoteId: 'melt-quote-1', mintUrl: SOURCE })) },
    },
    ops: {
      mint: {
        prepare: jest.fn(async (_input: { quote: { quoteId: string }; amount: number }) =>
          operation()
        ),
        get: jest.fn(async (_id: string) => operation()),
      },
      melt: {
        prepare: jest.fn(async () => ({
          id: 'melt-op-1',
          quoteId: 'melt-quote-1',
          amount: Amount.from(100),
          fee_reserve: 0,
          swap_fee: 0,
        })),
        execute: jest.fn(async () => {
          mintState = 'finalized';
          destinationBalance = 100;
          return { id: 'melt-op-1', state: 'finalized' };
        }),
        refresh: jest.fn(async () => ({ id: 'melt-op-1', state: 'finalized' })),
      },
    },
    mint: { addMint: jest.fn().mockResolvedValue(undefined) },
  };
}
const plan: RebalancePlan = {
  steps: [{ id: 'step-1', fromMintUrl: SOURCE, toMintUrl: DESTINATION, amount: 100 }],
  totalAmount: 100,
  currentBalances: { [SOURCE]: 1000, [DESTINATION]: 0 },
  targetBalances: { [SOURCE]: 900, [DESTINATION]: 100 },
};
function mount(unit = 'sat') {
  return renderHook(() =>
    useMintRebalanceOrchestrator({
      unit,
      computedPlan: plan,
      trustedMints: [{ mintUrl: SOURCE }, { mintUrl: DESTINATION }],
      mintInfoMap: {},
      middlemanRouting: {
        maxHops: 2,
        maxFee: 5,
        minSuccessRate: 0.9,
        requireLastOk: true,
        trustMode: 'trusted_only',
      },
      minTransferThreshold: 5,
    })
  );
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockStatus.active = null;
  destinationBalance = 0;
  mintState = 'pending';
  mockLocalCandidates = [];
  mockManager = createManager();
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test('a destination already credited by the time melt returns does not wait another 15 seconds', async () => {
  const { result } = mount();
  await act(async () => result.current.handleStart());
  expect(mockManager.ops.melt.execute).toHaveBeenCalledTimes(1);
  expect(destinationBalance).toBe(100);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(500);
  });
  expect(result.current.runStatus).toBe('finished');
  expect(mockStatus.complete).toHaveBeenCalledTimes(1);
});

function keepRecipientPending() {
  mockManager.ops.melt.execute.mockImplementation(async () => ({
    id: 'melt-op-1',
    state: 'finalized',
  }));
}

test('delayed finalization of the exact recipient operation releases verification without a balance delta', async () => {
  keepRecipientPending();
  const { result } = mount();
  await act(async () => result.current.handleStart());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1000);
  });
  expect(result.current.stepStates['step-1'].status).toBe('verifying');
  mintState = 'finalized';
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1500);
  });
  expect(result.current.runStatus).toBe('finished');
  expect(mockRestore).not.toHaveBeenCalled();
});

test('an unrelated deposit cannot release verification while the owned recipient operation is pending', async () => {
  keepRecipientPending();
  const { result } = mount();
  await act(async () => result.current.handleStart());
  destinationBalance = 999;
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1500);
  });
  expect(result.current.stepStates['step-1'].status).toBe('verifying');
  expect(mockStatus.setLegDone).not.toHaveBeenCalled();
});

test('an insufficient finalized recipient amount cannot release verification', async () => {
  keepRecipientPending();
  const { result } = mount();
  await act(async () => result.current.handleStart());
  mockManager.ops.mint.get.mockImplementation(async () => ({
    ...operation(),
    state: 'finalized',
    amount: Amount.from(99),
  }));
  destinationBalance = 99;
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1500);
  });
  expect(result.current.stepStates['step-1'].status).toBe('verifying');
});

test('recipient verification keeps the existing 15-second timeout and never repeats a successful melt', async () => {
  keepRecipientPending();
  const { result } = mount();
  await act(async () => result.current.handleStart());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(14999);
  });
  expect(result.current.runStatus).toBe('running');
  await act(async () => {
    await jest.advanceTimersByTimeAsync(501);
  });
  expect(result.current.runStatus).toBe('finished');
  expect(mockManager.ops.melt.execute).toHaveBeenCalledTimes(1);
  expect(mockRestore).not.toHaveBeenCalled();
  expect(cashuLog.warn).toHaveBeenCalledWith('mint.rebalance.balance_timeout');
});

test('a finalized recipient operation with unrecovered-proof error cannot release verification', async () => {
  mockManager.ops.mint.get.mockImplementation(async () => ({
    ...operation(),
    error: 'Issued quote but no proofs restored',
  }));
  const { result } = mount();
  await act(async () => result.current.handleStart());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(500);
  });
  expect(result.current.stepStates['step-1'].status).toBe('verifying');
});

test('recipient verification must match the prepared operation unit', async () => {
  mockManager.ops.mint.prepare.mockImplementation(async () => ({ ...operation(), unit: 'usd' }));
  // The returned snapshot has the right id/quote but the wrong unit.
  const { result } = mount('usd');
  await act(async () => result.current.handleStart());
  destinationBalance = 200;
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1500);
  });
  expect(result.current.stepStates['step-1'].status).toBe('verifying');
});

test('cancellation stops verification reads and never publishes a late done state', async () => {
  keepRecipientPending();
  const { result } = mount();
  await act(async () => result.current.handleStart());
  act(() => result.current.handleCancelRun());
  const reads = mockManager.ops.mint.get.mock.calls.length;
  mintState = 'finalized';
  destinationBalance = 100;
  await act(async () => {
    await jest.advanceTimersByTimeAsync(16000);
  });
  expect(result.current.runStatus).toBe('cancelled');
  expect(mockManager.ops.mint.get).toHaveBeenCalledTimes(reads);
  expect(mockStatus.setLegDone).not.toHaveBeenCalled();
});

test('a replaced manager cannot publish settlement or schedule later legs for the old account', async () => {
  keepRecipientPending();
  const { result, rerender } = mount();
  await act(async () => result.current.handleStart());
  const previous = mockManager;
  const reads = previous.ops.mint.get.mock.calls.length;
  mockManager = createManager();
  rerender({});
  mintState = 'finalized';
  destinationBalance = 100;
  await act(async () => {
    await jest.advanceTimersByTimeAsync(16000);
  });
  expect(previous.ops.mint.get).toHaveBeenCalledTimes(reads);
  expect(mockManager.ops.mint.get).not.toHaveBeenCalled();
  expect(mockStatus.setLegDone).not.toHaveBeenCalled();
  expect(mockStatus.complete).not.toHaveBeenCalled();
});

test('Coco v2 finalized operation returned by melt refresh completes without the legacy decision-string timeout', async () => {
  mockManager.ops.melt.execute.mockImplementation(async () => ({
    id: 'melt-op-1',
    state: 'pending',
  }));
  mockManager.ops.melt.refresh.mockImplementation(async () => {
    mintState = 'finalized';
    destinationBalance = 100;
    return { id: 'melt-op-1', state: 'finalized' };
  });
  const { result } = mount();
  await act(async () => result.current.handleStart());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(500);
  });
  expect(result.current.runStatus).toBe('finished');
  expect(mockManager.ops.melt.refresh).toHaveBeenCalledTimes(1);
  expect(mockRestore).not.toHaveBeenCalled();
});

test('Coco v2 rolled-back operation returned by melt refresh fails immediately without paying again', async () => {
  mockManager.ops.melt.execute.mockImplementation(async () => ({
    id: 'melt-op-1',
    state: 'pending',
  }));
  mockManager.ops.melt.refresh.mockResolvedValue({ id: 'melt-op-1', state: 'rolled_back' });
  const { result } = mount();
  await act(async () => result.current.handleStart());
  expect(result.current.stepStates['step-1'].status).toBe('failed');
  expect(mockManager.ops.melt.refresh).toHaveBeenCalledTimes(1);
  expect(mockManager.ops.melt.execute).toHaveBeenCalledTimes(1);
});

test('cancelling a pending melt stops further status RPCs without retrying the payment', async () => {
  mockManager.ops.melt.execute.mockResolvedValue({ id: 'melt-op-1', state: 'pending' });
  mockManager.ops.melt.refresh.mockResolvedValue({ id: 'melt-op-1', state: 'pending' });
  const { result } = mount();
  await act(async () => result.current.handleStart());
  expect(mockManager.ops.melt.refresh).toHaveBeenCalledTimes(1);
  act(() => result.current.handleCancelRun());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(10000);
  });
  expect(mockManager.ops.melt.refresh).toHaveBeenCalledTimes(1);
  expect(mockManager.ops.melt.execute).toHaveBeenCalledTimes(1);
  expect(mockStatus.setLegDone).not.toHaveBeenCalled();
  expect(mockRestore).not.toHaveBeenCalled();
});

test('a late outgoing-manager melt error cannot invoke global recovery after manager replacement', async () => {
  let reject!: (error: Error) => void;
  mockManager.ops.melt.execute.mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      })
  );
  const { result, rerender } = mount();
  await act(async () => result.current.handleStart());
  mockManager = createManager();
  rerender({});
  await act(async () => reject(new Error('no_route')));
  expect(mockRestore).not.toHaveBeenCalled();
  expect(mockManager.ops.melt.execute).not.toHaveBeenCalled();
  expect(mockStatus.setLegFailed).not.toHaveBeenCalled();
});

function configureMiddleman() {
  const via = 'https://middleman.example';
  mockLocalCandidates = [via];
  const receipts = new Map<string, ReturnType<typeof operation>>();
  let nextQuote = 0;
  mockManager.quotes.mint.create.mockImplementation(async (input) => {
    const quoteId = `quote-${++nextQuote}`;
    receipts.set(quoteId, {
      ...operation(),
      id: `mint-${quoteId}`,
      quoteId,
      mintUrl: input.mintUrl,
      request: `invoice-${quoteId}`,
      amount: Amount.from(input.amount.amount),
      state: 'pending',
    });
    return {
      quoteId,
      mintUrl: input.mintUrl,
      unit: input.amount.unit,
      request: `invoice-${quoteId}`,
    };
  });
  mockManager.ops.mint.prepare.mockImplementation(async ({ quote }) =>
    receipts.get(quote.quoteId)!
  );
  mockManager.ops.mint.get.mockImplementation(async (id) =>
    [...receipts.values()].find((receipt) => receipt.id === id)!
  );
  mockManager.wallet.balances.byMint.mockImplementation(async () => ({
    [SOURCE]: { total: Amount.from(1000) },
    [DESTINATION]: { total: Amount.from(100) },
    [via]: { total: Amount.from(100) },
  }));
  mockManager.ops.melt.execute
    .mockRejectedValueOnce(new Error('no_route'))
    .mockImplementation(async () => {
      const latest = receipts.get(`quote-${nextQuote}`)!;
      latest.state = 'finalized';
      return { id: 'melt-op-1', state: 'pending' };
    });
  return { via, receipts };
}

test('middleman hops verify their own recipient operations and the final hop instead of the abandoned direct quote', async () => {
  const { via, receipts } = configureMiddleman();
  const { result } = mount();
  await act(async () => result.current.handleStart());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(500);
  });
  expect(result.current.runStatus).toBe('finished');
  expect(mockManager.ops.melt.execute).toHaveBeenCalledTimes(3);
  expect(mockManager.ops.melt.refresh).toHaveBeenCalledTimes(2);
  expect(mockManager.ops.mint.get.mock.calls.map(([id]) => id)).toEqual([
    'mint-quote-2',
    'mint-quote-3',
  ]);
  expect(receipts.get('quote-1')?.state).toBe('pending');
  expect(mockReleaseTrust).toHaveBeenCalledWith(mockManager, [via]);
});

test.each([0, 1])(
  'a reduced-amount retry on middleman hop %i verifies and tags the replacement receipt',
  async (hopIndex) => {
    const { receipts } = configureMiddleman();
    const prepared = {
      id: 'melt-op-1',
      quoteId: 'melt-quote-1',
      amount: Amount.from(100),
      fee_reserve: 0,
      swap_fee: 0,
    };
    // The initial direct prepare succeeds; then only the selected hop needs
    // a smaller replacement invoice. The abandoned receipt stays pending.
    for (let index = 0; index <= hopIndex; index++) {
      mockManager.ops.melt.prepare.mockResolvedValueOnce(prepared);
    }
    mockManager.ops.melt.prepare.mockRejectedValueOnce(new Error('Not enough proofs'));
    const { result } = mount();
    await act(async () => result.current.handleStart());
    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });
    const abandoned = `quote-${hopIndex + 2}`;
    const replacement = `quote-${hopIndex + 3}`;
    expect(mockManager.ops.mint.get.mock.calls.map(([id]) => id)).toEqual(
      hopIndex === 0 ? ['mint-quote-3', 'mint-quote-4'] : ['mint-quote-2', 'mint-quote-4']
    );
    expect(result.current.runStatus).toBe('finished');
    expect(receipts.get(abandoned)?.state).toBe('pending');
    expect(receipts.get(replacement)?.amount.toNumber()).toBe(
      receipts.get(abandoned)!.amount.toNumber() - 2
    );
    expect(mockTransactions.tagMintQuote).toHaveBeenCalledWith('group-1', 'leg-1', replacement);
    expect(setTransactionAnnotation).toHaveBeenCalledWith(
      `quote:${replacement}`,
      expect.objectContaining({
        swap: expect.objectContaining({ role: 'mint', hopIndex }),
      })
    );
    expect(mockManager.ops.melt.execute).toHaveBeenCalledTimes(3);
  }
);

test('cancelling during middleman receipt verification releases temporary trust before exiting', async () => {
  const { via } = configureMiddleman();
  mockManager.ops.melt.execute.mockImplementation(async () => ({
    id: 'melt-op-1',
    state: 'finalized',
  }));
  const { result } = mount();
  await act(async () => result.current.handleStart());
  expect(mockManager.ops.melt.execute).toHaveBeenCalledTimes(2);
  act(() => result.current.handleCancelRun());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1000);
  });
  expect(mockReleaseTrust).toHaveBeenCalledWith(mockManager, [via]);
  expect(mockManager.ops.melt.execute).toHaveBeenCalledTimes(2);
  expect(mockStatus.setLegDone).not.toHaveBeenCalled();
});

test('a transient recipient operation read failure retries locally without repeating the melt', async () => {
  mockManager.ops.mint.get.mockRejectedValueOnce(new Error('database busy'));
  const { result } = mount();
  await act(async () => result.current.handleStart());
  expect(result.current.stepStates['step-1'].status).toBe('verifying');
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1500);
  });
  expect(result.current.runStatus).toBe('finished');
  expect(mockManager.ops.melt.execute).toHaveBeenCalledTimes(1);
  expect(mockManager.ops.mint.get).toHaveBeenCalledTimes(2);
  expect(mockRestore).not.toHaveBeenCalled();
});

test.each([
  ['id', 'another-operation'],
  ['mintUrl', 'https://another-mint.example'],
  ['quoteId', 'another-quote'],
  ['method', 'onchain'],
])('a recipient snapshot with the wrong %s cannot settle this transfer', async (field, value) => {
  mockManager.ops.mint.get.mockImplementation(async () => ({ ...operation(), [field]: value }));
  const { result } = mount();
  await act(async () => result.current.handleStart());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(500);
  });
  expect(result.current.stepStates['step-1'].status).toBe('verifying');
  expect(mockStatus.setLegDone).not.toHaveBeenCalled();
});
