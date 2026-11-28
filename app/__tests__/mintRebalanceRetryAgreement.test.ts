/**
 * A step that failed, then Cancel, then a retry of that step that succeeds:
 * the swap history group, its saved leg, the Swap status toast and the screen
 * all end as finished. Same harness as `mintRebalanceRunLifecycle.test.ts`,
 * with the real swap history and toast stores.
 */
import { act, renderHook } from '@testing-library/react-native';
import { Amount } from '@cashu/coco-core';
import { useMintRebalanceOrchestrator } from '@/features/mint/hooks/useMintRebalanceOrchestrator';
import type { RebalancePlan } from '@/features/mint/components/rebalance/rebalancePlanner';
import { useSwapTransactionsStore } from '@/shared/stores/profile/swapTransactionsStore';
import { useSwapStatusStore } from '@/shared/stores/runtime/swapStatusStore';
import { storeLog } from '@/shared/lib/logger';

jest.mock('@cashu/coco-react', () => ({ useManager: () => mockManager }));
jest.mock('@/shared/lib/cashu/manager', () => ({
  CocoManager: {},
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
jest.mock('@/shared/stores/global/profileStore', () => ({
  activePubkey: () => 'account-a',
}));
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));
jest.mock('@/shared/lib/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const named: Record<string, unknown> = {
    redactError: (e: unknown) => e,
    mintUrlLogFields: () => ({}),
  };
  return new Proxy(named, { get: (target, key: string) => (key in target ? target[key] : log) });
});
jest.mock('@/shared/lib/popup', () => ({ swapStatusPopup: jest.fn() }));
jest.mock('@/shared/stores/profile/transactionAnnotationStore', () => ({
  setTransactionAnnotation: jest.fn(),
}));
jest.mock('@/features/mint/components/rebalance', () => ({
  MIN_FEE_RESERVE: 5,
  buildSwapGraph: jest.fn(),
  pickIntermediaryPath: jest.fn(),
  addLocalHistoryEdges: jest.fn(),
  getLocalCandidatesForDestination: () => [],
  releaseTrustWindow: async () => ({ stranded: [], untrustErrors: [] }),
  formatStrandedRoutingDetail: () => '',
}));

const SOURCE = 'https://source.example';
const DESTINATION = 'https://destination.example';
let swapOutcomeState: 'completed' | 'destination_funded' = 'destination_funded';
let pendingWaitResolvers: Array<() => void> = [];

function makeSwapOp(id: string, state: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    revision: 1,
    sourceMintUrl: SOURCE,
    destinationMintUrl: DESTINATION,
    unit: 'sat' as const,
    destinationAmount: Amount.from(100),
    sourceQuote: { mintUrl: SOURCE, method: 'bolt11' as const, quoteId: `mq-${id}` },
    destinationQuote: { mintUrl: DESTINATION, method: 'bolt11' as const, quoteId: `dq-${id}` },
    sourceOperationId: `melt-${id}`,
    destinationOperationId: `mint-${id}`,
    paymentRequestHash: '00'.repeat(32),
    createdAt: 1000,
    updatedAt: 1000,
    stateEnteredAt: 1000,
    retry: { attemptCount: 0, lastAttemptAt: null, nextAttemptAt: null, lastError: null },
    state,
    ...extra,
  };
}

const mockManager = {
  wallet: {
    balances: {
      byMint: jest.fn(async () => ({
        [SOURCE]: { total: Amount.from(1000) },
        [DESTINATION]: { total: Amount.from(0) },
      })),
    },
  },
  ops: {
    mintSwap: {
      prepare: jest.fn(async (input: { id: string }) => makeSwapOp(input.id, 'prepared')),
      execute: jest.fn(async (id: string) => makeSwapOp(id, swapOutcomeState)),
      get: jest.fn(async (id: string) => makeSwapOp(id, swapOutcomeState)),
      listActive: jest.fn(async () => []),
      refresh: jest.fn(async (id: string) => makeSwapOp(id, swapOutcomeState)),
      cancel: jest.fn(async (id: string) => makeSwapOp(id, 'cancelled')),
      waitForOutcome: jest.fn(
        (id: string) =>
          new Promise((resolve) => {
            pendingWaitResolvers.push(() =>
              resolve({
                status: swapOutcomeState === 'completed' ? 'completed' : 'timeout',
                operation: makeSwapOp(id, swapOutcomeState),
              })
            );
          })
      ),
    },
  },
  mint: { addMint: jest.fn().mockResolvedValue(undefined) },
};

const plan: RebalancePlan = {
  steps: [
    { id: 'step-1', fromMintUrl: SOURCE, toMintUrl: DESTINATION, amount: 100 },
    { id: 'step-2', fromMintUrl: SOURCE, toMintUrl: DESTINATION, amount: 100 },
  ],
  totalAmount: 200,
  currentBalances: { [SOURCE]: 1000, [DESTINATION]: 0 },
  targetBalances: { [SOURCE]: 800, [DESTINATION]: 200 },
};

