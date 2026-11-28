/**
 * Exercise the real switch protocol, rebalance engine and profile-scoped
 * history with a fake Coco manager. A funded leg is reconciled after returning
 * to its account, even when the original observer settles in a later session.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import { act, renderHook } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Amount } from '@cashu/coco-core';
import { useMintRebalanceOrchestrator } from '@/features/mint/hooks/useMintRebalanceOrchestrator';
import type { RebalancePlan } from '@/features/mint/components/rebalance/rebalancePlanner';
import { useSwapTransactionsStore } from '@/shared/stores/profile/swapTransactionsStore';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { signalMigrationsComplete } from '@/shared/lib/cashu/profileScopedStorage';
import { registerProfileSwitchBoundary } from '@/shared/lib/account/accountRegistry';
import { runInProcessProfileSwitch } from '@/shared/lib/profile/inProcessProfileSwitch';
import { reconcileSwapLegs } from '@/shared/lib/cashu/reconcileSwapLegs';
import { anySwapGroupHeld, holdSwapGroup } from '@/shared/lib/cashu/swapGroupPhase';
import { setTransactionAnnotation } from '@/shared/stores/profile/transactionAnnotationStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@cashu/coco-react', () => ({ useManager: () => mockManager }));
jest.mock('@/shared/lib/cashu/manager', () => ({
  CocoManager: { restoreInflightProofsForMint: async () => undefined },
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
jest.mock('@/shared/lib/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const named: Record<string, unknown> = {
    redactError: (e: unknown) => e,
    mintUrlLogFields: () => ({}),
  };
  return new Proxy(named, { get: (target, key: string) => (key in target ? target[key] : log) });
});
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

const ACCOUNT_A = 'a'.repeat(64);
const ACCOUNT_B = 'b'.repeat(64);
const STORE = 'swap-transactions-store';
const SOURCE = 'https://source.example';
const DESTINATION = 'https://destination.example';

/** Whether account A's swap has completed. */
let swapCompleted = false;
let releaseWait: (() => void) | null = null;

function makeSwapOp(id: string, state: string) {
  return {
    id,
    revision: 1,
    sourceMintUrl: SOURCE,
    destinationMintUrl: DESTINATION,
    unit: 'sat' as const,
    destinationAmount: Amount.from(100),
    sourceQuote: { mintUrl: SOURCE, method: 'bolt11' as const, quoteId: 'melt-quote-1' },
    destinationQuote: { mintUrl: DESTINATION, method: 'bolt11' as const, quoteId: 'mint-quote-1' },
    sourceOperationId: 'melt-op-1',
    destinationOperationId: 'mint-op-1',
    paymentRequestHash: '00'.repeat(32),
    createdAt: 1000,
    updatedAt: 1000,
    stateEnteredAt: 1000,
    retry: { attemptCount: 0, lastAttemptAt: null, nextAttemptAt: null, lastError: null },
    state,
  };
}

function createManager() {
  return {
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
        execute: jest.fn(async (id: string) =>
          makeSwapOp(id, swapCompleted ? 'completed' : 'destination_funded')
        ),
        get: jest.fn(async (id: string) =>
          makeSwapOp(id, swapCompleted ? 'completed' : 'destination_funded')
        ),
        listActive: jest.fn(async () => []),
        refresh: jest.fn(async (id: string) =>
          makeSwapOp(id, swapCompleted ? 'completed' : 'destination_funded')
        ),
        cancel: jest.fn(async (id: string) => makeSwapOp(id, 'cancelled')),
        waitForOutcome: jest.fn(
          (id: string, _options?: { signal?: AbortSignal }) =>
            new Promise((resolve) => {
              releaseWait = () =>
                resolve({
                  status: swapCompleted ? 'completed' : 'timeout',
                  operation: makeSwapOp(id, swapCompleted ? 'completed' : 'destination_funded'),
                });
            })
        ),
      },
    },
    mint: { addMint: jest.fn().mockResolvedValue(undefined) },
  };
}
let mockManager = createManager();

const plan: RebalancePlan = {
  steps: [
    { id: 'step-1', fromMintUrl: SOURCE, toMintUrl: DESTINATION, amount: 100 },
    { id: 'step-2', fromMintUrl: SOURCE, toMintUrl: DESTINATION, amount: 100 },
  ],
  totalAmount: 200,
  currentBalances: { [SOURCE]: 1000, [DESTINATION]: 0 },
  targetBalances: { [SOURCE]: 900, [DESTINATION]: 100 },
};

async function flush(ms = 0) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

/** What is saved for `account`, as the store wrote it. */
async function saved(account: string) {
  const raw = await AsyncStorage.getItem(`${STORE}:profile:${account}`);
  return raw ? JSON.parse(raw).state : null;
}

async function switchTo(accountIndex: number) {
  const unregister = registerProfileSwitchBoundary({
    suspend: async () => {},
    resume: async () => {},
  });
  try {
    await act(async () => {
      await runInProcessProfileSwitch({
        cleanupCoco: async () => {},
        flipAccount: () => {
          useProfileStore.setState({ activeAccountIndex: accountIndex });
        },
      });
    });
  } finally {
    unregister();
  }
}

