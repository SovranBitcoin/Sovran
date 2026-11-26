/**
 * @jest-environment node
 *
 * Orchestrator behavior over Coco nightly's native `manager.ops.mintSwap`:
 * direct completion, outcome observation (`completed`, `settling`, `paymentPending`),
 * middleman routing with temporary trust release, cancellation, and manager replacement.
 */
import { act, renderHook } from '@testing-library/react-native';
import { Amount } from '@cashu/coco-core';

import { useMintRebalanceOrchestrator } from '@/features/mint/hooks/useMintRebalanceOrchestrator';
import type { RebalancePlan } from '@/features/mint/components/rebalance';

jest.mock('@cashu/coco-react', () => ({ useManager: () => mockManager }));
jest.mock('@/shared/lib/logger', () => {
  const log: Record<string, unknown> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  log.child = () => log;
  const named: Record<string, unknown> = {
    log,
    redactError: (e: unknown) => e,
    mintUrlLogFields: () => ({}),
  };
  return new Proxy(named, { get: (target, key: string) => (key in target ? target[key] : log) });
});
jest.mock('@/shared/lib/popup', () => ({ swapStatusPopup: jest.fn() }));
jest.mock('@/shared/stores/profile/swapTransactionsStore', () => ({
  useSwapTransactionsStore: { getState: () => mockTransactions },
}));
jest.mock('@/shared/stores/profile/transactionAnnotationStore', () => ({
  setTransactionAnnotation: jest.fn(),
}));
jest.mock('@/shared/stores/runtime/swapStatusStore', () => ({
  useSwapStatusStore: { getState: () => mockStatus },
}));
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
const VIA = 'https://via.example';

const mockReleaseTrust = jest.fn().mockResolvedValue({ stranded: [], untrustErrors: [] });
let mockLocalCandidates: string[] = [];

const mockTransactions = {
  groups: {},
  startGroup: jest.fn(() => 'group-1'),
  addLeg: jest.fn(() => 'leg-1'),
  setLegStatus: jest.fn(),
  tagMintSwap: jest.fn(),
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

let mockManager: ReturnType<typeof createManager>;
function createManager() {
  return {
    wallet: {
      balances: {
        byMint: jest.fn(async () => ({
          [SOURCE]: { total: Amount.from(1000) },
          [VIA]: { total: Amount.from(1000) },
          [DESTINATION]: { total: Amount.from(0) },
        })),
      },
    },
    ops: {
      mintSwap: {
        prepare: jest.fn(async (input: { id: string; sourceMintUrl: string; destinationMintUrl: string }) =>
          makeSwapOp(input.id, 'prepared', {
            sourceMintUrl: input.sourceMintUrl,
            destinationMintUrl: input.destinationMintUrl,
          })
        ),
        execute: jest.fn(async (id: string) => makeSwapOp(id, 'completed')),
        get: jest.fn(async (id: string) => makeSwapOp(id, 'completed')),
        listActive: jest.fn(async () => []),
        refresh: jest.fn(async (id: string) => makeSwapOp(id, 'completed')),
        cancel: jest.fn(async (id: string) => makeSwapOp(id, 'cancelled')),
        waitForOutcome: jest.fn(async (id: string) => ({
          status: 'completed' as string,
          operation: makeSwapOp(id, 'completed'),
        })),
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

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockStatus.active = null;
  mockLocalCandidates = [];
  mockManager = createManager();
});

afterEach(() => {
  for (const result of mounted) act(() => result.current.handleCancelRun());
  mounted = [];
  jest.clearAllTimers();
  jest.useRealTimers();
});

test('completes immediately when ops.mintSwap.execute returns completed', async () => {
  const { result } = mount();
  await act(async () => result.current.handleStart());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(600);
  });

  expect(mockManager.ops.mintSwap.prepare).toHaveBeenCalledTimes(1);
  expect(mockManager.ops.mintSwap.execute).toHaveBeenCalledTimes(1);
  expect(mockTransactions.tagMintSwap).toHaveBeenCalledTimes(1);
  expect(result.current.stepStates['step-1'].status).toBe('done');
  expect(result.current.runStatus).toBe('finished');
});

test('marks a leg settling when waitForOutcome times out in destination_funded', async () => {
  mockManager.ops.mintSwap.execute.mockResolvedValueOnce(makeSwapOp('s1', 'destination_funded'));
  mockManager.ops.mintSwap.waitForOutcome.mockResolvedValueOnce({
    status: 'timeout' as const,
    operation: makeSwapOp('s1', 'destination_funded'),
  });

  const { result } = mount();
  await act(async () => result.current.handleStart());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(600);
  });

  expect(result.current.stepStates['step-1'].status).toBe('settling');
  expect(mockStatus.settleUnknown).toHaveBeenCalledTimes(1);
  expect(mockStatus.complete).not.toHaveBeenCalled();
});

test('marks a leg paymentPending when waitForOutcome times out in source_pending', async () => {
  mockManager.ops.mintSwap.execute.mockResolvedValueOnce(makeSwapOp('s1', 'source_pending'));
  mockManager.ops.mintSwap.waitForOutcome.mockResolvedValueOnce({
    status: 'timeout' as const,
    operation: makeSwapOp('s1', 'source_pending'),
  });

  const { result } = mount();
  await act(async () => result.current.handleStart());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(600);
  });

  expect(result.current.stepStates['step-1'].status).toBe('paymentPending');
  expect(mockStatus.settleUnknown).toHaveBeenCalledTimes(1);
});

test('routes through a middleman mint on source_payment_rejected and releases temporary trust', async () => {
  mockLocalCandidates = [VIA];
  let first = true;
  mockManager.ops.mintSwap.execute.mockImplementation(async (id: string) => {
    if (first) {
      first = false;
      return makeSwapOp(id, 'failed', { failure: { code: 'source_payment_rejected' } });
    }
    return makeSwapOp(id, 'completed');
  });

  const { result } = mount();
  await act(async () => result.current.handleStart());
  await act(async () => {
    await jest.advanceTimersByTimeAsync(2000);
  });

  expect(mockManager.mint.addMint).toHaveBeenCalledWith(VIA, { trusted: true });
  expect(mockReleaseTrust).toHaveBeenCalledWith(mockManager, [VIA]);
  expect(mockManager.ops.mintSwap.execute).toHaveBeenCalledTimes(3);
  expect(result.current.runStatus).toBe('finished');
});

test('cancelling before execute calls ops.mintSwap.cancel and aborts cleanly', async () => {
  let resolvePrepare!: () => void;
  mockManager.ops.mintSwap.prepare.mockImplementationOnce(
    (input: { id: string }) =>
      new Promise((resolve) => {
        resolvePrepare = () => resolve(makeSwapOp(input.id, 'prepared'));
      })
  );

  const { result } = mount();
  await act(async () => result.current.handleStart());
  act(() => result.current.handleCancelRun());
  await act(async () => {
    resolvePrepare();
    await jest.advanceTimersByTimeAsync(100);
  });

  expect(mockManager.ops.mintSwap.cancel).toHaveBeenCalledTimes(1);
  expect(mockManager.ops.mintSwap.execute).not.toHaveBeenCalled();
  expect(result.current.runStatus).toBe('cancelled');
});
