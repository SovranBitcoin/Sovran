/**
 * @jest-environment node
 *
 * A swap leg saved as settling (the money left, the destination had not
 * issued) or as payment pending (the melt's outcome was unknown) is moved to
 * its final state from Coco's own operations, and never guessed.
 */

import { createSwapLegReconciler, reconcileSwapLegs } from '@/shared/lib/cashu/reconcileSwapLegs';
import { holdSwapGroup } from '@/shared/lib/cashu/swapGroupPhase';
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

const groupState = (groupId: string) => useSwapTransactionsStore.getState().groups[groupId].state;

function manager(operations: { mint?: Operation; melt?: Operation }) {
  return {
    ops: {
      mint: { get: jest.fn(async () => operations.mint ?? null) },
      melt: {
        get: jest.fn(async () => operations.melt ?? null),
        cancel: jest.fn(async (_operationId: string, _reason?: string) => {}),
      },
    },
  };
}

function savedLeg(
  localStatus: 'settling' | 'paymentPending' | 'melting' | 'verifying' | 'invoiceReady' | 'done',
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

it.each(['pending', 'executing', 'rolling_back'])(
  'leaves a pending payment alone while the melt is %s',
  async (state) => {
    const leg = savedLeg('paymentPending');

    await reconcileSwapLegs(manager({ melt: { state } }));

    expect(leg().localStatus).toBe('paymentPending');
  }
);

it('marks a pending payment failed when its melt failed, its inputs given back', async () => {
  const leg = savedLeg('paymentPending');
  const coco = manager({ melt: { state: 'failed' } });

  await reconcileSwapLegs(coco);

  expect(leg()).toMatchObject({ localStatus: 'failed', errorMessage: expect.any(String) });
  expect(coco.ops.melt.cancel).not.toHaveBeenCalled();
});

describe('a pending payment whose melt was never sent (the engine gave up on it unsent)', () => {
  it.each(['prepared', 'init'])(
    'cancels the %s melt through Coco first, and fails the leg once it is cancelled',
    async (state) => {
      const leg = savedLeg('paymentPending');
      const coco = manager({ melt: { state } });
      coco.ops.melt.cancel.mockImplementation(async () => {
        // Until the cancel has returned, the melt could still be sent.
        expect(leg().localStatus).toBe('paymentPending');
      });

      await reconcileSwapLegs(coco);

      expect(coco.ops.melt.cancel).toHaveBeenCalledWith('melt-op', expect.any(String));
      expect(leg()).toMatchObject({ localStatus: 'failed', errorMessage: expect.any(String) });
    }
  );

  it.each(['prepared', 'init'])(
    'leaves the leg pending when Coco will not cancel the %s melt',
    async (state) => {
      // Coco refuses a melt another call has started sending, and an init one.
      const leg = savedLeg('paymentPending');
      const coco = manager({ melt: { state } });
      coco.ops.melt.cancel.mockRejectedValue(
        new Error(`Cannot cancel operation in state 'executing'. Expected 'prepared'.`)
      );

      await reconcileSwapLegs(coco);

      expect(leg().localStatus).toBe('paymentPending');
    }
  );

  it('does not cancel once this pass has been replaced', async () => {
    const leg = savedLeg('paymentPending');
    const coco = manager({ melt: { state: 'prepared' } });
    let current = true;
    coco.ops.melt.get.mockImplementation(async () => {
      current = false;
      return { state: 'prepared' };
    });

    await reconcileSwapLegs(coco, () => current);

    expect(coco.ops.melt.cancel).not.toHaveBeenCalled();
    expect(leg().localStatus).toBe('paymentPending');
  });

  it('does not cancel a melt whose leg changed while it was read', async () => {
    const leg = savedLeg('paymentPending', { mint: 'mint-1', melt: 'melt-1' });
    const coco = manager({});
    coco.ops.melt.get.mockImplementation(async () => {
      useSwapTransactionsStore
        .getState()
        .setLegStatus(leg.groupId, leg.legId, { localStatus: 'settling' });
      return { state: 'prepared' };
    });

    await reconcileSwapLegs(coco);

    expect(coco.ops.melt.cancel).not.toHaveBeenCalled();
    expect(leg().localStatus).toBe('settling');
  });
});

it('marks a leg a finished run left at melting failed when its melt failed', async () => {
  const leg = savedLeg('melting');

  await reconcileSwapLegs(manager({ melt: { state: 'failed' } }));

  expect(leg().localStatus).toBe('failed');
  expect(groupState(leg.groupId)).toBe('finished');
});

it('marks a settling leg failed when its melt turns out to have been rolled back', async () => {
  const leg = savedLeg('settling');

  await reconcileSwapLegs(
    manager({ melt: { state: 'rolled_back' }, mint: { state: 'finalized' } })
  );

  expect(leg().localStatus).toBe('failed');
});

it.each(['melting', 'verifying'] as const)(
  'settles a leg a finished run left at %s, and leaves it alone while its run is going',
  async (status) => {
    const leg = savedLeg(status);
    const coco = manager({ melt: { state: 'finalized' }, mint: { state: 'finalized' } });
    const release = holdSwapGroup(leg.groupId);

    await reconcileSwapLegs(coco);
    expect(leg().localStatus).toBe(status);
    expect(groupState(leg.groupId)).toBe('running');

    useSwapTransactionsStore.getState().finalizeGroup(leg.groupId, 'finished');
    release();
    await reconcileSwapLegs(coco);
    expect(leg().localStatus).toBe('done');
  }
);

describe('a leg left at invoiceReady with a melt (killed after the melt was prepared, or mid input-shortfall retry)', () => {
  it('settles it from its melt and mint, and ends the group finished', async () => {
    const leg = savedLeg('invoiceReady');

    await reconcileSwapLegs(
      manager({ melt: { state: 'finalized' }, mint: { state: 'finalized' } })
    );

    expect(leg().localStatus).toBe('done');
    expect(groupState(leg.groupId)).toBe('finished');
  });

  it('moves it to settling once the melt was paid, while the destination has not issued', async () => {
    const leg = savedLeg('invoiceReady');

    await reconcileSwapLegs(manager({ melt: { state: 'finalized' }, mint: { state: 'pending' } }));

    expect(leg().localStatus).toBe('settling');
    expect(groupState(leg.groupId)).toBe('running');
  });

  it('fails it when its melt was rolled back', async () => {
    const leg = savedLeg('invoiceReady');

    await reconcileSwapLegs(manager({ melt: { state: 'rolled_back' } }));

    expect(leg()).toMatchObject({ localStatus: 'failed', errorMessage: expect.any(String) });
    expect(groupState(leg.groupId)).toBe('finished');
  });

  it.each([
    ['prepared', { state: 'prepared' }],
    ['still pending', { state: 'pending' }],
    ['unknown to Coco', null],
  ])('leaves it and its group alone while the melt is %s', async (_name, melt) => {
    const leg = savedLeg('invoiceReady');

    await reconcileSwapLegs(manager({ melt, mint: { state: 'finalized' } }));

    expect(leg().localStatus).toBe('invoiceReady');
    expect(groupState(leg.groupId)).toBe('running');
  });

  it('leaves it alone while a live run owns its group', async () => {
    const leg = savedLeg('invoiceReady');
    const coco = manager({ melt: { state: 'finalized' }, mint: { state: 'finalized' } });
    const release = holdSwapGroup(leg.groupId);

    await reconcileSwapLegs(coco);

    expect(coco.ops.melt.get).not.toHaveBeenCalled();
    expect(leg().localStatus).toBe('invoiceReady');
    release();
  });
});

describe('a group saved as running that no run owns (the app was killed mid-run)', () => {
  it.each(['melting', 'verifying'] as const)(
    'settles a leg left at %s from its own operations and ends the group finished',
    async (status) => {
      const leg = savedLeg(status);

      await reconcileSwapLegs(
        manager({ melt: { state: 'finalized' }, mint: { state: 'finalized' } })
      );

      expect(leg().localStatus).toBe('done');
      expect(groupState(leg.groupId)).toBe('finished');
    }
  );

  it('ends the group finished once a settling leg arrives', async () => {
    const leg = savedLeg('settling');

    await reconcileSwapLegs(manager({ mint: { state: 'finalized' } }));

    expect(leg().localStatus).toBe('done');
    expect(groupState(leg.groupId)).toBe('finished');
  });

  it('ends the group finished with the leg failed when its melt was rolled back', async () => {
    const leg = savedLeg('melting');

    await reconcileSwapLegs(manager({ melt: { state: 'rolled_back' } }));

    expect(leg().localStatus).toBe('failed');
    expect(groupState(leg.groupId)).toBe('finished');
  });

  it.each([
    ['still pending', { state: 'pending' }],
    ['executing', { state: 'executing' }],
    ['unknown to Coco', null],
  ])('leaves a melting leg and its group alone while the melt is %s', async (_name, melt) => {
    const leg = savedLeg('melting');

    await reconcileSwapLegs(manager({ melt, mint: { state: 'finalized' } }));

    expect(leg().localStatus).toBe('melting');
    expect(groupState(leg.groupId)).toBe('running');
  });

  it('leaves a melting leg with no melt to read, and its group, alone', async () => {
    // A middleman hop records its melt only once the melt has settled.
    const leg = savedLeg('melting');
    useSwapTransactionsStore.setState((state) => ({
      groups: {
        ...state.groups,
        [leg.groupId]: {
          ...state.groups[leg.groupId],
          legs: [{ ...leg(), meltOperationId: undefined }],
        },
      },
    }));
    const coco = manager({ mint: { state: 'finalized' } });

    await reconcileSwapLegs(coco);

    expect(coco.ops.melt.get).not.toHaveBeenCalled();
    expect(leg().localStatus).toBe('melting');
    expect(groupState(leg.groupId)).toBe('running');
  });

  it('keeps the group running while a paid leg has not arrived', async () => {
    const leg = savedLeg('settling');

    await reconcileSwapLegs(manager({ mint: { state: 'failed' } }));

    expect(leg().localStatus).toBe('settling');
    expect(groupState(leg.groupId)).toBe('running');
  });

  it('ends the group cancelled when a leg stopped before it sent anything', async () => {
    const leg = savedLeg('done');
    const later = useSwapTransactionsStore.getState().addLeg(leg.groupId, {
      fromMintUrl: 'https://mint.two',
      toMintUrl: 'https://mint.three',
      amount: 5,
    });
    useSwapTransactionsStore
      .getState()
      .setLegStatus(leg.groupId, later, { localStatus: 'creatingInvoice' });
    const coco = manager({});

    await reconcileSwapLegs(coco);

    expect(coco.ops.melt.get).not.toHaveBeenCalled();
    expect(groupState(leg.groupId)).toBe('cancelled');
    expect(leg().localStatus).toBe('done');
  });

  it('ends a group with no legs cancelled', async () => {
    const groupId = useSwapTransactionsStore.getState().startGroup({ unit: 'sat' });

    await reconcileSwapLegs(manager({}));

    expect(groupState(groupId)).toBe('cancelled');
  });

  it('leaves a group a live run owns running, and its legs in flight alone', async () => {
    const leg = savedLeg('melting');
    const release = holdSwapGroup(leg.groupId);

    await reconcileSwapLegs(
      manager({ melt: { state: 'finalized' }, mint: { state: 'finalized' } })
    );

    expect(leg().localStatus).toBe('melting');
    expect(groupState(leg.groupId)).toBe('running');
    release();
  });

  it('does not end a group a run took up while its operations were being read', async () => {
    const leg = savedLeg('settling');
    let release = () => {};
    const coco = manager({});
    coco.ops.mint.get.mockImplementation(async () => {
      release = holdSwapGroup(leg.groupId);
      return { state: 'finalized' };
    });

    await reconcileSwapLegs(coco);

    expect(leg().localStatus).toBe('done');
    expect(groupState(leg.groupId)).toBe('running');
    release();
  });
});

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

describe('a result read for an earlier attempt is never applied to a later one', () => {
  it('when a retry prepared a new melt and the leg kept its status', async () => {
    // A retry for short inputs: the leg stays at invoiceReady and its first
    // melt is rolled back while a new one is prepared.
    const leg = savedLeg('invoiceReady', { mint: 'mint-1', melt: 'melt-1' });
    useSwapTransactionsStore.getState().finalizeGroup(leg.groupId, 'cancelled');
    const coco = manager({});
    coco.ops.melt.get.mockImplementation(async () => {
      useSwapTransactionsStore
        .getState()
        .tagMelt(leg.groupId, leg.legId, { quoteId: 'q-melt-2', operationId: 'melt-2' });
      return { state: 'rolled_back' };
    });

    await reconcileSwapLegs(coco);

    expect(leg()).toMatchObject({ localStatus: 'invoiceReady', meltOperationId: 'melt-2' });
  });

  it('when a retry came back to the same status with a new mint', async () => {
    const leg = savedLeg('settling', { mint: 'mint-1', melt: 'melt-1' });
    const coco = manager({ melt: { state: 'finalized' } });
    coco.ops.mint.get.mockImplementation(async () => {
      const store = useSwapTransactionsStore.getState();
      for (const localStatus of ['failed', 'creatingInvoice', 'invoiceReady'] as const) {
        store.setLegStatus(leg.groupId, leg.legId, { localStatus });
      }
      store.tagMintQuote(leg.groupId, leg.legId, { quoteId: 'q-mint-2', operationId: 'mint-2' });
      store.tagMelt(leg.groupId, leg.legId, { quoteId: 'q-melt-2', operationId: 'melt-2' });
      store.setLegStatus(leg.groupId, leg.legId, { localStatus: 'settling' });
      return { state: 'finalized' };
    });

    await reconcileSwapLegs(coco);

    expect(leg()).toMatchObject({ localStatus: 'settling', mintOperationId: 'mint-2' });
  });
});

it('writes nothing once stopped, though a pass was reading when it stopped', async () => {
  const leg = savedLeg('settling');
  let finishRead: (operation: Operation) => void = () => {};
  const coco = manager({});
  coco.ops.mint.get.mockImplementation(
    () => new Promise<Operation>((resolve) => (finishRead = resolve))
  );
  const reconciler = createSwapLegReconciler(coco);

  reconciler.run();
  await new Promise((resolve) => setImmediate(resolve));
  expect(coco.ops.mint.get).toHaveBeenCalledTimes(1);
  reconciler.stop();
  finishRead({ state: 'finalized' });
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));

  expect(leg().localStatus).toBe('settling');
  expect(groupState(leg.groupId)).toBe('running');
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

it('runs one pass at a time, and one more for requests that land during it', async () => {
  savedLeg('settling');
  const coco = manager({ mint: { state: 'pending' } });
  const reconciler = createSwapLegReconciler(coco);

  for (let i = 0; i < 40; i++) reconciler.run();
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));

  // Two passes over one unsettled leg, not forty.
  expect(coco.ops.mint.get).toHaveBeenCalledTimes(2);
});

