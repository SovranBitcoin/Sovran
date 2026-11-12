/**
 * @jest-environment node
 *
 * Behaviour lock for the leg-level swap actions now that they share one
 * `patchLeg` rewrite. Three things must survive the merge: other legs and
 * other groups are left untouched, a tag against a missing group is a silent
 * no-op that writes NO quote index entry (otherwise the index would point at a
 * leg that does not exist), and `setLegStatus` keeps an existing error message
 * only while the leg is still failed.
 */

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
  redactError: (error: unknown) => error,
}));

const leg = (amount: number) => ({
  fromMintUrl: 'https://mint.one',
  toMintUrl: 'https://mint.two',
  amount,
});

function freshGroup() {
  const store = useSwapTransactionsStore.getState();
  const groupId = store.startGroup({ unit: 'sat', title: 'Rebalance' });
  const legA = useSwapTransactionsStore.getState().addLeg(groupId, leg(21));
  const legB = useSwapTransactionsStore.getState().addLeg(groupId, leg(42));
  return { groupId, legA, legB };
}

beforeEach(() => {
  useSwapTransactionsStore.setState({ groups: {}, quoteIdToGroup: {} });
});

describe('swap leg patching', () => {
  it('tags a mint quote on one leg and indexes it back to that leg', () => {
    const { groupId, legA, legB } = freshGroup();

    useSwapTransactionsStore.getState().tagMintQuote(groupId, legA, { quoteId: 'quote-mint' });

    const state = useSwapTransactionsStore.getState();
    const legs = state.getGroup(groupId)!.legs;
    expect(legs.find((l) => l.id === legA)!.mintQuoteId).toBe('quote-mint');
    expect(legs.find((l) => l.id === legB)!.mintQuoteId).toBeUndefined();
    expect(state.quoteIdToGroup['quote-mint']).toEqual({ groupId, legId: legA, kind: 'mint' });
  });

  it('tags a melt quote with its operation id under the melt kind', () => {
    const { groupId, legA } = freshGroup();

    useSwapTransactionsStore
      .getState()
      .tagMelt(groupId, legA, { quoteId: 'quote-melt', operationId: 'op-1' });

    const state = useSwapTransactionsStore.getState();
    const tagged = state.getGroup(groupId)!.legs.find((l) => l.id === legA)!;
    expect(tagged.meltQuoteId).toBe('quote-melt');
    expect(tagged.meltOperationId).toBe('op-1');
    expect(state.quoteIdToGroup['quote-melt']).toEqual({ groupId, legId: legA, kind: 'melt' });
  });

  it('writes no quote index entry when the group is gone', () => {
    const { legA } = freshGroup();

    useSwapTransactionsStore
      .getState()
      .tagMintQuote('missing-group', legA, { quoteId: 'orphan-quote' });
    useSwapTransactionsStore
      .getState()
      .tagMelt('missing-group', legA, { quoteId: 'orphan-melt', operationId: 'op-1' });

    const { quoteIdToGroup } = useSwapTransactionsStore.getState();
    expect(quoteIdToGroup['orphan-quote']).toBeUndefined();
    expect(quoteIdToGroup['orphan-melt']).toBeUndefined();
  });

  it('ignores an empty quote id entirely', () => {
    const { groupId, legA } = freshGroup();

    useSwapTransactionsStore.getState().tagMintQuote(groupId, legA, { quoteId: '' });

    const state = useSwapTransactionsStore.getState();
    expect(state.getGroup(groupId)!.legs.find((l) => l.id === legA)!.mintQuoteId).toBeUndefined();
    expect(Object.keys(state.quoteIdToGroup)).toHaveLength(0);
  });

  it('keeps an existing error message while failed and clears it when a new attempt starts', () => {
    const { groupId, legA } = freshGroup();
    const legOf = () =>
      useSwapTransactionsStore
        .getState()
        .getGroup(groupId)!
        .legs.find((l) => l.id === legA)!;

    useSwapTransactionsStore
      .getState()
      .setLegStatus(groupId, legA, { localStatus: 'failed', errorMessage: 'mint offline' });
    expect(legOf().errorMessage).toBe('mint offline');

    useSwapTransactionsStore.getState().setLegStatus(groupId, legA, { localStatus: 'failed' });
    expect(legOf().errorMessage).toBe('mint offline');

    // A failed leg goes again through a new invoice, not straight to done.
    useSwapTransactionsStore.getState().setLegStatus(groupId, legA, { localStatus: 'done' });
    expect(legOf()).toMatchObject({ localStatus: 'failed', errorMessage: 'mint offline' });

    useSwapTransactionsStore
      .getState()
      .setLegStatus(groupId, legA, { localStatus: 'creatingInvoice' });
    expect(legOf().errorMessage).toBeUndefined();
    expect(legOf().localStatus).toBe('creatingInvoice');
  });

  it('follows a transfer through to done, and keeps a done leg done', () => {
    const { groupId, legA } = freshGroup();
    const path = [
      'pending',
      'creatingInvoice',
      'invoiceReady',
      'invoiceReady',
      'melting',
      'verifying',
      'done',
    ] as const;
    for (const localStatus of path) {
      useSwapTransactionsStore.getState().setLegStatus(groupId, legA, { localStatus });
    }
    expect(useSwapTransactionsStore.getState().getGroup(groupId)!.legs[0].localStatus).toBe('done');

    useSwapTransactionsStore
      .getState()
      .setLegStatus(groupId, legA, { localStatus: 'failed', errorMessage: 'late' });
    useSwapTransactionsStore.getState().setLegStatus(groupId, legA, { localStatus: 'settling' });

    expect(
      useSwapTransactionsStore
        .getState()
        .getGroup(groupId)!
        .legs.find((l) => l.id === legA)
    ).toMatchObject({ localStatus: 'done', errorMessage: undefined });
  });

  it('never moves a leg whose money has left back to before its melt', () => {
    const { groupId, legA } = freshGroup();
    const set = (localStatus: 'melting' | 'paymentPending' | 'pending' | 'creatingInvoice') =>
      useSwapTransactionsStore.getState().setLegStatus(groupId, legA, { localStatus });
    set('pending');
    set('melting');
    set('paymentPending');

    set('pending');
    set('creatingInvoice');

    expect(useSwapTransactionsStore.getState().getGroup(groupId)!.legs[0].localStatus).toBe(
      'paymentPending'
    );
  });

  it('clips a new error message to 2048 characters, from a status or a new leg', () => {
    const { groupId, legA, legB } = freshGroup();
    const legOf = (legId: string) =>
      useSwapTransactionsStore
        .getState()
        .getGroup(groupId)!
        .legs.find((l) => l.id === legId)!;

    useSwapTransactionsStore
      .getState()
      .setLegStatus(groupId, legA, { localStatus: 'failed', errorMessage: 'e'.repeat(2049) });
    useSwapTransactionsStore
      .getState()
      .setLegStatus(groupId, legB, { localStatus: 'failed', errorMessage: 'f'.repeat(2048) });
    const added = useSwapTransactionsStore
      .getState()
      .addLeg(groupId, { ...leg(7), localStatus: 'failed', errorMessage: 'g'.repeat(5000) });

    expect(legOf(legA).errorMessage).toBe('e'.repeat(2048));
    expect(legOf(legB).errorMessage).toBe('f'.repeat(2048));
    expect(legOf(added).errorMessage).toBe('g'.repeat(2048));
  });

  it('leaves other groups untouched', () => {
    const first = freshGroup();
    const second = freshGroup();

    useSwapTransactionsStore.getState().setLegStatus(first.groupId, first.legA, {
      localStatus: 'melting',
    });

    const untouched = useSwapTransactionsStore.getState().getGroup(second.groupId)!;
    expect(untouched.legs.every((l) => l.localStatus === undefined)).toBe(true);
  });
});

