import type { HistoryEntry } from '@cashu/coco-core';

import { filterScopedHistory, scopeHistory } from '@/features/transactions/components/Transactions';

// The rows pull in native glass text; the list's filtering does not need them.
jest.mock('@/features/transactions/components/Transaction', () => ({ Transaction: () => null }));
jest.mock('@/features/transactions/components/SwapTransactionRow', () => ({
  SwapTransactionRow: () => null,
}));

const MINT_A = 'https://mint-a.example';
const MINT_B = 'https://mint-b.example';
const TEST_MINT = 'https://testnut.example';

const entry = (id: string, over: Record<string, unknown>): HistoryEntry =>
  ({
    id,
    createdAt: 1,
    amount: 1,
    unit: 'sat',
    mintUrl: MINT_A,
    type: 'send',
    state: 'finalized',
    ...over,
  }) as unknown as HistoryEntry;

const HISTORY: HistoryEntry[] = [
  entry('send-a', { type: 'send' }),
  entry('receive-b', { type: 'receive', mintUrl: MINT_B }),
  entry('usd-send', { type: 'send', unit: 'usd' }),
  entry('melt-unpaid', { type: 'melt', state: 'UNPAID' }),
  entry('test-receive', { type: 'receive', mintUrl: TEST_MINT }),
  entry('melt-paid', { type: 'melt', state: 'PAID', mintUrl: MINT_B }),
  entry('receive-a', { type: 'receive' }),
];

const isTestnutMint = (mintUrl: string) => mintUrl === TEST_MINT;
const ids = (entries: HistoryEntry[]) => entries.map((e) => e.id);

const ALL_ROWS = {
  filter: 'all',
  type: 'all',
  source: 'all',
  lock: 'all',
  counterparty: 'all',
  zap: 'all',
  hideExpired: false,
  groupedRowsShown: true,
} as const;

describe('scopeHistory', () => {
  it('keeps every entry, in order, for the all-units account', () => {
    const scoped = scopeHistory(HISTORY, {
      accountUnit: 'all',
      isTestnutMint,
      mintUrlFilter: 'all',
    });
    expect(ids(scoped)).toEqual(ids(HISTORY));
  });

  it('keeps only the account unit, and leaves test-mint entries to the test account', () => {
    const scoped = scopeHistory(HISTORY, {
      accountUnit: 'sat',
      isTestnutMint,
      mintUrlFilter: 'all',
    });
    expect(ids(scoped)).toEqual(['send-a', 'receive-b', 'melt-unpaid', 'melt-paid', 'receive-a']);
  });

  it('narrows to one mint without reordering', () => {
    const scoped = scopeHistory(HISTORY, {
      accountUnit: 'sat',
      isTestnutMint,
      mintUrlFilter: MINT_B,
    });
    expect(ids(scoped)).toEqual(['receive-b', 'melt-paid']);
  });
});

describe('filterScopedHistory', () => {
  const scoped = scopeHistory(HISTORY, { accountUnit: 'sat', isTestnutMint, mintUrlFilter: 'all' });

  it('passes the whole scope through when no filter is set', () => {
    expect(ids(filterScopedHistory(scoped, ALL_ROWS))).toEqual(ids(scoped));
  });

  it('filters by direction, keeping order', () => {
    expect(ids(filterScopedHistory(scoped, { ...ALL_ROWS, filter: 'incoming' }))).toEqual([
      'receive-b',
      'receive-a',
    ]);
    expect(ids(filterScopedHistory(scoped, { ...ALL_ROWS, filter: 'outgoing' }))).toEqual([
      'send-a',
      'melt-unpaid',
      'melt-paid',
    ]);
  });

  it('filters by payment type', () => {
    expect(ids(filterScopedHistory(scoped, { ...ALL_ROWS, type: 'ecash' }))).toEqual([
      'send-a',
      'receive-b',
      'receive-a',
    ]);
  });

  it('drops unpaid melts only when expired entries are hidden', () => {
    expect(ids(filterScopedHistory(scoped, { ...ALL_ROWS, hideExpired: true }))).toEqual([
      'send-a',
      'receive-b',
      'melt-paid',
      'receive-a',
    ]);
  });

  it('drops entries without the annotation an annotation filter asks for', () => {
    expect(filterScopedHistory(scoped, { ...ALL_ROWS, counterparty: 'with' })).toEqual([]);
    expect(filterScopedHistory(scoped, { ...ALL_ROWS, zap: 'zaps' })).toEqual([]);
  });
});