function mount() {
  const hook = renderHook(() =>
    useMintRebalanceOrchestrator({
      unit: 'sat',
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
let mounted: { current: ReturnType<typeof useMintRebalanceOrchestrator> }[] = [];

beforeEach(() => {
  jest.useFakeTimers();
  useSwapTransactionsStore.setState({ groups: {}, quoteIdToGroup: {} });
  useSwapStatusStore.getState().clear();
});
afterEach(() => {
  // A run still going holds its group for the process; end it with the test.
  for (const result of mounted) act(() => result.current.handleCancelRun());
  for (const resolve of pendingWaitResolvers.splice(0)) resolve();
  mounted = [];
  jest.clearAllTimers();
  jest.useRealTimers();
});

it('ends the group, its leg, the toast and the screen as finished after a retry that succeeds', async () => {
  // Step 1 fails (source rejected); step 2 stays in destination_funded so the run is still going when Cancel is pressed.
  mockManager.ops.mintSwap.execute.mockImplementationOnce(async (id: string) =>
    makeSwapOp(id, 'failed', { failure: { code: 'source_payment_rejected' } })
  );
  swapOutcomeState = 'destination_funded';
  const { result } = mount();
  await act(async () => result.current.handleStart());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(100);
  });
  expect(result.current.stepStates['step-1'].status).toBe('failed');
  expect(result.current.runStatus).toBe('running');

  act(() => result.current.handleCancelRun());
  for (const resolve of pendingWaitResolvers.splice(0)) resolve();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(2000);
  });
  const groupId = result.current.swapGroupId!;
  const group = () => useSwapTransactionsStore.getState().groups[groupId];
  expect(group().state).toBe('cancelled');
  expect(useSwapStatusStore.getState().active?.state).toBe('cancelled');

  // The retry: the swap now completes.
  swapOutcomeState = 'completed';
  await act(async () => {
    await result.current.handleRetry(plan.steps[0]);
  });

  expect(result.current.runStatus).toBe('finished');
  expect(result.current.stepStates['step-1'].status).toBe('done');
  expect(group().state).toBe('finished');
  expect(group().legs[0]).toMatchObject({ localStatus: 'done' });
  expect(group().legs[0].errorMessage).toBeUndefined();
  const toast = useSwapStatusStore.getState().active;
  expect(toast?.state).toBe('done');
  expect(toast?.legs[0]).toEqual({ id: 'step-1', label: expect.any(String), status: 'done' });
  // Every leg and group move the run made is one the saved tables allow.
  expect(storeLog.warn).not.toHaveBeenCalled();
});

/** Step 1 fails; step 2 completes. The run ends with the toast failed. */
async function runWithStepOneFailed() {
  mockManager.ops.mintSwap.execute.mockImplementationOnce(async (id: string) =>
    makeSwapOp(id, 'failed', { failure: { code: 'source_payment_rejected' } })
  );
  swapOutcomeState = 'completed';
  const screen = mount();
  await act(async () => screen.result.current.handleStart());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(3000);
  });
  expect(screen.result.current.runStatus).toBe('finished');
  expect(screen.result.current.stepStates['step-1'].status).toBe('failed');
  expect(useSwapStatusStore.getState().active?.state).toBe('failed');
  return screen;
}

it('shows the toast again for a retry after the ended toast was dismissed, and ends it with the run', async () => {
  const { result } = await runWithStepOneFailed();
  // The terminal toast auto-dismissed.
  useSwapStatusStore.getState().clear();

  const shown: (string | undefined)[] = [];
  const unsubscribe = useSwapStatusStore.subscribe((state) => shown.push(state.active?.state));
  await act(async () => {
    const retry = result.current.handleRetry(plan.steps[0]);
    await jest.advanceTimersByTimeAsync(3000);
    await retry;
  });
  unsubscribe();

  // Running while the retry ran, then its end.
  expect(shown[0]).toBe('running');
  expect(result.current.stepStates['step-1'].status).toBe('done');
  const toast = useSwapStatusStore.getState().active;
  expect(toast).toMatchObject({ state: 'done', meta: { groupId: result.current.swapGroupId } });
  expect(toast?.legs.map((leg) => [leg.id, leg.status])).toEqual([
    ['step-1', 'done'],
    ['step-2', 'done'],
  ]);
});

it('refuses a retry while another screen’s swap owns a run, though no toast is showing', async () => {
  const first = await runWithStepOneFailed();
  useSwapStatusStore.getState().clear();
  const executed = mockManager.ops.mintSwap.execute.mock.calls.length;

  // A second screen starts a swap whose destination does not issue yet; its toast is swiped away.
  swapOutcomeState = 'destination_funded';
  const second = mount();
  await act(async () => second.result.current.handleStart());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(100);
  });
  expect(second.result.current.runStatus).toBe('running');
  useSwapStatusStore.getState().clear();
  const executedBySecond = mockManager.ops.mintSwap.execute.mock.calls.length;
  expect(executedBySecond).toBeGreaterThan(executed);

  await act(async () => {
    void first.result.current.handleRetry(plan.steps[0]);
    await jest.advanceTimersByTimeAsync(100);
  });

  expect(mockManager.ops.mintSwap.execute).toHaveBeenCalledTimes(executedBySecond);
  expect(first.result.current.runStatus).toBe('finished');
  expect(first.result.current.stepStates['step-1'].status).toBe('failed');
});
