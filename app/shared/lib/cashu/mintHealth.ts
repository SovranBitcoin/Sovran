import { fetchMintInfo, ApiHttpError, ApiParseError } from '@/shared/lib/apiClient';
import { cashuLog } from '@/shared/lib/logger';
import { normalizeMintUrlKey } from '@/shared/lib/url';
import { useMintMetadataStore } from '@/shared/stores/global/mintMetadataStore';
import type { RequestControls } from 'wallet/safeFetch';

/**
 * Is a mint answering?
 *
 * The same liveness mark the AI provider list draws on each face, for mints:
 * a small green or red dot on the mint's icon in the selector and on the
 * discovery list, fed by whether `/v1/info` answers. It is feedback while
 * scrolling, not a gate — sending ecash to a mint that is down can still be
 * the right thing to do (a token is redeemed later), so nothing here disables
 * a row or changes the order the rows appear in. That is the one deliberate
 * difference from `providerHealth.ts`, whose `offline` blocks a choice.
 *
 * Mirrors `providerHealth.ts` otherwise: an answer that stands for two
 * minutes (kept in the mint metadata store, so it survives a relaunch), a bounded sweep that streams results as they land, and a merge
 * rule where this phone's own observation beats what nagg saw from a data
 * centre.
 */

export type MintStatus = 'online' | 'offline' | 'unknown';

export interface MintProbe {
  /** The normalized mint key (`normalizeMintUrlKey`), which is how rows look it up. */
  key: string;
  status: MintStatus;
}

/** How long a probe stands: a mint coming back shows within a session, and
 *  reopening the selector is instant. */
const PROBE_TTL_MS = 2 * 60 * 1000;

/** The discovery list can hold two hundred mints; eight at a time keeps a
 *  phone radio responsive while still finishing a screenful in a few seconds. */
const CONCURRENCY = 8;

/** A mint that has not said hello in six seconds is marked as not answering
 *  now, rather than the row staying undecided for the transport's 15s. */
const SWEEP_TIMEOUT_MS = 6_000;

/**
 * The last verdict for this mint, if it is still fresh. The store is the
 * cache: a verdict survives a relaunch, and nagg's sweep and this phone's
 * probe land in the same field by recency (see `setLiveness`).
 */
export function cachedMintProbe(
  mintUrl: string,
  nowMs: number = Date.now()
): MintProbe | undefined {
  const key = normalizeMintUrlKey(mintUrl);
  const entry = useMintMetadataStore.getState().byMintUrl[key];
  if (!entry?.liveness || typeof entry.livenessAt !== 'number') return undefined;
  return nowMs - entry.livenessAt <= PROBE_TTL_MS ? { key, status: entry.liveness } : undefined;
}

/**
 * Record what a real `/v1/info` round trip the app made for another reason
 * just learned, so it counts as evidence here for free and the sweep skips
 * that mint.
 */
export function recordMintReachability(mintUrl: string, reachable: boolean): void {
  useMintMetadataStore.getState().setLiveness(mintUrl, reachable ? 'online' : 'offline', 'probe');
}

/**
 * What a `/v1/info` outcome says about reachability. A 5xx, a network error
 * or a timeout is a mint that is not answering; a 4xx or a body that is not a
 * NUT-06 document is a server that IS answering, just not as a mint we can
 * read — `unknown`, which never overrides nagg's opinion. A caller's own abort
 * is not evidence and is not cached.
 */
export function classifyMintInfoOutcome(error: Error | null, aborted: boolean): MintStatus {
  if (aborted) return 'unknown';
  if (error === null) return 'online';
  if (error instanceof ApiParseError) return 'unknown';
  if (error instanceof ApiHttpError) return error.status >= 500 ? 'offline' : 'unknown';
  return 'offline';
}

async function probeOne(mintUrl: string, controls: RequestControls = {}): Promise<MintProbe> {
  const key = normalizeMintUrlKey(mintUrl);
  const result = await fetchMintInfo(mintUrl, controls);
  const aborted = controls.signal?.aborted === true;
  const status = classifyMintInfoOutcome(result.isOk() ? null : result.error, aborted);
  const probe: MintProbe = { key, status };
  if (!aborted && status !== 'unknown') {
    useMintMetadataStore.getState().setLiveness(mintUrl, status, 'probe');
  }
  return probe;
}

/**
 * One mint, two opinions: what nagg saw on its schedule and what this phone
 * has seen. First-hand evidence wins; `unknown` on either side is not
 * evidence and never overrides the other's `online`/`offline`.
 */
export function resolveMintStatus(
  local: MintStatus | undefined,
  server: MintStatus | undefined
): MintStatus {
  if (local === 'online' || local === 'offline') return local;
  if (server === 'online' || server === 'offline') return server;
  return 'unknown';
}

/**
 * Probe each mint, reporting results as they land. A cached answer is reported
 * at once and never re-fetched; the rest go through a small worker pool with a
 * short per-row budget. Aborting the signal ends the sweep.
 */
export async function probeMints(
  mintUrls: readonly string[],
  options: {
    onResult: (probe: MintProbe) => void;
    signal?: AbortSignal;
    timeoutMs?: number;
  }
): Promise<void> {
  const pending: string[] = [];
  const seen = new Set<string>();
  for (const mintUrl of mintUrls) {
    if (options.signal?.aborted) return;
    const key = normalizeMintUrlKey(mintUrl);
    if (seen.has(key)) continue;
    seen.add(key);
    const cached = cachedMintProbe(mintUrl);
    if (cached) options.onResult(cached);
    else pending.push(mintUrl);
  }
  if (pending.length === 0) return;

  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < pending.length) {
      if (options.signal?.aborted) return;
      const mintUrl = pending[cursor++];
      try {
        const probe = await probeOne(mintUrl, {
          timeoutMs: options.timeoutMs ?? SWEEP_TIMEOUT_MS,
          signal: options.signal,
        });
        if (!options.signal?.aborted) options.onResult(probe);
      } catch {
        // A thrown probe is the same news as a failed one; the row stays
        // unmarked rather than taking the list down with it.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));
  cashuLog.debug('mint.health.probed', { probed: pending.length });
}
