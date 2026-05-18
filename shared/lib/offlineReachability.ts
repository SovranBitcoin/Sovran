import type { NetworkState } from 'expo-network';

const REACHABILITY_PRIMARY_URL = 'https://api.sovran.money/api/app/latest-version';
const REACHABILITY_TIMEOUT_MS = 1500;

type NetworkStateForReachability = Pick<
  NetworkState,
  'isConnected' | 'isInternetReachable' | 'type'
>;

export type ReachabilityProbe = {
  url: string;
  name: string;
  method?: string;
  headers?: HeadersInit;
  body?: RequestInit['body'];
  timeoutMs?: number;
  test?: (response: Response) => boolean;
};

export type ReachabilityProbeAttempt = {
  name: string;
  host: string;
  ok: boolean;
  status?: number;
  durationMs: number;
  error?: string;
};

export type OfflineReachabilityResult = {
  isOffline: boolean;
  reason: 'network-disconnected' | 'network-unreachable' | 'probe-reachable' | 'probe-unreachable';
  probes: ReachabilityProbeAttempt[];
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type ResolveOfflineOptions = {
  fetcher?: FetchLike;
  probes?: readonly ReachabilityProbe[];
  now?: () => number;
};

const DEFAULT_REACHABILITY_PROBES: readonly ReachabilityProbe[] = [
  {
    name: 'sovran-api',
    url: REACHABILITY_PRIMARY_URL,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ storage: { version: '0.0.0' } }),
    test: (response) => response.ok,
  },
];

export async function resolveOfflineReachability(
  state: NetworkStateForReachability,
  options: ResolveOfflineOptions = {}
): Promise<OfflineReachabilityResult> {
  if (state.isConnected === false) {
    return { isOffline: true, reason: 'network-disconnected', probes: [] };
  }

  if (state.isInternetReachable === false) {
    return { isOffline: true, reason: 'network-unreachable', probes: [] };
  }

  const probes = options.probes ?? DEFAULT_REACHABILITY_PROBES;
  const attempts: ReachabilityProbeAttempt[] = [];

  for (const probe of probes) {
    const attempt = await runProbe(probe, options);
    attempts.push(attempt);

    if (attempt.ok) {
      return { isOffline: false, reason: 'probe-reachable', probes: attempts };
    }
  }

  return { isOffline: true, reason: 'probe-unreachable', probes: attempts };
}

async function runProbe(
  probe: ReachabilityProbe,
  options: ResolveOfflineOptions
): Promise<ReachabilityProbeAttempt> {
  // Reachability probes bypass apiClient so offline detection measures the network path itself.
  // eslint-disable-next-line no-restricted-properties
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? Date.now;
  const startedAt = now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), probe.timeoutMs ?? REACHABILITY_TIMEOUT_MS);

  try {
    const response = await fetcher(probe.url, {
      cache: 'no-store',
      method: probe.method,
      headers: withNoCacheHeader(probe.headers),
      body: probe.body,
      signal: controller.signal,
    });
    return {
      name: probe.name,
      host: getHost(probe.url),
      ok: probe.test?.(response) ?? response.ok,
      status: response.status,
      durationMs: Math.max(0, now() - startedAt),
    };
  } catch (error) {
    return {
      name: probe.name,
      host: getHost(probe.url),
      ok: false,
      durationMs: Math.max(0, now() - startedAt),
      error: describeProbeError(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function withNoCacheHeader(headers: HeadersInit | undefined): Headers {
  const merged = new Headers(headers);
  if (!merged.has('Cache-Control')) {
    merged.set('Cache-Control', 'no-cache');
  }
  return merged;
}

function getHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'invalid';
  }
}

function describeProbeError(error: unknown): string {
  if (error instanceof Error) {
    return error.name === 'AbortError' ? 'timeout' : error.message;
  }
  return String(error);
}
