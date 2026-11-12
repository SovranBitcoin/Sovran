/**
 * Characterization of the rebalance screen's run lifecycle in
 * `useMintRebalanceOrchestrator`: start, cancel, retry, retry-failed, skip,
 * and the guards against a second concurrent swap. The harness is the one
 * `mintRebalanceOrchestrator.test.ts` uses: the real `wallet` rebalance engine
 * runs against a fake Coco manager, with the swap stores replaced by
 * recording fakes.
 */
import { act, renderHook } from '@testing-library/react-native';
import { Amount, MintOperationError } from '@cashu/coco-core';
import { useMintRebalanceOrchestrator } from '@/features/mint/hooks/useMintRebalanceOrchestrator';
import type { RebalancePlan } from '@/features/mint/components/rebalance/rebalancePlanner';
import { cashuLog } from '@/shared/lib/logger';

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
jest.mock('@/shared/lib/getDiscoveredMintMetadata', () => ({
  getDiscoveredMintMetadata: jest.fn(),
}));
jest.mock('@/shared/lib/logger', () => ({
  cashuLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() },
  mintUrlLogFields: () => ({}),
}));
jest.mock('@/shared/lib/popup', () => ({ swapStatusPopup: jest.fn() }));
jest.mock('@/shared/stores/profile/transactionAnnotationStore', () => ({
  setTransactionAnnotation: jest.fn(),
}));
jest.mock('@/shared/stores/global/profileStore', () => ({
  activePubkey: () => 'account-a',
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
  reopenGroup: jest.fn(),
};
const mockStatus = {
  active: null as { state: string; meta: { groupId?: string } } | null,
  start: jest.fn((params: { meta: { groupId?: string } }) => {
    mockStatus.active = { state: 'running', meta: params.meta };
  }),
  setActiveLeg: jest.fn(),
  setLegDone: jest.fn(),
  setLegSkipped: jest.fn(),
  setLegFailed: jest.fn(),
  complete: jest.fn(),
  settleUnknown: jest.fn(),
  fail: jest.fn(),
  cancel: jest.fn(),
  resume: jest.fn(),
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
        get: jest.fn(async (_id: string) => null as { id: string; state: string } | null),
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
let mounted: { current: ReturnType<typeof useMintRebalanceOrchestrator> }[] = [];
function mount(unit = 'sat') {
  const hook = renderHook(() =>
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
  mounted.push(hook.result);
  return hook;
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
  // A run still going holds its group for the process; end it with the test.
  for (const result of mounted) act(() => result.current.handleCancelRun());
  mounted = [];
  jest.clearAllTimers();
  jest.useRealTimers();
});

const step = plan.steps[0];

function failNextMelt() {
  mockManager.ops.melt.execute.mockImplementationOnce(async () => ({
    id: 'melt-op-1',
    state: 'pending',
  }));
  mockManager.ops.melt.refresh.mockResolvedValueOnce({ id: 'melt-op-1', state: 'rolled_back' });
}

function keepRecipientPending() {
  mockManager.ops.melt.execute.mockImplementation(async () => ({
    id: 'melt-op-1',
    state: 'finalized',
  }));
}

async function finishRun() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(500);
  });
}

test('a run that completes finishes its swap group and the status toast', async () => {
  const { result } = mount();
  expect(result.current.runStatus).toBe('idle');
  expect(result.current.runPlan).toBeNull();

  await act(async () => result.current.handleStart());
  await finishRun();

  expect(result.current.runStatus).toBe('finished');
  expect(result.current.runPlan).toBe(plan);
  expect(result.current.stepStates['step-1'].status).toBe('done');
  expect(mockTransactions.startGroup).toHaveBeenCalledWith({ unit: 'sat', title: 'Swap' });
  expect(mockTransactions.finalizeGroup).toHaveBeenCalledWith('group-1', 'finished');
  expect(mockStatus.start).toHaveBeenCalledWith(
    expect.objectContaining({
      legs: [{ id: 'step-1', label: 'source.example → destination.example' }],
      meta: { unit: 'sat', totalAmount: 100, groupId: 'group-1' },
    })
  );
  expect(mockStatus.complete).toHaveBeenCalledTimes(1);
});

