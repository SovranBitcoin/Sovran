/**
 * @jest-environment node
 *
 * A swap leg saved as settling (the money left, the destination had not
 * issued) or as payment pending (the melt's outcome was unknown) is moved to
 * its final state from Coco's own operations, and never guessed.
 */

import { reconcileSwapLegs } from '@/shared/lib/cashu/reconcileSwapLegs';
import { useSwapTransactionsStore } from '@/shared/stores/profile/swapTransactionsStore';

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));

jest.mock('@/shared/lib/logger', () => ({
  storeLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  cashuLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
}));

type Operation = { state: string; error?: string } | null;

function manager(operations: { mint?: Operation; melt?: Operation }) {
  return {
    ops: {
      mint: { get: jest.fn(async () => operations.mint ?? null) },
      melt: { get: jest.fn(async () => operations.melt ?? null) },
    },
  };
}

function savedLeg(localStatus: 'settling' | 'paymentPending' | 'done') {
  const store = useSwapTransactionsStore.getState();
  const groupId = store.startGroup({ unit: 'sat', title: 'Rebalance' });
  const legId = useSwapTransactionsStore.getState().addLeg(groupId, {
    fromMintUrl: 'https://mint.one',
    toMintUrl: 'https://mint.two',
    amount: 21,
  });
  const actions = useSwapTransactionsStore.getState();
  actions.tagMintQuote(groupId, legId, { quoteId: 'mint-quote', operationId: 'mint-op' });
  actions.tagMelt(groupId, legId, { quoteId: 'melt-quote', operationId: 'melt-op' });
  actions.setLegStatus(groupId, legId, { localStatus });
  return () => useSwapTransactionsStore.getState().groups[groupId].legs[0];
}

it('marks a settling leg done once its own mint operation is finalized', async () => {
  const leg = savedLeg('settling');
  const coco = manager({ mint: { state: 'finalized' } });

  await reconcileSwapLegs(coco);

  expect(coco.ops.mint.get).toHaveBeenCalledWith('mint-op');
  expect(leg().localStatus).toBe('done');
});

it.each([
  ['still pending', { state: 'pending' }],
  ['finalized with an error', { state: 'finalized', error: 'Issued quote but no proofs restored' }],
  ['failed', { state: 'failed' }],
  ['unknown to Coco', null],
])('leaves a settling leg alone while its mint operation is %s', async (_name, mint) => {
  const leg = savedLeg('settling');

  await reconcileSwapLegs(manager({ mint }));

  expect(leg().localStatus).toBe('settling');
});

it('moves a pending payment to settling when the melt was paid, then to done when it arrived', async () => {
  const leg = savedLeg('paymentPending');

  await reconcileSwapLegs(manager({ melt: { state: 'finalized' }, mint: { state: 'pending' } }));
  expect(leg().localStatus).toBe('settling');

  await reconcileSwapLegs(manager({ mint: { state: 'finalized' } }));
  expect(leg().localStatus).toBe('done');
});

it('marks a pending payment failed when the melt was rolled back', async () => {
  const leg = savedLeg('paymentPending');

  await reconcileSwapLegs(manager({ melt: { state: 'rolled_back' } }));

  expect(leg()).toMatchObject({ localStatus: 'failed', errorMessage: expect.any(String) });
});

it('leaves a pending payment alone while the melt is unresolved', async () => {
  const leg = savedLeg('paymentPending');

  await reconcileSwapLegs(manager({ melt: { state: 'pending' } }));

  expect(leg().localStatus).toBe('paymentPending');
});

it('reads nothing when no leg is unsettled', async () => {
  savedLeg('done');
  useSwapTransactionsStore.setState({
    groups: Object.fromEntries(
      Object.entries(useSwapTransactionsStore.getState().groups).filter(([, group]) =>
        group.legs.every((leg) => leg.localStatus === 'done')
      )
    ),
  });
  const coco = manager({});

  await reconcileSwapLegs(coco);

  expect(coco.ops.mint.get).not.toHaveBeenCalled();
  expect(coco.ops.melt.get).not.toHaveBeenCalled();
});

it('keeps going when one read fails', async () => {
  const first = savedLeg('settling');
  const second = savedLeg('settling');
  const coco = manager({ mint: { state: 'finalized' } });
  coco.ops.mint.get.mockRejectedValueOnce(new Error('database is locked'));

  await reconcileSwapLegs(coco);

  expect([first().localStatus, second().localStatus].sort()).toContain('done');
});
