import type { NetworkState } from 'expo-network';

import {
  defaultReachabilityProbes,
  resolveOfflineReachability,
  type ReachabilityProbe,
} from '@/shared/lib/offlineReachability';

const mockBuild = { nostr: true };
const mockAccount: { relays: string[]; selectedMint: string | undefined } = {
  relays: [],
  selectedMint: undefined,
};
jest.mock('@/shared/config/features', () => ({
  hasFeature: (feature: string) => feature === 'nostr' && mockBuild.nostr,
}));
jest.mock('@/shared/lib/nostr/outbox/relayListStore', () => ({
  getOwnWriteRelays: () => mockAccount.relays,
}));
jest.mock('@/shared/stores/profile/mintStore', () => ({
  useMintStore: { getState: () => ({ selectedMint: mockAccount.selectedMint }) },
}));

const RELAYS = ['wss://relay-a.example/', 'wss://relay-b.example/'];
const MINT = 'https://mint.example/Bitcoin';
const NAGG = 'https://configured-nagg.example/livez';

/** A fetch that answers per host: a status, or `null` for no network path. */
function fetchByHost(answers: Record<string, number | null>) {
  return jest.fn(async (url: RequestInfo | URL) => {
    const answer = answers[new URL(String(url)).host] ?? null;
    if (answer === null) throw new Error('Network request failed');
    return response(answer);
  });
}

