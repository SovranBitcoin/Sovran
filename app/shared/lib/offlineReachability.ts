import type { NetworkState } from 'expo-network';

import { backendConfig } from '@/shared/config/backend';
import { hasFeature } from '@/shared/config/features';
import { getOwnWriteRelays } from '@/shared/lib/nostr/outbox/relayListStore';
import { useMintStore } from '@/shared/stores/profile/mintStore';

const REACHABILITY_TIMEOUT_MS = 1500;
/**
 * How many of the account's relays are asked. The verdict needs one answer;
 * three leaves room for two of them being down without asking the whole list
 * every minute.
 */
const MAX_RELAY_PROBES = 3;

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

type ReachabilityProbeAttempt = {
  name: string;
  host: string;
  ok: boolean;
  status?: number;
  durationMs: number;
  error?: string;
};

export type OfflineReachabilityResult = {
  isOffline: boolean;
  reason: 'network-disconnected' | 'probe-reachable' | 'probe-unreachable';
  /** The attempts that had finished when the verdict was reached. */
  probes: ReachabilityProbeAttempt[];
  /** The name of the target whose answer made the verdict "online". */
  answeredBy?: string;
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type ResolveOfflineOptions = {
  fetcher?: FetchLike;
  probes?: readonly ReachabilityProbe[];
  now?: () => number;
};

/** Any answer over TLS proves a path to the internet, whatever the server thinks of the request. */
const answered = () => true;

/**
 * `url` as an HTTPS address when it uses `scheme`, else `null`. Plain string
 * work on purpose: React Native's own `URL` cannot have its protocol changed.
 */
function toHttpsUrl(url: string, scheme: 'wss' | 'https'): string | null {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^\s/?#]+[^\s]*)$/i.exec(url.trim());
  if (!match || match[1].toLowerCase() !== scheme) return null;
  return `https://${match[2]}`;
}

/**
 * The independent targets asked whether the phone is online. One answer from
 * any of them is enough, so no single server being down can put the wallet
 * into offline mode (which creates sends without the mint and parks receives).
 *
 * - The Sovran server's liveness route, as before.
 * - Up to three of the account's own relays (or the default set), asked for
 *   their relay information document over HTTPS. Only in builds that ship
 *   Nostr (ADR 0021): a build without it never contacts a relay.
 * - The selected mint's info route, read-only. Every edition has a mint, so
 *   this is the second witness when Nostr is left out.
 *
 * Targets that are not TLS are skipped: a captive portal can answer plain
 * HTTP for any host.
 */
export function defaultReachabilityProbes(): ReachabilityProbe[] {
  const probes: ReachabilityProbe[] = [
    {
      name: 'nagg',
      url: `${backendConfig.nostrAppViewBaseUrl}/livez`,
      method: 'GET',
      timeoutMs: REACHABILITY_TIMEOUT_MS,
      test: (response) => response.ok,
    },
  ];

  if (hasFeature('nostr')) {
    const relayUrls = getOwnWriteRelays()
      .map((url) => toHttpsUrl(url, 'wss'))
      .filter((url): url is string => url !== null)
      .slice(0, MAX_RELAY_PROBES);
    for (const url of relayUrls) {
      probes.push({
        name: 'relay',
        url,
        method: 'GET',
        headers: { Accept: 'application/nostr+json' },
        timeoutMs: REACHABILITY_TIMEOUT_MS,
        test: answered,
      });
    }
  }

  const mintUrl = useMintStore.getState().selectedMint;
  const mintInfoUrl = mintUrl ? toHttpsUrl(mintUrl, 'https') : null;
  if (mintInfoUrl) {
    probes.push({
      name: 'mint',
      url: `${mintInfoUrl.replace(/\/+$/, '')}/v1/info`,
      method: 'GET',
      timeoutMs: REACHABILITY_TIMEOUT_MS,
      test: answered,
    });
  }

  return probes;
}

/**
 * Asks every target at once. The first one to answer makes the verdict
 * "online" and the rest are cancelled; the verdict is "offline" only when
 * every target has failed or run out of time. Each target has the same time
 * limit, so the verdict takes no longer than a single probe did.
 */
export async function resolveOfflineReachability(
  state: NetworkStateForReachability,
  options: ResolveOfflineOptions = {}
): Promise<OfflineReachabilityResult> {
  if (state.isConnected === false) {
    return { isOffline: true, reason: 'network-disconnected', probes: [] };
  }

  // A transport handoff can transiently report unreachable. SDK 56 Android
  // checks VALIDATED/INTERNET capabilities, while iOS reports connection
  // presence; keep the bounded probe and provider hysteresis on both platforms.

  const probes = options.probes ?? defaultReachabilityProbes();
  if (probes.length === 0) {
    return { isOffline: true, reason: 'probe-unreachable', probes: [] };
  }

  return new Promise<OfflineReachabilityResult>((resolve) => {
    const attempts: ReachabilityProbeAttempt[] = [];
    const cancels: (() => void)[] = [];
    let decided = false;

    for (const probe of probes) {
      const running = runProbe(probe, options);
      cancels.push(running.cancel);
      void running.attempt.then((attempt) => {
        // An answer after the verdict changes nothing: the result handed back
        // is already final, and the next check starts from scratch.
        if (decided) return;
        attempts.push(attempt);
        if (attempt.ok) {
          decided = true;
          for (const cancel of cancels) cancel();
          resolve({
            isOffline: false,
            reason: 'probe-reachable',
            probes: [...attempts],
            answeredBy: attempt.name,
          });
        } else if (attempts.length === probes.length) {
          decided = true;
          resolve({ isOffline: true, reason: 'probe-unreachable', probes: [...attempts] });
        }
      });
    }
  });
}

function runProbe(
  probe: ReachabilityProbe,
  options: ResolveOfflineOptions
): { attempt: Promise<ReachabilityProbeAttempt>; cancel: () => void } {
  // Reachability probes bypass apiClient so offline detection measures the network path itself.
  // eslint-disable-next-line no-restricted-properties
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? Date.now;
  const startedAt = now();
  const controller = new AbortController();
  const host = getHost(probe.url);
  const failed = (error: string): ReachabilityProbeAttempt => ({
    name: probe.name,
    host,
    ok: false,
    durationMs: Math.max(0, now() - startedAt),
    error,
  });

  const attempt = new Promise<ReachabilityProbeAttempt>((resolve) => {
    // The limit decides by itself, so a request that ignores its cancellation
    // cannot answer late.
    const timeout = setTimeout(() => {
      resolve(failed('timeout'));
      controller.abort();
    }, probe.timeoutMs ?? REACHABILITY_TIMEOUT_MS);

    Promise.resolve()
      .then(() =>
        fetcher(probe.url, {
          cache: 'no-store',
          method: probe.method,
          headers: withNoCacheHeader(probe.headers),
          body: probe.body,
          signal: controller.signal,
        })
      )
      .then(
        (response) =>
          resolve({
            name: probe.name,
            host,
            ok: probe.test?.(response) ?? response.ok,
            status: response.status,
            durationMs: Math.max(0, now() - startedAt),
          }),
        (error: unknown) => resolve(failed(describeProbeError(error)))
      )
      .finally(() => clearTimeout(timeout));
  });

  return { attempt, cancel: () => controller.abort() };
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
