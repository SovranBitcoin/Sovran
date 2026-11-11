import type { NetworkState } from 'expo-network';

import {
  resolveOfflineReachability,
  type ReachabilityProbe,
} from '@/shared/lib/offlineReachability';

jest.mock('@/shared/config/backend', () => ({
  backendConfig: {
    nostrAppViewBaseUrl: 'https://configured-nagg.example',
  },
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
  url: 'https://nagg.up.railway.app/livez',
  method: 'GET',
  test: (response) => response.ok,
};

function response(status: number): Response {
  return new Response(null, { status });
}

describe('offline reachability', () => {
  it('probes configured nagg liveness by default', async () => {
    const fetcher = jest.fn().mockResolvedValue(response(200));
    const result = await resolveOfflineReachability(connectedWifi, { fetcher });
    expect(result.isOffline).toBe(false);
    expect(result.probes).toEqual([expect.objectContaining({ name: 'nagg', ok: true })]);
    expect(fetcher).toHaveBeenCalledWith(
      'https://configured-nagg.example/livez',
      expect.objectContaining({ method: 'GET', body: undefined })
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
    // A native connectivity event during a transport handoff can temporarily
    // report unreachable. The probe must decide before hysteresis commits it.
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
        method: 'GET',
        body: undefined,
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
  it('with the default list, the Sovran server answering 404 means offline', async () => {
    const fetcher = jest.fn(async (url: RequestInfo | URL) =>
      response(String(url).startsWith('https://configured-nagg.example') ? 404 : 200)
    );

    const result = await resolveOfflineReachability(connectedWifi, { fetcher });

    expect(result).toMatchObject({ isOffline: true, reason: 'probe-unreachable' });
    expect(result.probes).toEqual([
      expect.objectContaining({ name: 'nagg', host: 'configured-nagg.example', status: 404 }),
    ]);
  });

  it('is online when any probe of several answers, and names the one that did', async () => {
    const fetcher = jest.fn(async (url: RequestInfo | URL) => {
      if (String(url) === primaryProbe.url) throw new Error('Network request failed');
      return response(200);
    });

    const result = await resolveOfflineReachability(connectedWifi, {
      fetcher,
      probes: [primaryProbe, { name: 'second', url: 'https://second.example/health' }],
    });

    expect(result).toMatchObject({ isOffline: false, reason: 'probe-reachable' });
    expect(result.probes.filter((probe) => probe.ok)).toEqual([
      expect.objectContaining({ name: 'second', host: 'second.example', status: 200 }),
    ]);
  });

  it('is offline only when every probe of several fails, and reports each attempt', async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error('Network request failed'));

    const result = await resolveOfflineReachability(connectedWifi, {
      fetcher,
      probes: [primaryProbe, { name: 'second', url: 'https://second.example/health' }],
    });

    expect(result).toMatchObject({ isOffline: true, reason: 'probe-unreachable' });
    expect(result.probes.map((probe) => probe.name).sort()).toEqual(['primary', 'second']);
    expect(result.probes.every((probe) => !probe.ok)).toBe(true);
  });

  it('does not let an answer that arrives after the time limit change an offline verdict', async () => {
    jest.useFakeTimers();
    try {
      const timeoutError = Object.assign(new Error('Aborted'), { name: 'AbortError' });
      const aborted: string[] = [];
      // Each target would answer after two seconds; the limit is 1.5 seconds.
      const fetcher = jest.fn(
        (url: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            const late = setTimeout(() => resolve(response(200)), 2000);
            init?.signal?.addEventListener('abort', () => {
              clearTimeout(late);
              aborted.push(String(url));
              reject(timeoutError);
            });
          })
      );

      const pending = resolveOfflineReachability(connectedWifi, {
        fetcher,
        probes: [primaryProbe, { name: 'second', url: 'https://second.example/health' }],
      });
      await jest.advanceTimersByTimeAsync(5000);
      const result = await pending;
      const snapshot = JSON.stringify(result);
      await jest.advanceTimersByTimeAsync(5000);

      expect(result).toMatchObject({ isOffline: true, reason: 'probe-unreachable' });
      expect(result.probes.every((probe) => probe.error === 'timeout')).toBe(true);
      expect(aborted.sort()).toEqual([primaryProbe.url, 'https://second.example/health'].sort());
      expect(JSON.stringify(result)).toBe(snapshot);
    } finally {
      jest.useRealTimers();
    }
  });
});
