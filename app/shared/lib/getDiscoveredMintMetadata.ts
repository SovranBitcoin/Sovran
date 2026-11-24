import type { RequestControls } from 'wallet';

import { dataResetGeneration } from '@/shared/lib/account/dataResetFence';
import { discoverMint } from '@/shared/lib/apiClient';
import { cacheOperatorStats } from '@/shared/lib/nostr/fetchProfiles';
import { newReadId, readErrorType, readEvents, readKeyHash } from '@/shared/lib/read/readLog';
import { useMintTestnutStore } from '@/shared/stores/global/mintTestnutStore';
import { useMintMetadataStore } from '@/shared/stores/global/mintMetadataStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { whenLoaded } from '@/shared/lib/persist/hydrationOutcome';
import { normalizeMintUrlKey } from '@/shared/lib/url';

/** How long a discovery answer waits for the stores it writes to load. */
const WRITE_LOAD_WAIT_MS = 10_000;

/**
 * Whether a discovery answer may be written: every store it touches has
 * loaded (a write before that is saved over), and Delete All has not run
 * since the read started (it would write the deleted install's data back).
 */
async function mayWriteDiscovery(generation: number): Promise<boolean> {
  const options = { orFailed: true, timeoutMs: WRITE_LOAD_WAIT_MS };
  const loaded = await Promise.all([
    whenLoaded(useSettingsStore, options),
    whenLoaded(useMintMetadataStore, options),
    whenLoaded(useMintTestnutStore, options),
  ]);
  return loaded.every(Boolean) && dataResetGeneration() === generation;
}

/**
 * Host-scoped display metadata for one mint (audit state + operation counts,
 * review aggregate, operator identity) from nagg's discovery row, written
 * through the unified mint-metadata store. Freshness never establishes
 * spendability or a route.
 *
 * Read lifecycle (`read.mintAudit.*`): a fresh `audit` group is served from the
 * store with no round-trip; a stale one is served AND refetched — the caller
 * gets the refreshed entry when the fetch lands, the cached one when it fails.
 */
export async function getDiscoveredMintMetadata(
  mintUrl: string,
  controls?: RequestControls & { readId?: string }
) {
  const store = useMintMetadataStore.getState();
  const cached = store.getCached(mintUrl);
  const stale = store.isStale(mintUrl, 'audit');
  const readId = controls?.readId ?? newReadId('mintAudit');
  const keyHash = readKeyHash(normalizeMintUrlKey(mintUrl));
  const hasAudit = cached?.auditAt !== undefined;
  if (!stale || controls?.signal?.aborted) {
    readEvents.request({
      readId,
      surface: 'mintAudit',
      keyHash,
      mode: 'initial',
      trigger: 'mount',
      action: controls?.signal?.aborted ? 'skip' : 'serve-fresh',
      strategy: 'http',
      cached: hasAudit,
      stale,
      coldStart: !hasAudit,
      gen: 0,
    });
    return cached;
  }

  const t0 = Date.now();
  const generation = dataResetGeneration();
  readEvents.request({
    readId,
    surface: 'mintAudit',
    keyHash,
    mode: hasAudit ? 'revalidate' : 'initial',
    trigger: 'mount',
    action: hasAudit ? 'serve-stale-revalidate' : 'fetch',
    strategy: 'http',
    cached: hasAudit,
    stale: true,
    coldStart: !hasAudit,
    gen: 0,
  });
  const result = await discoverMint(mintUrl, controls);
  if (controls?.signal?.aborted) {
    readEvents.superseded({ readId, surface: 'mintAudit', keyHash, gen: 0, reason: 'abort' });
    return cached;
  }
  if (result.isOk() && result.value) {
    if (!(await mayWriteDiscovery(generation)) || controls?.signal?.aborted) {
      readEvents.superseded({ readId, surface: 'mintAudit', keyHash, gen: 0, reason: 'abort' });
      return useMintMetadataStore.getState().getCached(mintUrl);
    }
    useMintMetadataStore.getState().upsertFromDiscover([result.value]);
    // The operator's reach and reputation go to the single owner as well, so
    // the profile page and any other row for the same person agree with this
    // list — and the person is linked to the mint they run.
    cacheOperatorStats(
      [result.value].map((m) => ({
        pubkey: m.operatorPubkey,
        followers: m.followers,
        follows: m.follows,
        score: m.vertexScore,
        rank: m.vertexRank,
        operatesMint: m.mintUrl,
      }))
    );
    useMintTestnutStore.getState().applyDiscover([result.value]);
    const next = useMintMetadataStore.getState().getCached(mintUrl);
    readEvents.done({
      readId,
      surface: 'mintAudit',
      keyHash,
      gen: 0,
      durationMs: Date.now() - t0,
      source: 'network',
      tier: 'nagg',
      count: next?.auditAt !== undefined ? 1 : 0,
      empty: next?.auditState === undefined && next?.nMints === undefined,
      degraded: false,
      complete: true,
    });
    return next;
  }
  if (result.isOk()) {
    // nagg knows nothing about this mint: a confirmed empty, not a failure.
    readEvents.done({
      readId,
      surface: 'mintAudit',
      keyHash,
      gen: 0,
      durationMs: Date.now() - t0,
      source: 'network',
      tier: 'nagg',
      count: 0,
      empty: true,
      degraded: false,
      complete: true,
    });
    return cached;
  }
  readEvents.failed({
    readId,
    surface: 'mintAudit',
    keyHash,
    gen: 0,
    durationMs: Date.now() - t0,
    errorType: readErrorType(result.error),
    retained: hasAudit,
  });
  return cached;
}