describe('a pass whose write was refused because the leg changed while it was read', () => {
  const settle = async () => {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
  };

  it('is followed by one more pass, which reads the leg as it is now', async () => {
    // A retry prepared a new melt while the first one was being read.
    const leg = savedLeg('invoiceReady', { mint: 'mint-1', melt: 'melt-1' });
    useSwapTransactionsStore.getState().finalizeGroup(leg.groupId, 'cancelled');
    const coco = manager({ mint: { state: 'finalized' } });
    coco.ops.melt.get.mockImplementation(async (...[id]: unknown[]) => {
      if (id === 'melt-2') return { state: 'finalized' };
      useSwapTransactionsStore
        .getState()
        .tagMelt(leg.groupId, leg.legId, { quoteId: 'q-melt-2', operationId: 'melt-2' });
      return { state: 'rolled_back' };
    });

    createSwapLegReconciler(coco).run();
    await settle();

    expect(coco.ops.melt.get.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      'melt-1',
      'melt-2',
    ]);
    expect(leg()).toMatchObject({ localStatus: 'done', meltOperationId: 'melt-2' });
  });

  it('is followed by one more pass only, though the leg changes during that one too', async () => {
    const leg = savedLeg('invoiceReady', { mint: 'mint-1', melt: 'melt-1' });
    useSwapTransactionsStore.getState().finalizeGroup(leg.groupId, 'cancelled');
    let next = 1;
    const coco = manager({});
    coco.ops.melt.get.mockImplementation(async () => {
      next += 1;
      useSwapTransactionsStore.getState().tagMelt(leg.groupId, leg.legId, {
        quoteId: `q-melt-${next}`,
        operationId: `melt-${next}`,
      });
      return { state: 'rolled_back' };
    });

    createSwapLegReconciler(coco).run();
    await settle();

    expect(coco.ops.melt.get).toHaveBeenCalledTimes(2);
    expect(leg().localStatus).toBe('invoiceReady');
  });
});
