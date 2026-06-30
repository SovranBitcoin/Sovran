/* eslint-disable import/first */

jest.mock('@sovranbitcoin/colada', () => ({
  meltOperationToScreenActionEntry: jest.fn(),
  mergeEntryUpdate: (
    current: Record<string, unknown> | null,
    updated: Record<string, unknown>
  ) => ({
    ...(current ?? {}),
    ...updated,
  }),
  shouldApplyEntryUpdate: (
    current: Record<string, unknown> | null,
    updated: Record<string, unknown>
  ) => current?.type === updated.type && current?.quoteId === updated.quoteId,
}));

jest.mock('@/shared/lib/logger', () => {
  const noop = () => {};
  const stub = {
    info: noop,
    debug: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    trace: noop,
    child: () => stub,
  };
  return {
    paymentLog: stub,
    storeLog: stub,
    log: stub,
    redactError: (err: unknown) => err,
  };
});

jest.mock('@/shared/stores/global/mintMetadataStore', () => ({
  useMintMetadataStore: {
    getState: () => ({ getCached: () => undefined }),
    subscribe: jest.fn(() => () => {}),
  },
  getCachedMintInfo: jest.fn(),
}));

jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ language: 'en' }),
    subscribe: jest.fn(() => () => {}),
  },
}));

jest.mock('@/shared/stores/profile/npcMintStore', () => ({
  useNpcMintStore: {
    getState: () => ({ getActiveMintUrl: () => 'https://npc.example' }),
    subscribe: jest.fn(() => () => {}),
  },
}));

jest.mock('@/shared/stores/profile/scanHistoryStore', () => ({
  useScanHistoryStore: {
    getState: () => ({ entries: [] }),
    subscribe: jest.fn(() => () => {}),
  },
}));

jest.mock('@/shared/stores/profile/transactionDistributionStore', () => ({
  useTransactionDistributionStore: {
    getState: () => ({ distributions: {} }),
    subscribe: jest.fn(() => () => {}),
  },
}));

import {
  applyMintItemAddedUpdate,
  shouldApplySovranEntryUpdate,
} from './createSovranScreenActionsBridge';

describe('shouldApplySovranEntryUpdate', () => {
  it('accepts receive-only sentinel updates', () => {
    expect(shouldApplySovranEntryUpdate({ type: 'receive' }, { _npcMintUpdate: true })).toBe(true);
    expect(shouldApplySovranEntryUpdate({ type: 'send' }, { _npcMintUpdate: true })).toBe(false);
    expect(
      shouldApplySovranEntryUpdate({ type: 'receive' }, { _p2pkKeyUpdate: true, p2pkKey: 'pub' })
    ).toBe(true);
  });

  it('accepts mint info and mint selector sentinel updates only for matching entry shapes', () => {
    expect(
      shouldApplySovranEntryUpdate({ mintUrl: 'https://mint.example' }, { _mintEnrichment: true })
    ).toBe(true);
    expect(shouldApplySovranEntryUpdate({ items: [] }, { _mintItemAdded: true })).toBe(true);
    expect(shouldApplySovranEntryUpdate({ type: 'mint' }, { _mintEnrichment: true })).toBe(false);
  });

  it('delegates normal history matching to colada', () => {
    expect(
      shouldApplySovranEntryUpdate(
        { type: 'mint', quoteId: 'quote-1' },
        { type: 'mint', quoteId: 'quote-1', state: 'ISSUED' }
      )
    ).toBe(true);
  });
});

describe('applyMintItemAddedUpdate', () => {
  it('adds a new mint item and disables it when the flow requires a spendable balance', () => {
    const updated = applyMintItemAddedUpdate(
      { destination: 'sendEcash', items: [] },
      {
        mintUrl: 'https://empty.example',
        displayName: 'Empty',
        balance: 0,
        unit: 'sat',
        status: 'available',
        reason: null,
      }
    );

    expect(updated.items).toHaveLength(1);
    expect((updated.items as Record<string, unknown>[])[0]).toMatchObject({
      mintUrl: 'https://empty.example',
      status: 'disabled',
      reason: { code: 'NO_BALANCE', message: 'No balance' },
    });
  });

  it('keeps selected-scope mint rows available even with zero balance', () => {
    const updated = applyMintItemAddedUpdate(
      { destination: 'sendEcash', scope: 'selected', items: [] },
      {
        mintUrl: 'https://selected.example',
        balance: 0,
        status: 'available',
      }
    );

    const item = (updated.items as Record<string, unknown>[])[0];
    expect(item).toMatchObject({
      mintUrl: 'https://selected.example',
      status: 'available',
    });
    expect(item).not.toHaveProperty('reason');
  });

  it('does not duplicate an existing mint row', () => {
    const current = {
      items: [{ mintUrl: 'https://mint.example', balance: 1 }],
    };

    expect(applyMintItemAddedUpdate(current, { mintUrl: 'https://mint.example' })).toBe(current);
  });
});
