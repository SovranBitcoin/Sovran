import { apiLog } from '@/shared/lib/logger';

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

interface ProviderProbe {
  baseUrl: string;
  status: ProviderStatus;
  info: NodeInfo | null;
}

/** How long a probe stands. Short enough that a provider coming back up shows
 *  within a session, long enough that reopening the picker is instant. */
const PROBE_TTL_MS = 2 * 60 * 1000;

/** Directories return dozens of rows. Four at a time keeps a sheet open on a
 *  phone radio responsive without serialising forty round trips. */
const CONCURRENCY = 4;

const cache = new Map<string, { at: number; probe: ProviderProbe }>();

/** The last answer for this provider, if it is still fresh. */
export function cachedProbe(baseUrl: string): ProviderProbe | undefined {
  const entry = cache.get(normalizeNodeUrl(baseUrl));
  return entry && Date.now() - entry.at <= PROBE_TTL_MS ? entry.probe : undefined;
}

async function probeOne(baseUrl: string, signal?: AbortSignal): Promise<ProviderProbe> {
  const url = normalizeNodeUrl(baseUrl);
  const result = await fetchNodeStatus(url, { signal });
  const probe: ProviderProbe = { baseUrl: url, ...result };
  if (!signal?.aborted) cache.set(url, { at: Date.now(), probe });
  return probe;
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
  options: { onResult: (probe: ProviderProbe) => void; signal?: AbortSignal }
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
        const probe = await probeOne(baseUrl, options.signal);
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
