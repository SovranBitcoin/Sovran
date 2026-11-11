/**
 * A swap run that outlives an account switch. The run started for account A;
 * the switch unmounts the account's tree (`AccountScopedProviders` is keyed by
 * account), so the screen's hook is gone, but its run is a closure that keeps
 * the manager it started with and never sees B's. The swap history store is
 * reset and loaded again for B while that run goes on: its late writes must
 * not land in B's history, and it must not start new work for A from under
 * B: the leg in flight finishes, and before the next one opens the run ends
 * and gives up its hold. A's saved group is left running, and the next time A
 * is open the reconciler settles it from its own operations.
 *
 * The real swap history store runs over the real profile-scoped storage
 * (backed by the AsyncStorage mock) and the real profile store; the real
 * `wallet` rebalance engine runs against a fake Coco manager, as in
 * `mintRebalanceRetryAgreement.test.ts`.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import { act, renderHook } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Amount } from '@cashu/coco-core';
import { useMintRebalanceOrchestrator } from '@/features/mint/hooks/useMintRebalanceOrchestrator';
import type { RebalancePlan } from '@/features/mint/components/rebalance/rebalancePlanner';
import { useSwapTransactionsStore } from '@/shared/stores/profile/swapTransactionsStore';
import { useSwapStatusStore } from '@/shared/stores/runtime/swapStatusStore';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import {
  blockProfilePersistWrites,
  signalMigrationsComplete,
  unblockProfilePersistWrites,
} from '@/shared/lib/cashu/profileScopedStorage';
import { reconcileSwapLegs } from '@/shared/lib/cashu/reconcileSwapLegs';
import { anySwapGroupHeld } from '@/shared/lib/cashu/swapGroupPhase';
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

const ACCOUNT_A = 'a'.repeat(64);
const ACCOUNT_B = 'b'.repeat(64);
const STORE = 'swap-transactions-store';
const SOURCE = 'https://source.example';
const DESTINATION = 'https://destination.example';

/** Whether account A's recipient has issued. */
let recipientState = 'pending';

function createManager() {
  const operation = () => ({
    id: 'mint-op-1',
    quoteId: 'mint-quote-1',
    mintUrl: DESTINATION,
    method: 'bolt11',
    request: 'lnbc-fixture',
    amount: Amount.from(100),
    unit: 'sat',
    state: recipientState,
    createdAt: 1000,
    updatedAt: 1000,
  });
  return {
    wallet: {
      balances: {
        byMint: jest.fn(async () => ({
          [SOURCE]: { total: Amount.from(1000) },
          [DESTINATION]: { total: Amount.from(0) },
        })),
      },
    },
    quotes: {
      mint: {
        create: jest.fn(async () => ({
          quoteId: 'mint-quote-1',
          mintUrl: DESTINATION,
          unit: 'sat',
          request: 'lnbc-fixture',
        })),
      },
      melt: { create: jest.fn(async () => ({ quoteId: 'melt-quote-1', mintUrl: SOURCE })) },
    },
    ops: {
      mint: {
        prepare: jest.fn(async () => operation()),
        get: jest.fn(async () => operation()),
      },
      melt: {
        prepare: jest.fn(async () => ({
          id: 'melt-op-1',
          quoteId: 'melt-quote-1',
          amount: Amount.from(100),
          fee_reserve: 0,
          swap_fee: 0,
        })),
        execute: jest.fn(async () => ({ id: 'melt-op-1', state: 'finalized' })),
        refresh: jest.fn(async () => ({ id: 'melt-op-1', state: 'finalized' })),
        get: jest.fn(async () => null),
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

/** The in-process account switch: writes held, stores reset, account flipped, loaded again. */
async function switchTo(accountIndex: number) {
  await act(async () => {
    await blockProfilePersistWrites();
    useSwapTransactionsStore.setState(useSwapTransactionsStore.getInitialState(), true);
    useSwapStatusStore.setState(useSwapStatusStore.getInitialState(), true);
    useProfileStore.setState({ activeAccountIndex: accountIndex });
    await useSwapTransactionsStore.persist.rehydrate();
    unblockProfilePersistWrites();
  });
}

beforeEach(async () => {
  jest.useFakeTimers();
  recipientState = 'pending';
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

it('a run that outlives an account switch finishes its leg in flight, starts no other, writes nothing into the next account, and its own group settles when that account opens again', async () => {
  const { result, unmount } = renderHook(() =>
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

  // The switch unmounts A's tree; the run goes on with A's manager.
  const managerA = mockManager;
  unmount();
  await switchTo(1);
  expect(useSwapTransactionsStore.getState().groups[groupId]?.title).toBe('B');

  // A's first transfer arrives. The run would move on to the second, but the
  // open account is no longer A: it pays nothing more and lets the group go,
  // so a swap can start in B.
  recipientState = 'finalized';
  await flush(16000);
  await flush(16000);
  expect(managerA.ops.melt.execute).toHaveBeenCalledTimes(1);
  expect(managerA.quotes.mint.create).toHaveBeenCalledTimes(1);
  expect(anySwapGroupHeld()).toBe(false);

  // B's history is untouched, in memory and saved, and no annotation was written for it.
  expect(useSwapTransactionsStore.getState().groups[groupId]).toEqual(bGroup);
  expect((await saved(ACCOUNT_B)).groups[groupId]).toEqual(bGroup);
  expect(setTransactionAnnotation).toHaveBeenCalledTimes(annotationsBeforeSwitch);

  // A's saved group is left as the run last wrote it before the switch: one
  // leg, its melt paid, its mint not yet seen.
  const savedA = (await saved(ACCOUNT_A)).groups[groupId];
  expect(savedA).toMatchObject({
    state: 'running',
    legs: [{ localStatus: 'verifying', meltOperationId: 'melt-op-1' }],
  });
  expect(savedA.legs).toHaveLength(1);

  // A opens again: no run owns the group, so the reconciler settles it.
  await switchTo(0);
  await act(async () => {
    await reconcileSwapLegs({
      ops: {
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
