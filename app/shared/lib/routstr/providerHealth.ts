import { apiLog } from '@/shared/lib/logger';
import type { RequestControls } from 'wallet/safeFetch';

import { fetchNodeStatus, normalizeNodeUrl, type NodeInfo } from './providers';

/**
 * Is a provider answering, and what does it say about itself?
 *
 * The picker needs a per-row liveness mark, and the cheapest truthful one is
 * whether `/v1/info` answers: it is unauthenticated, a few hundred bytes, and
 * it carries the two facts that decide whether a provider is usable at all —
 * its accepted mints and its version.
 *
 * Deliberately NOT `/v1/models`. That is the endpoint that would also answer
 * "does this provider offer end-to-end encrypted models", but it is three
 * quarters of a megabyte per provider and a directory holds forty of them.
 * E2EE is therefore filled in from a catalog the app has already read, never
 * by probing every row on a sheet open.
 */

export type ProviderStatus = 'online' | 'offline' | 'unknown';

export interface ProviderProbe {
  baseUrl: string;
  status: ProviderStatus;
  info: NodeInfo | null;
}

/** How long a probe stands. Short enough that a provider coming back up shows
 *  within a session, long enough that reopening the picker is instant. */
const PROBE_TTL_MS = 2 * 60 * 1000;

/** Directories return dozens of rows. Eight at a time keeps a list responsive
 *  on a phone radio without serialising forty round trips — and the whole
 *  point of the sweep is a verdict the user does not outwait. */
const CONCURRENCY = 8;

/**
 * How long one row of a sweep may hang before it counts as not answering.
 *
 * The transport default is 20 seconds, which is a sane budget for a request
 * whose ANSWER the user is waiting on. Nobody is waiting on this one: it is a
 * liveness mark on a list of forty, and at 20s the last rows were still
 * undecided a minute after the list appeared. A provider that has not said
 * hello in six seconds is not one this phone can chat with, and the row says
 * so now rather than eventually.
 */
const SWEEP_TIMEOUT_MS = 6_000;

const cache = new Map<string, { at: number; probe: ProviderProbe }>();

/** The last answer for this provider, if it is still fresh. */
export function cachedProbe(baseUrl: string): ProviderProbe | undefined {
  const entry = cache.get(normalizeNodeUrl(baseUrl));
  return entry && Date.now() - entry.at <= PROBE_TTL_MS ? entry.probe : undefined;
}

async function probeOne(baseUrl: string, controls: RequestControls = {}): Promise<ProviderProbe> {
  const url = normalizeNodeUrl(baseUrl);
  const result = await fetchNodeStatus(url, controls);
  const probe: ProviderProbe = { baseUrl: url, ...result };
  if (!controls.signal?.aborted) cache.set(url, { at: Date.now(), probe });
  return probe;
}

/**
 * Check one provider, now, because the user just reached for it.
 *
 * The sweep that fills the list is best-effort and wide; this is narrow and
 * on the critical path of a choice, so it takes its own (shorter) budget. A
 * still-fresh answer is reused rather than re-asked — the point is to have
 * checked, not to check twice.
 */
export function probeProvider(
  baseUrl: string,
  controls: RequestControls = {}
): Promise<ProviderProbe> {
  const cached = cachedProbe(baseUrl);
  return cached ? Promise.resolve(cached) : probeOne(baseUrl, controls);
}

/**
 * One provider, two opinions: what nagg cached and what this phone has seen.
 *
 * First-hand evidence wins. nagg probes from a data centre on a schedule, so
 * its `online` can be minutes old, and its `offline` can be a network path
 * that fails for the server and works here. When this device has actually
 * reached a provider — or actually failed to — that observation is the
 * answer, and the server's claim is discarded rather than averaged with it.
 *
 * `unknown` is not evidence in either direction. A local probe that came back
 * `unknown` (an older node that does not serve `/v1/info`, a non-JSON reply)
 * says nothing about reachability, so the server's opinion still stands; and
 * the server's own `unknown` means it has not checked, which never overrides
 * anything. Only when neither side has looked does the row read `unknown` —
 * a real third state, and emphatically not a polite word for offline.
 */
export function resolveProviderStatus(
  local: ProviderStatus | undefined,
  server: ProviderStatus | undefined
): ProviderStatus {
  if (local === 'online' || local === 'offline') return local;
  if (server === 'online' || server === 'offline') return server;
  return 'unknown';
}

/**
 * Probe each provider, reporting results as they land.
 *
 * Results stream through `onResult` rather than resolving as a batch, so the
 * picker can mark rows live while the slow ones are still outstanding. A
 * cached answer is reported immediately and never re-fetched.
 */
export async function probeProviders(
  baseUrls: string[],
  options: {
    onResult: (probe: ProviderProbe) => void;
    signal?: AbortSignal;
    /** Override the per-row budget. Defaults to `SWEEP_TIMEOUT_MS`. */
    timeoutMs?: number;
  }
): Promise<void> {
  const pending: string[] = [];
  for (const baseUrl of baseUrls) {
    if (options.signal?.aborted) return;
    const cached = cachedProbe(baseUrl);
    if (cached) options.onResult(cached);
    else pending.push(baseUrl);
  }
  if (pending.length === 0) return;

  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < pending.length) {
      if (options.signal?.aborted) return;
      const baseUrl = pending[cursor++];
      try {
        const probe = await probeOne(baseUrl, {
          timeoutMs: options.timeoutMs ?? SWEEP_TIMEOUT_MS,
          signal: options.signal,
        });
        if (!options.signal?.aborted) options.onResult(probe);
      } catch {
        // A thrown probe is the same news as a failed one, and the row simply
        // stays unmarked rather than taking the sheet down with it.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));
  apiLog.debug('routstr.providers.probed', { probed: pending.length });
}