test('a run whose payment is rolled back finishes with the toast failed', async () => {
  failNextMelt();
  const { result } = mount();
  await act(async () => result.current.handleStart());
  await finishRun();

  expect(result.current.stepStates['step-1'].status).toBe('failed');
  expect(result.current.runStatus).toBe('finished');
  expect(mockTransactions.finalizeGroup).toHaveBeenCalledWith('group-1', 'finished');
  expect(mockStatus.setLegFailed).toHaveBeenCalledWith('step-1', expect.any(String));
  expect(mockStatus.fail).toHaveBeenCalledTimes(1);
  expect(mockStatus.complete).not.toHaveBeenCalled();
});

test('cancelling a run marks the group and the toast cancelled', async () => {
  keepRecipientPending();
  const { result } = mount();
  await act(async () => result.current.handleStart());
  act(() => result.current.handleCancelRun());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(16000);
  });

  expect(result.current.runStatus).toBe('cancelled');
  expect(mockTransactions.finalizeGroup).toHaveBeenCalledWith('group-1', 'cancelled');
  expect(mockTransactions.finalizeGroup).not.toHaveBeenCalledWith('group-1', 'finished');
  expect(mockStatus.cancel).toHaveBeenCalledTimes(1);
  expect(mockStatus.complete).not.toHaveBeenCalled();
});

test('pressing start twice in a row runs one swap', async () => {
  keepRecipientPending();
  // Leave the toast inactive so only this screen's own guard is in play.
  mockStatus.start.mockImplementationOnce(() => {});
  const { result } = mount();
  await act(async () => {
    result.current.handleStart();
    result.current.handleStart();
  });

  expect(mockTransactions.startGroup).toHaveBeenCalledTimes(1);
  expect(mockStatus.start).toHaveBeenCalledTimes(1);
  expect(mockManager.ops.melt.execute).toHaveBeenCalledTimes(1);
});

test('start is refused while another screen’s swap owns a run, whatever the toast shows', async () => {
  keepRecipientPending();
  const other = mount();
  await act(async () => other.result.current.handleStart());
  expect(other.result.current.runStatus).toBe('running');
  jest.clearAllMocks();
  // The other swap's toast was swiped away; its run still holds its group.
  mockStatus.active = null;

  const { result } = mount();
  await act(async () => result.current.handleStart());

  expect(result.current.runStatus).toBe('idle');
  expect(result.current.runPlan).toBeNull();
  expect(mockTransactions.startGroup).not.toHaveBeenCalled();
  expect(mockStatus.start).not.toHaveBeenCalled();
  expect(mockManager.ops.melt.execute).not.toHaveBeenCalled();
  expect(cashuLog.info).toHaveBeenCalledWith('mint.rebalance.start_blocked_by_active_swap');
});

test('a toast left running with no run behind it does not block a new start', async () => {
  mockStatus.active = { state: 'running', meta: {} };
  const { result } = mount();
  await act(async () => result.current.handleStart());
  await finishRun();

  expect(mockManager.ops.melt.execute).toHaveBeenCalledTimes(1);
  expect(result.current.runStatus).toBe('finished');
});

test('a finished swap left on the toast does not block a new start', async () => {
  mockStatus.active = { state: 'completed', meta: {} };
  const { result } = mount();
  await act(async () => result.current.handleStart());
  await finishRun();

  expect(mockManager.ops.melt.execute).toHaveBeenCalledTimes(1);
  expect(result.current.runStatus).toBe('finished');
});

test('skip is ignored while a run is going and marks the step skipped once it is over', async () => {
  keepRecipientPending();
  const { result } = mount();
  await act(async () => result.current.handleStart());
  expect(result.current.runStatus).toBe('running');
  act(() => result.current.handleSkip(step));
  expect(result.current.stepStates['step-1'].status).not.toBe('skipped');

  act(() => result.current.handleCancelRun());
  act(() => result.current.handleSkip(step));
  expect(result.current.stepStates['step-1'].status).toBe('skipped');
});