beforeEach(async () => {
  jest.useFakeTimers();
  swapCompleted = false;
  releaseWait = null;
  mockManager = createManager();
  jest.mocked(setTransactionAnnotation).mockClear();
  await AsyncStorage.clear();
  await useProfileStore.persist.rehydrate();
  useProfileStore.setState({
    activeAccountIndex: 0,
    profiles: [
      { accountIndex: 0, pubkey: ACCOUNT_A, addedAt: 1 },
      { accountIndex: 1, pubkey: ACCOUNT_B, addedAt: 2 },
    ],
  });
  signalMigrationsComplete();
  await useSwapTransactionsStore.persist.rehydrate();
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

function mountRebalance() {
  return renderHook(() =>
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
}

it('lets B swap immediately and reconciles the funded leg when A is reopened', async () => {
  const { result, unmount } = mountRebalance();
  // Account A: the first melt is paid, the destination has not issued yet.
  await act(async () => result.current.handleStart());
  await flush(100);
  const groupId = result.current.swapGroupId!;
  expect((await saved(ACCOUNT_A)).groups[groupId]).toMatchObject({
    state: 'running',
    legs: [{ localStatus: 'verifying', meltOperationId: 'melt-op-1' }],
  });
  const annotationsBeforeSwitch = jest.mocked(setTransactionAnnotation).mock.calls.length;

  // Account B holds a running group under the same id, so a write that
  // reaches B's history is seen. (Group ids are random; this makes the
  // account, not luck, decide where the late write goes.)
  const version = useSwapTransactionsStore.persist.getOptions().version;
  const bGroup = { id: groupId, unit: 'sat', createdAt: 1, title: 'B', state: 'running', legs: [] };
  await AsyncStorage.setItem(
    `${STORE}:profile:${ACCOUNT_B}`,
    JSON.stringify({ state: { groups: { [groupId]: bGroup }, quoteIdToGroup: {} }, version })
  );

  const managerA = mockManager;
  const settleA = releaseWait!;
  unmount();
  await switchTo(1);
  expect(anySwapGroupHeld()).toBe(false);
  expect(managerA.ops.mintSwap.waitForOutcome.mock.calls[0][1]?.signal?.aborted).toBe(true);

  mockManager = createManager();
  const accountB = mountRebalance();
  await act(async () => accountB.result.current.handleStart());
  await flush(100);
  expect(mockManager.ops.mintSwap.execute).toHaveBeenCalledTimes(1);
  expect(anySwapGroupHeld()).toBe(true);
  expect(useSwapTransactionsStore.getState().groups[groupId]).toEqual(bGroup);
  expect((await saved(ACCOUNT_B)).groups[groupId]).toEqual(bGroup);
  const annotationsAfterB = jest.mocked(setTransactionAnnotation).mock.calls.length;
  expect(annotationsAfterB).toBeGreaterThan(annotationsBeforeSwitch);

  accountB.unmount();
  await switchTo(0);
  expect(anySwapGroupHeld()).toBe(false);
  const releaseCurrentA = holdSwapGroup(groupId);
  swapCompleted = true;
  settleA();
  await flush(1000);

  expect(managerA.ops.mintSwap.execute).toHaveBeenCalledTimes(1);
  expect(managerA.ops.mintSwap.prepare).toHaveBeenCalledTimes(1);
  expect(managerA.ops.mintSwap.cancel).not.toHaveBeenCalled();
  expect(anySwapGroupHeld()).toBe(true);
  expect(setTransactionAnnotation).toHaveBeenCalledTimes(annotationsAfterB);
  expect(useSwapTransactionsStore.getState().groups[groupId]).toMatchObject({
    state: 'running',
    legs: [{ localStatus: 'verifying', meltOperationId: 'melt-op-1' }],
  });
  releaseCurrentA();

  // No run owns the group, so the reconciler settles it.
  await act(async () => {
    await reconcileSwapLegs({
      ops: {
        mintSwap: { get: async () => ({ state: 'completed' }), cancel: async () => undefined },
        melt: { get: async () => ({ state: 'finalized' }), cancel: async () => {} },
        mint: { get: async () => ({ state: 'finalized' }) },
      },
    });
  });
  expect(useSwapTransactionsStore.getState().groups[groupId]).toMatchObject({
    state: 'finished',
    legs: [{ localStatus: 'done' }],
  });
});

it('ignores a stale release after the same group id is held in B', async () => {
  const releaseA = holdSwapGroup('same-id');
  await switchTo(1);
  expect(anySwapGroupHeld()).toBe(false);
  const releaseB = holdSwapGroup('same-id');
  releaseA();
  expect(anySwapGroupHeld()).toBe(true);
  releaseB();
  await switchTo(0);
  expect(anySwapGroupHeld()).toBe(false);
});