describe('swap group moves', () => {
  const stateOf = (groupId: string) => useSwapTransactionsStore.getState().getGroup(groupId)!.state;

  it('ends a running group once: finished and cancelled never replace each other', () => {
    const { groupId } = freshGroup();
    const store = useSwapTransactionsStore.getState();

    store.finalizeGroup(groupId, 'cancelled');
    store.finalizeGroup(groupId, 'finished');

    expect(stateOf(groupId)).toBe('cancelled');
  });

  it('reopens an ended group for a retry, which then ends it again', () => {
    const { groupId } = freshGroup();
    const store = useSwapTransactionsStore.getState();
    store.finalizeGroup(groupId, 'cancelled');

    store.reopenGroup(groupId);
    expect(stateOf(groupId)).toBe('running');
    store.finalizeGroup(groupId, 'finished');

    expect(stateOf(groupId)).toBe('finished');
  });

  it('leaves a running group running when asked to reopen it, and ignores a missing group', () => {
    const { groupId } = freshGroup();
    const before = useSwapTransactionsStore.getState().groups;

    useSwapTransactionsStore.getState().reopenGroup(groupId);
    useSwapTransactionsStore.getState().finalizeGroup('missing-group', 'finished');

    expect(useSwapTransactionsStore.getState().groups).toBe(before);
  });
});