test('retrying a step after cancelling runs it again and ends the run as finished', async () => {
  failNextMelt();
  const { result } = mount();
  await act(async () => result.current.handleStart());
  await finishRun();
  act(() => result.current.handleCancelRun());
  expect(result.current.runStatus).toBe('cancelled');

  await act(async () => {
    await result.current.handleRetry(step);
  });
  await finishRun();

  // The retry reopens the cancelled group and its toast, and ends both as it ends.
  expect(result.current.runStatus).toBe('finished');
  expect(mockManager.ops.melt.execute).toHaveBeenCalledTimes(2);
  expect(result.current.stepStates['step-1'].status).toBe('done');
  expect(mockStatus.setLegDone).toHaveBeenCalledWith('step-1');
  expect(mockTransactions.reopenGroup).toHaveBeenCalledWith('group-1');
  expect(mockTransactions.finalizeGroup).toHaveBeenLastCalledWith('group-1', 'finished');
  expect(mockStatus.resume).toHaveBeenCalled();
  expect(mockStatus.complete).toHaveBeenCalledTimes(1);
});

test('a run that throws ends its group as cancelled, fails the toast and stops the screen', async () => {
  mockStatus.setActiveLeg.mockImplementationOnce(() => {
    throw new Error('toast exploded');
  });
  const { result } = mount();
  await act(async () => result.current.handleStart());
  await finishRun();

  expect(mockStatus.fail).toHaveBeenCalledWith(expect.any(String));
  expect(cashuLog.warn).toHaveBeenCalledWith('mint.rebalance.run_failed', expect.anything());
  expect(mockTransactions.finalizeGroup).toHaveBeenCalledWith('group-1', 'cancelled');
  expect(result.current.runStatus).toBe('cancelled');
});

test('a run aborted by a wallet change ends its group and the toast as cancelled', async () => {
  keepRecipientPending();
  const { result, rerender } = mount();
  await act(async () => result.current.handleStart());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(100);
  });
  mockManager = createManager();
  rerender({});
  await act(async () => {
    await jest.advanceTimersByTimeAsync(16000);
  });

  expect(mockTransactions.finalizeGroup).toHaveBeenCalledTimes(1);
  expect(mockTransactions.finalizeGroup).toHaveBeenCalledWith('group-1', 'cancelled');
  expect(mockStatus.cancel).toHaveBeenCalledTimes(1);
  expect(mockStatus.complete).not.toHaveBeenCalled();
  expect(mockStatus.fail).not.toHaveBeenCalled();
  expect(result.current.runStatus).toBe('cancelled');
});

test('retry-failed runs a failed step again', async () => {
  failNextMelt();
  const { result } = mount();
  await act(async () => result.current.handleStart());
  await finishRun();
  expect(result.current.stepStates['step-1'].status).toBe('failed');

  let retry: Promise<void> = Promise.resolve();
  await act(async () => {
    retry = result.current.handleRetryFailed();
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(500);
    await retry;
  });

  expect(mockManager.ops.melt.execute).toHaveBeenCalledTimes(2);
  expect(result.current.stepStates['step-1'].status).toBe('done');
  expect(result.current.runStatus).toBe('finished');
});

test('retry-failed never pays again for a step that is done or still settling', async () => {
  const done = mount();
  await act(async () => done.result.current.handleStart());
  await finishRun();
  await act(async () => {
    await done.result.current.handleRetryFailed();
  });
  expect(mockManager.ops.melt.execute).toHaveBeenCalledTimes(1);
  done.unmount();

  mockManager = createManager();
  mockStatus.active = null;
  mintState = 'pending';
  destinationBalance = 0;
  keepRecipientPending();
  const settling = mount();
  await act(async () => settling.result.current.handleStart());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(15500);
  });
  expect(settling.result.current.stepStates['step-1'].status).toBe('settling');
  await act(async () => {
    await settling.result.current.handleRetryFailed();
  });
  expect(mockManager.ops.melt.execute).toHaveBeenCalledTimes(1);
});

test('retry-failed before any run does nothing', async () => {
  const { result } = mount();
  await act(async () => {
    await result.current.handleRetryFailed();
  });

  expect(result.current.runStatus).toBe('idle');
  expect(mockManager.ops.melt.execute).not.toHaveBeenCalled();
});