beforeEach(() => {
  mockBuild.nostr = true;
  mockAccount.relays = [];
  mockAccount.selectedMint = undefined;
});

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
  it('is online when the Sovran server answers 404 and a relay answers', async () => {
    mockAccount.relays = RELAYS;
    const fetcher = fetchByHost({ 'configured-nagg.example': 404, 'relay-b.example': 200 });

    const result = await resolveOfflineReachability(connectedWifi, { fetcher });

    expect(result).toMatchObject({
      isOffline: false,
      reason: 'probe-reachable',
      answeredBy: 'relay',
    });
    expect(result.probes.find((probe) => probe.ok)).toMatchObject({
      name: 'relay',
      host: 'relay-b.example',
    });
  });

  it('is online when the Sovran server is down and only the mint answers', async () => {
    mockBuild.nostr = false;
    mockAccount.relays = RELAYS;
    mockAccount.selectedMint = MINT;
    const fetcher = fetchByHost({ 'mint.example': 200 });

    const result = await resolveOfflineReachability(connectedWifi, { fetcher });

    expect(result).toMatchObject({ isOffline: false, answeredBy: 'mint' });
    expect(fetcher.mock.calls.map(([url]) => String(url)).sort()).toEqual([
      NAGG,
      'https://mint.example/Bitcoin/v1/info',
    ]);
  });

  it('counts any answer from a relay or the mint, but only a healthy one from the Sovran server', async () => {
    mockAccount.relays = RELAYS;
    mockAccount.selectedMint = MINT;

    const relayRefuses = await resolveOfflineReachability(connectedWifi, {
      fetcher: fetchByHost({ 'relay-a.example': 400 }),
    });
    expect(relayRefuses).toMatchObject({ isOffline: false, answeredBy: 'relay' });

    const mintBroken = await resolveOfflineReachability(connectedWifi, {
      fetcher: fetchByHost({ 'mint.example': 502 }),
    });
    expect(mintBroken).toMatchObject({ isOffline: false, answeredBy: 'mint' });

    const onlySovranUnhealthy = await resolveOfflineReachability(connectedWifi, {
      fetcher: fetchByHost({ 'configured-nagg.example': 404 }),
    });
    expect(onlySovranUnhealthy).toMatchObject({ isOffline: true, reason: 'probe-unreachable' });
  });

  it('is offline when the Sovran server, every relay and the mint all fail', async () => {
    mockAccount.relays = RELAYS;
    mockAccount.selectedMint = MINT;
    const fetcher = fetchByHost({});

    const result = await resolveOfflineReachability(connectedWifi, { fetcher });

    expect(result).toMatchObject({ isOffline: true, reason: 'probe-unreachable' });
    expect(result.answeredBy).toBeUndefined();
    expect(result.probes.map((probe) => probe.name).sort()).toEqual([
      'mint',
      'nagg',
      'relay',
      'relay',
    ]);
  });

  it('asks every target at once and stops the rest when one answers', async () => {
    mockAccount.relays = RELAYS;
    mockAccount.selectedMint = MINT;
    const aborted: string[] = [];
    const answer: Record<string, (response: Response) => void> = {};
    const fetcher = jest.fn(
      (url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          answer[new URL(String(url)).host] = resolve;
          init?.signal?.addEventListener('abort', () => {
            aborted.push(new URL(String(url)).host);
            reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
          });
        })
    );

    const pending = resolveOfflineReachability(connectedWifi, { fetcher });
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(4);
    answer['relay-a.example'](response(200));
    const result = await pending;

    expect(result).toMatchObject({ isOffline: false, answeredBy: 'relay' });
    expect(aborted).toEqual(
      expect.arrayContaining(['configured-nagg.example', 'mint.example', 'relay-b.example'])
    );
  });

  it('reaches an offline verdict within one time limit however many targets hang', async () => {
    jest.useFakeTimers();
    try {
      mockAccount.relays = RELAYS;
      mockAccount.selectedMint = MINT;
      // Requests that never settle and ignore their cancellation.
      const fetcher = jest.fn(() => new Promise<Response>(() => {}));
      let settled: { isOffline: boolean } | null = null;
      void resolveOfflineReachability(connectedWifi, { fetcher }).then((result) => {
        settled = result;
      });

      await jest.advanceTimersByTimeAsync(1499);
      expect(settled).toBeNull();
      await jest.advanceTimersByTimeAsync(1);
      expect(settled).toMatchObject({ isOffline: true, reason: 'probe-unreachable' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('ignores an answer that ignores its cancellation and arrives after the limit', async () => {
    jest.useFakeTimers();
    try {
      const fetcher = jest.fn(
        () => new Promise<Response>((resolve) => setTimeout(() => resolve(response(200)), 2000))
      );
      const pending = resolveOfflineReachability(connectedWifi, {
        fetcher,
        probes: [primaryProbe],
      });
      await jest.advanceTimersByTimeAsync(1500);
      const result = await pending;
      const snapshot = JSON.stringify(result);
      await jest.advanceTimersByTimeAsync(5000);

      expect(result).toMatchObject({ isOffline: true, reason: 'probe-unreachable' });
      expect(JSON.stringify(result)).toBe(snapshot);
    } finally {
      jest.useRealTimers();
    }
  });

  describe('the targets asked', () => {
    it('are the Sovran server alone before the account has a mint, in a build without Nostr', () => {
      mockBuild.nostr = false;
      mockAccount.relays = RELAYS;
      expect(defaultReachabilityProbes().map((probe) => probe.url)).toEqual([NAGG]);
    });

    it('are the Sovran server, up to three of the account relays over HTTPS, and the selected mint', () => {
      mockAccount.relays = [...RELAYS, 'wss://relay-c.example/', 'wss://relay-d.example/'];
      mockAccount.selectedMint = 'https://mint.example/';
      const probes = defaultReachabilityProbes();
      expect(probes.map((probe) => `${probe.name} ${probe.url}`)).toEqual([
        `nagg ${NAGG}`,
        'relay https://relay-a.example/',
        'relay https://relay-b.example/',
        'relay https://relay-c.example/',
        'mint https://mint.example/v1/info',
      ]);
      expect(new Headers(probes[1].headers).get('Accept')).toBe('application/nostr+json');
    });

    it('never include a target without TLS', () => {
      mockAccount.relays = ['ws://plain-relay.example/', 'not a url', 'wss://relay-a.example/'];
      mockAccount.selectedMint = 'http://plain-mint.example';
      expect(defaultReachabilityProbes().map((probe) => probe.url)).toEqual([
        NAGG,
        'https://relay-a.example/',
      ]);
    });
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
