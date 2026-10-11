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

beforeEach(() => useSwapTransactionsStore.setState({ groups: {}, quoteIdToGroup: {} }));

function manager(operations: { mint?: Operation; melt?: Operation }) {
  return {
    ops: {
      mint: { get: jest.fn(async () => operations.mint ?? null) },
      melt: { get: jest.fn(async () => operations.melt ?? null) },
    },
  };
}

function savedLeg(
  localStatus: 'settling' | 'paymentPending' | 'melting' | 'verifying' | 'done',
  ids = { mint: 'mint-op', melt: 'melt-op' }
) {
  const store = useSwapTransactionsStore.getState();
  const groupId = store.startGroup({ unit: 'sat', title: 'Rebalance' });
  const legId = useSwapTransactionsStore.getState().addLeg(groupId, {
    fromMintUrl: 'https://mint.one',
    toMintUrl: 'https://mint.two',
    amount: 21,
  });
  const actions = useSwapTransactionsStore.getState();
  actions.tagMintQuote(groupId, legId, { quoteId: `q-${ids.mint}`, operationId: ids.mint });
  actions.tagMelt(groupId, legId, { quoteId: `q-${ids.melt}`, operationId: ids.melt });
  actions.setLegStatus(groupId, legId, { localStatus });
  const leg = () => useSwapTransactionsStore.getState().groups[groupId].legs[0];
  return Object.assign(leg, { groupId, legId });
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

it('marks a settling leg failed when its melt turns out to have been rolled back', async () => {
  const leg = savedLeg('settling');

  await reconcileSwapLegs(
    manager({ melt: { state: 'rolled_back' }, mint: { state: 'finalized' } })
  );

  expect(leg().localStatus).toBe('failed');
});

it.each(['melting', 'verifying'] as const)(
  'settles a leg a finished run left at %s, and leaves it alone while the run is going',
  async (status) => {
    const leg = savedLeg(status);
    const coco = manager({ melt: { state: 'finalized' }, mint: { state: 'finalized' } });

    await reconcileSwapLegs(coco);
    expect(leg().localStatus).toBe(status);

    useSwapTransactionsStore.getState().finalizeGroup(leg.groupId, 'finished');
    await reconcileSwapLegs(coco);
    expect(leg().localStatus).toBe('done');
  }
);

it('does not overwrite a leg that changed while its operation was being read', async () => {
  const leg = savedLeg('settling');
  const coco = manager({});
  coco.ops.mint.get.mockImplementation(async () => {
    useSwapTransactionsStore
      .getState()
      .setLegStatus(leg.groupId, leg.legId, { localStatus: 'failed', errorMessage: 'x' });
    return { state: 'finalized' };
  });

  await reconcileSwapLegs(coco);

  expect(leg().localStatus).toBe('failed');
});

it('reads nothing when no leg is unsettled', async () => {
  savedLeg('done');
  const coco = manager({});

  await reconcileSwapLegs(coco);

  expect(coco.ops.mint.get).not.toHaveBeenCalled();
  expect(coco.ops.melt.get).not.toHaveBeenCalled();
});

it('keeps going when one read fails', async () => {
  const first = savedLeg('settling', { mint: 'mint-a', melt: 'melt-a' });
  const second = savedLeg('settling', { mint: 'mint-b', melt: 'melt-b' });
  const coco = manager({ melt: { state: 'finalized' }, mint: { state: 'finalized' } });
  coco.ops.mint.get.mockImplementation(async (...[id]: unknown[]) => {
    if (id === 'mint-a') throw new Error('database is locked');
    return { state: 'finalized' };
  });

  await reconcileSwapLegs(coco);

  expect(first().localStatus).toBe('settling');
  expect(second().localStatus).toBe('done');
});
