/**
 * Testnut verdict store: only a probed nagg row can set or clear a verdict,
 * a failed or skipped check keeps the previous one, the refresh is stale-gated
 * and never throws, and the account-scope helper keeps test and real records
 * apart.
 */
/* eslint-disable import/first */

const mockAsyncStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((k: string) => Promise.resolve(mockAsyncStore.get(k) ?? null)),
  setItem: jest.fn((k: string, v: string) => {
    mockAsyncStore.set(k, v);
    return Promise.resolve();
  }),
  removeItem: jest.fn((k: string) => {
    mockAsyncStore.delete(k);
    return Promise.resolve();
  }),
}));

const mockFetchMintInfos = jest.fn();
jest.mock('@/shared/lib/apiClient', () => ({
  MINT_INFO_MAX_URLS: 50,
  fetchMintInfos: (...args: unknown[]) => mockFetchMintInfos(...args),
}));

import { err, ok } from 'neverthrow';

import { belongsToAccount } from '@/shared/lib/cashu/accountScope';
import { refreshMintTestnutVerdicts } from '@/shared/lib/mintTestnutRefresh';
import { isTestnutMint, useMintTestnutStore } from '@/shared/stores/global/mintTestnutStore';

const REAL = 'https://mint.minibits.cash/Bitcoin';
const TESTNUT = 'https://testnut.cashu.space';

beforeEach(() => {
  mockFetchMintInfos.mockReset();
  useMintTestnutStore.setState({ byMintUrl: {} });
});

describe('applyMintInfos', () => {
  it('records probed verdicts, keyed independent of scheme and trailing slash', () => {
    useMintTestnutStore.getState().applyMintInfos([
      { mintUrl: `${TESTNUT}/`, testnut: true, probedAt: 1_790_000_000 },
      { mintUrl: REAL, testnut: false, probedAt: 1_790_000_000 },
    ]);
    expect(isTestnutMint(TESTNUT)).toBe(true);
    expect(isTestnutMint('HTTPS://testnut.cashu.space')).toBe(true);
    expect(isTestnutMint(REAL)).toBe(false);
  });

  it('does not let an unprobed row clear a standing verdict', () => {
    const store = useMintTestnutStore.getState();
    store.applyMintInfos([{ mintUrl: TESTNUT, testnut: true, probedAt: 1_790_000_000 }]);
    store.applyMintInfos([{ mintUrl: TESTNUT, testnut: false }]);
    expect(isTestnutMint(TESTNUT)).toBe(true);
  });

  it('lets a newer probed verdict clear the flag', () => {
    const store = useMintTestnutStore.getState();
    store.applyMintInfos([{ mintUrl: TESTNUT, testnut: true, probedAt: 1_790_000_000 }]);
    store.applyMintInfos([{ mintUrl: TESTNUT, testnut: false, probedAt: 1_790_600_000 }]);
    expect(isTestnutMint(TESTNUT)).toBe(false);
  });
});

describe('applyDiscover', () => {
  it('learns testnuts but treats a discover false as no verdict', () => {
    const store = useMintTestnutStore.getState();
    store.applyMintInfos([{ mintUrl: TESTNUT, testnut: true, probedAt: 1_790_000_000 }]);
    store.applyDiscover([
      { mintUrl: TESTNUT, testnut: false },
      { mintUrl: 'https://other.testnut.example', testnut: true },
      { mintUrl: REAL },
    ] as never);
    expect(isTestnutMint(TESTNUT)).toBe(true);
    expect(isTestnutMint('https://other.testnut.example')).toBe(true);
    expect(isTestnutMint(REAL)).toBe(false);
  });
});

describe('refreshMintTestnutVerdicts', () => {
  it('asks nagg once for every mint, then stays quiet while verdicts are fresh', async () => {
    mockFetchMintInfos.mockResolvedValue(
      ok([
        { mintUrl: TESTNUT, testnut: true, probedAt: 1_790_000_000 },
        { mintUrl: REAL, testnut: false },
      ])
    );
    await refreshMintTestnutVerdicts([TESTNUT, REAL]);
    expect(mockFetchMintInfos).toHaveBeenCalledTimes(1);
    expect(mockFetchMintInfos.mock.calls[0][0]).toEqual([TESTNUT, REAL]);
    expect(isTestnutMint(TESTNUT)).toBe(true);

    // The unprobed mint was still answered for: no re-ask until it is stale.
    await refreshMintTestnutVerdicts([TESTNUT, REAL]);
    expect(mockFetchMintInfos).toHaveBeenCalledTimes(1);

    // A newly added mint has no entry, so the pass runs again.
    await refreshMintTestnutVerdicts([TESTNUT, REAL, 'https://new.example']);
    expect(mockFetchMintInfos).toHaveBeenCalledTimes(2);
  });

  it('keeps the previous verdict and resolves when nagg is unreachable', async () => {
    useMintTestnutStore
      .getState()
      .applyMintInfos([{ mintUrl: TESTNUT, testnut: true, probedAt: 1_790_000_000 }]);
    mockFetchMintInfos.mockResolvedValue(err(new Error('offline')));
    await expect(refreshMintTestnutVerdicts([TESTNUT, REAL])).resolves.toBeUndefined();
    expect(isTestnutMint(TESTNUT)).toBe(true);
    expect(isTestnutMint(REAL)).toBe(false);
  });
});

describe('belongsToAccount', () => {
  const isTestnut = (mintUrl: string) => mintUrl === TESTNUT;

  it('keeps a testnut mint out of the real account of the same unit', () => {
    expect(belongsToAccount('usd', { unit: 'usd', mintUrl: TESTNUT }, isTestnut)).toBe(false);
    expect(belongsToAccount('tusd', { unit: 'usd', mintUrl: TESTNUT }, isTestnut)).toBe(true);
    expect(belongsToAccount('usd', { unit: 'usd', mintUrl: REAL }, isTestnut)).toBe(true);
    expect(belongsToAccount('tusd', { unit: 'usd', mintUrl: REAL }, isTestnut)).toBe(false);
  });

  it('still matches on the unit, and lets "all" through', () => {
    expect(belongsToAccount('tusd', { unit: 'sat', mintUrl: TESTNUT }, isTestnut)).toBe(false);
    expect(belongsToAccount('sat', { mintUrl: REAL }, isTestnut)).toBe(true);
    expect(belongsToAccount('all', { unit: 'eur', mintUrl: TESTNUT }, isTestnut)).toBe(true);
  });
});
