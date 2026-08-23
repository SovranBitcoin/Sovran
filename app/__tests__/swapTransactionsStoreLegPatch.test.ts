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

    useSwapTransactionsStore.getState().tagMintQuote(groupId, legA, 'quote-mint');

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

    useSwapTransactionsStore.getState().tagMintQuote('missing-group', legA, 'orphan-quote');
    useSwapTransactionsStore
      .getState()
      .tagMelt('missing-group', legA, { quoteId: 'orphan-melt', operationId: 'op-1' });

    const { quoteIdToGroup } = useSwapTransactionsStore.getState();
    expect(quoteIdToGroup['orphan-quote']).toBeUndefined();
    expect(quoteIdToGroup['orphan-melt']).toBeUndefined();
  });

  it('ignores an empty quote id entirely', () => {
    const { groupId, legA } = freshGroup();

    useSwapTransactionsStore.getState().tagMintQuote(groupId, legA, '');

    const state = useSwapTransactionsStore.getState();
    expect(state.getGroup(groupId)!.legs.find((l) => l.id === legA)!.mintQuoteId).toBeUndefined();
    expect(Object.keys(state.quoteIdToGroup)).toHaveLength(0);
  });

  it('keeps an existing error message while failed and clears it on recovery', () => {
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

    useSwapTransactionsStore.getState().setLegStatus(groupId, legA, { localStatus: 'done' });
    expect(legOf().errorMessage).toBeUndefined();
    expect(legOf().localStatus).toBe('done');
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