describe('a reroute cancelled while its intermediary is being trusted', () => {
  const via = 'https://middleman.example';
  const rerouteRows = (screen: { result: { current: { plan: RebalancePlan } } }) =>
    screen.result.current.plan.steps.filter((s) => s.id.startsWith('reroute-'));

  /** Leave step-1 failed with a route through `via` suggested: the automatic route could not start. */
  async function failWithSuggestedRoute() {
    mockLocalCandidates = [via];
    // The mint answers that Lightning found no route.
    mockManager.ops.melt.execute.mockRejectedValueOnce(new MintOperationError(20004, 'no_route'));
    mockManager.quotes.mint.create.mockImplementation(async (input) => {
      if (input.mintUrl === via) throw new Error('middleman offline');
      return {
        quoteId: 'mint-quote-1',
        mintUrl: DESTINATION,
        unit: 'sat',
        request: 'lnbc-fixture',
      };
    });
    // The row shows the route found before its hop rows are inserted.
    let trustedForAutoRoute!: () => void;
    mockManager.mint.addMint.mockImplementationOnce(
      () => new Promise<undefined>((resolve) => (trustedForAutoRoute = () => resolve(undefined)))
    );
    const screen = mount();
    await act(async () => screen.result.current.handleStart());
    await act(async () => {
      trustedForAutoRoute();
      await jest.advanceTimersByTimeAsync(2000);
    });
    expect(screen.result.current.stepStates['step-1']).toMatchObject({
      status: 'failed',
      routeSuggestion: { status: 'found', path: [SOURCE, via, DESTINATION] },
    });
    return screen;
  }

  test('does not start once the trust arrives, while another screen’s swap runs', async () => {
    const a = await failWithSuggestedRoute();
    let trusted!: () => void;
    mockManager.mint.addMint.mockImplementationOnce(
      () => new Promise<undefined>((resolve) => (trusted = () => resolve(undefined)))
    );

    // A reroutes and waits for the intermediary to be trusted; Cancel.
    let reroute: Promise<void> = Promise.resolve();
    await act(async () => {
      reroute = a.result.current.handleRouteThrough(step);
    });
    expect(mockManager.mint.addMint).toHaveBeenLastCalledWith(via, { trusted: true });
    act(() => a.result.current.handleCancelRun());
    expect(a.result.current.runStatus).toBe('cancelled');

    // Another screen starts its own swap, which stays in flight.
    mockTransactions.startGroup.mockReturnValueOnce('group-b');
    keepRecipientPending();
    const b = mount();
    await act(async () => b.result.current.handleStart());
    expect(b.result.current.runStatus).toBe('running');
    const melts = mockManager.ops.melt.execute.mock.calls.length;
    const quotes = mockManager.quotes.mint.create.mock.calls.length;
    const reopens = mockTransactions.reopenGroup.mock.calls.length;

    // The late trust answer is dropped: A's reroute never runs.
    await act(async () => {
      trusted();
      await jest.advanceTimersByTimeAsync(1000);
      await reroute;
    });
    expect(a.result.current.runStatus).toBe('cancelled');
    expect(rerouteRows(a)).toEqual([]);
    expect(mockManager.quotes.mint.create).toHaveBeenCalledTimes(quotes);
    expect(mockManager.ops.melt.execute).toHaveBeenCalledTimes(melts);
    expect(mockTransactions.reopenGroup).toHaveBeenCalledTimes(reopens);
    // Its intermediary is given back all the same.
    expect(mockReleaseTrust).toHaveBeenLastCalledWith(mockManager, [via]);
    expect(b.result.current.runStatus).toBe('running');
  });

  test('runs once the trust arrives when nothing cancelled it', async () => {
    const a = await failWithSuggestedRoute();
    mockManager.quotes.mint.create.mockImplementation(async (input) => ({
      quoteId: `quote-${input.mintUrl}`,
      mintUrl: input.mintUrl,
      unit: 'sat',
      request: `invoice-${input.mintUrl}`,
    }));
    await act(async () => {
      void a.result.current.handleRouteThrough(step);
      await jest.advanceTimersByTimeAsync(100);
    });
    expect(a.result.current.runStatus).toBe('running');
    expect(rerouteRows(a)).toHaveLength(2);
    expect(mockManager.quotes.mint.create).toHaveBeenCalledWith(
      expect.objectContaining({ mintUrl: via })
    );
  });
});
