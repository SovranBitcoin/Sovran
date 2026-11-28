/**
 * @jest-environment node
 */

import { act, renderHook } from '@testing-library/react-native';

import { fetchMempoolAddressStats, type MempoolAddressStats } from 'wallet';

import { useMempoolAddressSummary } from '@/shared/hooks/useMempoolAddressSummary';
import { useMempoolAddressCache } from '@/shared/stores/global/mempoolAddressCache';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => {}),
  removeItem: jest.fn(async () => {}),
}));

jest.mock('wallet', () => ({
  ...jest.requireActual('wallet'),
  fetchMempoolAddressStats: jest.fn(),
}));

const fetchStats = jest.mocked(fetchMempoolAddressStats);
const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';
const POLL_MS = 70_000;

function stats(): MempoolAddressStats {
  const empty = {
    tx_count: 0,
    funded_txo_count: 0,
    funded_txo_sum: 0,
    spent_txo_count: 0,
    spent_txo_sum: 0,
  };
  return { address: ADDRESS, chain_stats: empty, mempool_stats: empty };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useMempoolAddressSummary', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    useMempoolAddressCache.getState().clear();
    fetchStats.mockResolvedValue(stats());
    jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('reads the address on mount, then every 70 seconds until unmounted', async () => {
    const { result, unmount } = renderHook(() => useMempoolAddressSummary(ADDRESS));
    await flush();
    expect(fetchStats).toHaveBeenCalledTimes(1);
    expect(result.current.summary).toMatchObject({ address: ADDRESS, totalReceivedSats: 0 });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(fetchStats).toHaveBeenCalledTimes(2);

    unmount();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(POLL_MS * 3);
    });
    expect(fetchStats).toHaveBeenCalledTimes(2);
  });

  it('reads nothing without an address', async () => {
    renderHook(() => useMempoolAddressSummary(null));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(POLL_MS * 3);
    });
    expect(fetchStats).not.toHaveBeenCalled();
  });
});
