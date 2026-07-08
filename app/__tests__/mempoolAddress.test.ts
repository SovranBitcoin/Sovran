import { summarizeMempoolAddress, type MempoolAddressStats } from 'wallet';
import {
  getCachedMempoolAddressStats,
  useMempoolAddressCache,
} from '@/shared/stores/global/mempoolAddressCache';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => {}),
  removeItem: jest.fn(async () => {}),
}));

const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';

function stats(overrides: Partial<MempoolAddressStats> = {}): MempoolAddressStats {
  return {
    address: ADDRESS,
    chain_stats: {
      tx_count: 2,
      funded_txo_count: 2,
      funded_txo_sum: 5_000,
      spent_txo_count: 1,
      spent_txo_sum: 1_000,
    },
    mempool_stats: {
      tx_count: 1,
      funded_txo_count: 1,
      funded_txo_sum: 2_000,
      spent_txo_count: 1,
      spent_txo_sum: 500,
    },
    ...overrides,
  };
}

describe('mempool address summaries', () => {
  beforeEach(() => {
    useMempoolAddressCache.getState().clear();
  });

  it('summarizes confirmed and unconfirmed address stats for history UI', () => {
    const summary = summarizeMempoolAddress(stats());

    expect(summary).toMatchObject({
      address: ADDRESS,
      confirmedTxCount: 2,
      confirmedReceivedSats: 5_000,
      confirmedBalanceSats: 4_000,
      confirmedFundingConfirmations: null,
      unconfirmedTxCount: 1,
      unconfirmedReceivedSats: 2_000,
      unconfirmedNetSats: 1_500,
      totalReceivedSats: 7_000,
      explorerUrl: `https://mempool.space/address/${ADDRESS}`,
    });
  });

  it('summarizes funding transaction confirmations when tx details were enriched', () => {
    const summary = summarizeMempoolAddress(
      stats({
        fundingTxs: [
          { txid: 'a', valueSats: 3_000, confirmations: 6 },
          { txid: 'b', valueSats: 2_000, confirmations: 2 },
        ],
      })
    );

    expect(summary.confirmedFundingConfirmations).toBe(2);
    // Deep-links to the tx whose depth we report (the least-confirmed one).
    expect(summary.transactionExplorerUrl).toBe('https://mempool.space/tx/b');
  });

  it('has no transaction explorer link until a confirmed funding tx is known', () => {
    expect(summarizeMempoolAddress(stats()).transactionExplorerUrl).toBeNull();
  });

  it('carries funding-tx confirmations forward when a later poll drops enrichment', () => {
    const cache = useMempoolAddressCache.getState();
    // First poll enriched: 2/2 confirmations observed.
    cache.setAddressStats(
      ADDRESS,
      stats({ fundingTxs: [{ txid: 'a', valueSats: 5_000, confirmations: 2 }] })
    );
    // Later poll's /txs enrichment failed → base stats only, no fundingTxs.
    cache.setAddressStats(ADDRESS, stats());

    const retained = useMempoolAddressCache.getState().byAddress[ADDRESS]?.stats;
    // The confirmation count must NOT regress to "unknown" (which would flap the
    // onchain timeline from "2/2 confirmations" back to a pulsing segment).
    expect(retained?.fundingTxs).toEqual([{ txid: 'a', valueSats: 5_000, confirmations: 2 }]);
    expect(summarizeMempoolAddress(retained!).confirmedFundingConfirmations).toBe(2);
  });

  it('does not resurrect funding once the address reads unfunded', () => {
    const cache = useMempoolAddressCache.getState();
    cache.setAddressStats(
      ADDRESS,
      stats({ fundingTxs: [{ txid: 'a', valueSats: 5_000, confirmations: 2 }] })
    );
    // Address now reports no confirmed txs — don't carry stale funding forward.
    cache.setAddressStats(
      ADDRESS,
      stats({
        chain_stats: {
          tx_count: 0,
          funded_txo_count: 0,
          funded_txo_sum: 0,
          spent_txo_count: 0,
          spent_txo_sum: 0,
        },
      })
    );

    const retained = useMempoolAddressCache.getState().byAddress[ADDRESS]?.stats;
    expect(retained?.fundingTxs).toBeUndefined();
  });

  it('returns a fresh cached value without refetching', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(10_000);
    const cached = stats();
    useMempoolAddressCache.getState().setAddressStats(ADDRESS, cached);
    const fetcher = jest.fn(async () => stats({ address: 'unused' }));

    const result = await getCachedMempoolAddressStats(fetcher, ADDRESS);

    expect(result).toEqual(cached);
    expect(fetcher).not.toHaveBeenCalled();
    now.mockRestore();
  });

  it('treats malformed rehydrated stats as a cache miss', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(10_000);
    useMempoolAddressCache.setState({
      byAddress: {
        [ADDRESS]: {
          stats: { address: ADDRESS } as unknown as MempoolAddressStats,
          fetchedAt: 10_000,
        },
      },
    });
    const fetched = stats();
    const fetcher = jest.fn(async () => fetched);

    await expect(getCachedMempoolAddressStats(fetcher, ADDRESS)).resolves.toBe(fetched);
    expect(fetcher).toHaveBeenCalledTimes(1);
    now.mockRestore();
  });

  it('dedupes concurrent cache misses for the same address', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(10_000);
    const fetched = stats();
    let resolveFetch: (value: MempoolAddressStats) => void = () => {};
    const fetcher = jest.fn(
      () =>
        new Promise<MempoolAddressStats>((resolve) => {
          resolveFetch = resolve;
        })
    );

    const first = getCachedMempoolAddressStats(fetcher, ADDRESS);
    const second = getCachedMempoolAddressStats(fetcher, ADDRESS);
    resolveFetch(fetched);

    await expect(Promise.all([first, second])).resolves.toEqual([fetched, fetched]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(useMempoolAddressCache.getState().byAddress[ADDRESS]?.stats).toBe(fetched);
    now.mockRestore();
  });
});
