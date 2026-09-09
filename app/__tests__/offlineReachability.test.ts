import type { NetworkState } from 'expo-network';

import {
  resolveOfflineReachability,
  type ReachabilityProbe,
} from '@/shared/lib/offlineReachability';

jest.mock('@/shared/config/backend', () => ({
  backendConfig: { scoreApiBaseUrl: 'https://configured-nagg.example' },
}));

const connectedWifi: NetworkState = {
  isConnected: true,
  isInternetReachable: true,
  type: 'WIFI' as NetworkState['type'],
};

const disconnected: NetworkState = {
  isConnected: false,
  isInternetReachable: false,
  type: 'NONE' as NetworkState['type'],
};

const primaryProbe: ReachabilityProbe = {
  name: 'primary',
  url: 'https://api.sovran.money/api/app/latest-version',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ storage: { version: '0.0.0' } }),
  test: (response) => response.ok,
};

function response(status: number): Response {
  return new Response(null, { status });
}

describe('offline reachability', () => {
  it('probes the configured latest-version backend by default', async () => {
    const fetcher = jest.fn().mockResolvedValue(response(200));
    const result = await resolveOfflineReachability(connectedWifi, { fetcher });
    expect(result.isOffline).toBe(false);
    expect(fetcher).toHaveBeenCalledWith(
      'https://configured-nagg.example/app/latest-version',
      expect.objectContaining({ method: 'POST', body: '{"storage":{"version":"0.0.0"}}' })
    );
  });

  it('treats airplane/no active network as offline without probing', async () => {
    const fetcher = jest.fn();

    const result = await resolveOfflineReachability(disconnected, { fetcher });

    expect(result).toMatchObject({ isOffline: true, reason: 'network-disconnected' });
    expect(result.probes).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('probes instead of trusting a transient isInternetReachable=false (Android transport flap)', async () => {
    // Android's expo-network derives isInternetReachable from activeNetwork
    // presence with no validation — it flips false on every Wi-Fi<->cell/VPN
    // handoff while the device is genuinely online. The probe must decide.
    const fetcher = jest.fn().mockResolvedValue(response(200));

    const result = await resolveOfflineReachability(
      { isConnected: true, isInternetReachable: false, type: 'WIFI' as NetworkState['type'] },
      { fetcher, probes: [primaryProbe] }
    );

    expect(result).toMatchObject({ isOffline: false, reason: 'probe-reachable' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('treats connected-but-unreachable iOS-style Wi-Fi as offline when probes fail', async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error('Network request failed'));

    const result = await resolveOfflineReachability(connectedWifi, {
      fetcher,
      probes: [primaryProbe],
    });

    expect(result).toMatchObject({ isOffline: true, reason: 'probe-unreachable' });
    expect(result.probes).toHaveLength(1);
    expect(result.probes.every((probe) => !probe.ok)).toBe(true);
  });

  it('treats connected Wi-Fi as online when the primary probe succeeds', async () => {
    const fetcher = jest.fn().mockResolvedValue(response(200));

    const result = await resolveOfflineReachability(connectedWifi, {
      fetcher,
      probes: [primaryProbe],
    });

    expect(result).toMatchObject({ isOffline: false, reason: 'probe-reachable' });
    expect(result.probes).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      primaryProbe.url,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ storage: { version: '0.0.0' } }),
      })
    );
  });

  it('treats a failing app-owned probe as offline', async () => {
    const fetcher = jest.fn().mockResolvedValueOnce(response(503));

    const result = await resolveOfflineReachability(connectedWifi, {
      fetcher,
      probes: [primaryProbe],
    });

    expect(result).toMatchObject({ isOffline: true, reason: 'probe-unreachable' });
    expect(result.probes).toHaveLength(1);
    expect(result.probes[0]).toMatchObject({ name: 'primary', ok: false, status: 503 });
  });

  it('treats a probe timeout as offline', async () => {
    const timeoutError = Object.assign(new Error('Aborted'), { name: 'AbortError' });
    const fetcher = jest.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(timeoutError));
        })
    );

    const result = await resolveOfflineReachability(connectedWifi, {
      fetcher,
      probes: [{ ...primaryProbe, timeoutMs: 1 }],
    });

    expect(result).toMatchObject({ isOffline: true, reason: 'probe-unreachable' });
    expect(result.probes[0]).toMatchObject({ ok: false, error: 'timeout' });
  });
});
